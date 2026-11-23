import { describe, expect, it } from "vitest";
import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo, NodeMetrics } from "@/types/models";
import {
  aggregateOverviewMetrics,
  getHomeGroupOptions,
  normalizeHomeGroupOrder,
  sortHomeGroupOptions,
  sortNodesByWeight,
} from "@/utils/homeNodes";

function node(partial: Partial<HomeNodeSummary> & Pick<HomeNodeSummary, "uuid">): HomeNodeSummary {
  return {
    group: "",
    hidden: false,
    region: "",
    online: true,
    trafficDown: 0,
    trafficUp: 0,
    netDown: 0,
    netUp: 0,
    weight: 0,
    cpuPct: 0,
    ramUsed: 0,
    ramTotal: 0,
    swapUsed: 0,
    swapTotal: 0,
    diskUsed: 0,
    diskTotal: 0,
    connectionsTcp: 0,
    connectionsUdp: 0,
    process: 0,
    load1: 0,
    load5: 0,
    load15: 0,
    ...partial,
  };
}

describe("home node helpers", () => {
  it("builds group tabs from non-empty backend groups and keeps first-seen order", () => {
    expect(
      getHomeGroupOptions([
        node({ uuid: "a", group: "US 美国" }),
        node({ uuid: "b", group: "HK 香港" }),
        node({ uuid: "c", group: "US 美国" }),
        node({ uuid: "d", group: "" }),
      ]),
    ).toEqual(["US 美国", "HK 香港"]);
  });

});

describe("home group ordering", () => {
  it("normalizeHomeGroupOrder trims, drops empties, dedupes, and rejects non-arrays", () => {
    expect(normalizeHomeGroupOrder([" A ", "B", "A", "", null, "B"])).toEqual(["A", "B"]);
    expect(normalizeHomeGroupOrder("nope")).toEqual([]);
    expect(normalizeHomeGroupOrder(undefined)).toEqual([]);
  });

  it("returns the original order when no custom order is set", () => {
    const groups = ["US", "HK", "JP"];
    expect(sortHomeGroupOptions(groups, [])).toBe(groups);
  });

  it("places configured groups first, then appends the rest in original order", () => {
    expect(sortHomeGroupOptions(["US", "HK", "JP", "SG"], ["JP", "US"])).toEqual([
      "JP",
      "US",
      "HK",
      "SG",
    ]);
  });

  it("ignores configured groups that no longer exist and never duplicates", () => {
    expect(sortHomeGroupOptions(["US", "HK"], ["GONE", "HK", "HK"])).toEqual(["HK", "US"]);
  });
});

describe("overview node aggregation and sorting", () => {
  function metaNode(partial: Partial<NodeInfo> & Pick<NodeInfo, "uuid" | "name">): NodeInfo {
    return {
      cpu_name: "",
      virtualization: "",
      arch: "",
      cpu_cores: 2,
      os: "",
      kernel_version: "",
      cpu_name_raw: undefined,
      gpu_name: "",
      region: "",
      mem_total: 0,
      swap_total: 0,
      disk_total: 0,
      weight: 0,
      price: 0,
      billing_cycle: 0,
      auto_renewal: false,
      currency: "",
      expired_at: "",
      group: "",
      tags: "",
      public_remark: "",
      hidden: false,
      traffic_limit: 0,
      traffic_limit_type: "sum",
      created_at: "",
      updated_at: "",
      ...partial,
    } as NodeInfo;
  }

  it("sorts nodes by weight, locale name, then uuid", () => {
    const sorted = sortNodesByWeight([
      metaNode({ uuid: "b", name: "Beta", weight: 2 }),
      metaNode({ uuid: "c", name: "Alpha", weight: 1 }),
      metaNode({ uuid: "a", name: "Alpha", weight: 1 }),
    ]);
    expect(sorted.map((item) => item.uuid)).toEqual(["a", "c", "b"]);
  });

  it("excludes offline cached readings from live overview averages while retaining capacities and traffic totals", () => {
    const summaries = [
      node({
        uuid: "online-1",
        online: true,
        cpuPct: 40,
        ramUsed: 200,
        ramTotal: 1000,
        netUp: 50,
        netDown: 80,
        trafficUp: 100,
        trafficDown: 200,
      }),
      node({
        uuid: "offline-2",
        online: false,
        cpuPct: 90,
        ramUsed: 900,
        ramTotal: 1000,
        netUp: 500,
        netDown: 800,
        trafficUp: 300,
        trafficDown: 400,
      }),
    ];
    const meta = [
      metaNode({ uuid: "online-1", name: "Online", cpu_cores: 4 }),
      metaNode({ uuid: "offline-2", name: "Offline", cpu_cores: 8 }),
    ];
    const metricsMap: Record<string, NodeMetrics> = {
      "online-1": { uptime: 120, online: true } as NodeMetrics,
      "offline-2": { uptime: 10, online: false } as NodeMetrics,
    };

    const result = aggregateOverviewMetrics(summaries, meta, (uuid) => metricsMap[uuid]);
    expect(result.onlineNodes).toBe(1);
    expect(result.offlineNodes).toBe(1);
    expect(result.avgCpu).toBe(40);
    expect(result.totalRamUsed).toBe(200);
    expect(result.totalRamTotal).toBe(2000);
    expect(result.ramPct).toBe(10);
    expect(result.netUp).toBe(50);
    expect(result.netDown).toBe(80);
    expect(result.trafficUp).toBe(400);
    expect(result.trafficDown).toBe(600);
    expect(result.totalCores).toBe(12);
    expect(result.recentRebootNode).toEqual({ name: "Online", seconds: 120 });
  });
});
