import { describe, expect, it, vi } from "vitest";
import { HistoryScheduler } from "../nodeget/history";
import { METADATA_KEYS, nodeFromData } from "../nodeget/normalize";
import type { RpcCaller } from "../nodeget/rpc";
import { NodeGetSource } from "../nodeget/source";
import { readExtensionTrafficPeriod } from "../nodeget/traffic";

const now = 1_800_000_000_000;
const extension = {
  metadata_billing_mode: "quota",
  metadata_traffic_period: "monthly",
  metadata_traffic_limit: 500,
  metadata_traffic_period_start: now - 86_400_000,
};

describe("NodeGet extension-traffic integration", () => {
  it("reads published combined bytes, including zero, without fabricating directional counters", () => {
    expect(METADATA_KEYS).toContain("metadata_traffic_used");
    expect(readExtensionTrafficPeriod({ ...extension, metadata_traffic_used: "0" }, now)).toEqual({
      used: 0, start: extension.metadata_traffic_period_start, partial: false, canReadSnapshots: false,
    });
    expect(readExtensionTrafficPeriod({ ...extension, metadata_traffic_used: 123_456 }, now)?.used).toBe(123_456);
  });

  it("distinguishes saved quota settings from initialized worker data", () => {
    const pending = readExtensionTrafficPeriod({ ...extension, metadata_traffic_period_start: null }, now);
    expect(pending).toMatchObject({ start: 0, canReadSnapshots: false, reason: "等待流量扩展初始化周期" });
    expect(pending).not.toHaveProperty("used");
    expect(readExtensionTrafficPeriod(extension, now)).toMatchObject({
      start: extension.metadata_traffic_period_start, canReadSnapshots: true, reason: "等待流量扩展发布周期用量",
    });
  });

  it("uses the worker's rolling 30-day month and never resets a cycle in the browser", () => {
    const start = Date.UTC(2026, 0, 15, 12);
    const metadata = { ...extension, metadata_traffic_period_start: start, metadata_traffic_used: 123 };
    expect(readExtensionTrafficPeriod(metadata, Date.UTC(2026, 1, 1))?.used).toBe(123);
    const expired = readExtensionTrafficPeriod(metadata, start + 30 * 86_400_000);
    expect(expired).toMatchObject({ canReadSnapshots: false, reason: "流量周期已过期，等待重置 Worker 更新" });
    expect(expired).not.toHaveProperty("used");
    expect(metadata.metadata_traffic_period_start).toBe(start);
  });

  it("rejects future periods and invalid usage, and identifies an unverified period", () => {
    expect(readExtensionTrafficPeriod({ ...extension, metadata_traffic_period_start: now + 1, metadata_traffic_used: 5 }, now)).not.toHaveProperty("used");
    for (const value of [-1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "invalid"]) {
      expect(readExtensionTrafficPeriod({ ...extension, metadata_traffic_used: value }, now)).toMatchObject({
        canReadSnapshots: false, reason: "流量扩展返回了无效的周期用量",
      });
    }
    expect(readExtensionTrafficPeriod({ ...extension, metadata_traffic_period_start: undefined, metadata_traffic_used: 5 }, now)).toMatchObject({
      used: 5, partial: true, canReadSnapshots: false,
    });
  });

  it("converts extension GiB quotas and uses its combined direction while preserving native byte quotas", () => {
    const status = { costs: false, metadata: "ready", static: "ready" };
    const node = nodeFromData("s", "Source", "n", { ...extension, metadata_traffic_limit_type: "up" }, {}, {}, status);
    expect(node).toMatchObject({ traffic_limit: 500 * 1024 ** 3, traffic_limit_type: "sum", traffic_period: "monthly", traffic_billing_mode: "quota" });
    expect(nodeFromData("s", "Source", "n", { metadata_traffic_limit: 500, metadata_traffic_limit_type: "up" }, {}, {}, status)).toMatchObject({
      traffic_limit: 500, traffic_limit_type: "up",
    });
    for (const override of [{ metadata_billing_mode: "payg" }, { metadata_traffic_period: "never" }]) {
      expect(nodeFromData("s", "Source", "n", { ...extension, ...override }, {}, {}, status).traffic_limit).toBe(0);
      expect(readExtensionTrafficPeriod({ ...extension, ...override }, now)).toEqual({ start: 0, partial: false, canReadSnapshots: false });
    }
  });

  it.each([
    { used: 456, age: 60_000, startKnown: true, expected: { cycleUsed: 456, cyclePartial: false, cycleReason: undefined } },
    { used: 0, age: 60_000, startKnown: true, expected: { cycleUsed: 0, cyclePartial: false, cycleReason: undefined } },
    { used: 456, age: 60_000, startKnown: false, expected: { cycleUsed: 456, cyclePartial: true, cycleReason: "显示扩展已发布用量，周期起点尚未确认" } },
    { used: 456, age: 31 * 86_400_000, startKnown: true, expected: { cycleUsed: null, cyclePartial: false, cycleReason: "流量周期已过期，等待重置 Worker 更新" } },
  ])("publishes extension usage and availability without requesting traffic snapshots: $expected", async ({ used, age, startKnown, expected }) => {
    const metadata = { ...extension, metadata_traffic_period_start: startKnown ? Date.now() - age : undefined, metadata_traffic_used: used };
    const call = vi.fn(async (method: string) => {
      if (method === "nodeget-server_list_all_agent_uuid") return { uuids: ["n"] };
      if (method === "kv_get_multi_value") return Object.entries(metadata).map(([key, value]) => ({ namespace: "n", key, value }));
      if (method === "agent_dynamic_summary_multi_last_query") return [{
        uuid: "n", timestamp: Date.now(), cpu_usage: 1, used_memory: 1, total_memory: 2,
        total_space: 100, available_space: 50, receive_speed: 10, transmit_speed: 20,
        total_received: 10_000, total_transmitted: 20_000, uptime: 100,
      }];
      return [];
    });
    const scheduler = new HistoryScheduler();
    const source = new NodeGetSource("s", "Source", { call, close() {} } as RpcCaller, scheduler, false, () => {});
    try {
      await source.getNodes();
      const latest = await source.latest();
      expect(latest["s~n"]).toMatchObject({
        online: true, dataStatus: "ready", metrics: { ...expected, cycleUp: null, cycleDown: null },
      });
      expect(call.mock.calls.some(([method]) => method === "agent_query_traffic_total" || method === "agent_query_traffic")).toBe(false);
    } finally { source.close(); scheduler.close(); }
  });
});
