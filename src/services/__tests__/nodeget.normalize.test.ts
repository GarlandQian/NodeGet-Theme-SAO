import { describe, expect, it } from "vitest";
import { globalUuid, metricsFromData, nodeFromData, sourceIdentity, timestamp, withTrafficDeltas } from "../nodeget/normalize";

describe("NodeGet presentation conversion", () => {
  it("maps native realtime fields straight to display metrics without reading old probe aliases", () => {
    const metrics = metricsFromData({
      timestamp: 1_800_000_000_000, cpu_usage: 25, used_memory: 30, total_memory: 100,
      used_swap: 5, total_swap: 10, total_space: 200, available_space: 50,
      transmit_speed: 120, receive_speed: 240, total_transmitted: 0, total_received: 500,
      load_one: 1, load_five: 2, load_fifteen: 3, uptime: 100, process_count: 20,
      tcp_connections: 7, udp_connections: 4,
      cpu: { usage: 99 }, ram: { used: 99, total: 100 }, connections: 100,
      connections_tcp: 90, connections_udp: 10, cycle_up: 999, traffic_up: 999,
    });
    expect(metrics).toEqual({
      cpuPct: 25, ramUsed: 30, ramTotal: 100, ramPct: 30, swapUsed: 5, swapTotal: 10,
      diskUsed: 150, diskTotal: 200, diskPct: 75, netUp: 120, netDown: 240,
      trafficUp: 0, trafficDown: 500, cycleUp: null, cycleDown: null, cycleUsed: null,
      load1: 1, load5: 2, load15: 3, uptime: 100, process: 20,
      connectionsTcp: 7, connectionsUdp: 4, updatedAt: 1_800_000_000_000,
    });
    const missing = metricsFromData({ connections: 20, connections_udp: 5 });
    expect(missing.connectionsTcp).toBe(0);
    expect(missing.trafficUp).toBeNaN();
    expect(missing.trafficDown).toBeNaN();
    expect(missing.swapTotal).toBeNaN();
  });
  it("keeps source and node identities stable and isolates the same UUID across sources", () => {
    const first = sourceIdentity("wss://one.example/nodeget/rpc");
    expect(first).toBe(sourceIdentity("wss://one.example/nodeget/rpc"));
    expect(globalUuid(first, "same")).not.toBe(globalUuid(sourceIdentity("wss://two.example/nodeget/rpc"), "same"));
    expect(sourceIdentity("wss://old", "stable")).toBe(sourceIdentity("wss://new", "stable"));
  });
  it("handles false metadata, tags, quotas, absent costs, and combined TCP/UDP correctly", () => {
    const node = nodeFromData("s1", "One", "same", {
      metadata_hidden: "false", metadata_tags: '["CN2<Blue>","Tokyo"]',
      metadata_traffic_limit: 2, metadata_billing_mode: "quota", metadata_traffic_period: "monthly",
    }, {}, {}, { costs: false, metadata: "ready", static: "unavailable" });
    expect(node.hidden).toBe(false); expect(node.tags).toBe("CN2<Blue>;Tokyo");
    expect(node.traffic_limit).toBe(2 * 1024 ** 3); expect(node.price_configured).toBe(false);
    expect(node.source_name).toBe("One");
  });
  it("keeps expiry visible when amounts are hidden without exposing financial metadata", () => {
    const expires = 1_900_000_000_000;
    const node = nodeFromData("s1", "One", "same", {
      metadata_expire_time: String(expires), metadata_price: 99,
      metadata_price_unit: "USD", metadata_price_cycle: 30,
    }, {}, {}, { costs: false, metadata: "ready", static: "ready" });
    expect(node.expired_at).toBe(new Date(expires).toISOString());
    expect(node).toMatchObject({ price: 0, price_configured: false, currency: "", billing_cycle: "" });
    for (const value of [undefined, null, "", "not-a-date", 0, -1, 1e20]) {
      expect(nodeFromData("s1", "One", "same", { metadata_expire_time: value }, {}, {}, {
        costs: false, metadata: "ready", static: "ready",
      }).expired_at).toBe("");
    }
  });
  it("computes interval deltas before dropping the predecessor and never fabricates resets", () => {
    const base = 1_800_000_000_000;
    const data = withTrafficDeltas("s~n", [
      { timestamp: base, total_received: 100, total_transmitted: 50, uptime: 100, tcp_connections: 3, udp_connections: 2 },
      { timestamp: base + 1000, total_received: 160, total_transmitted: 70, uptime: 101 },
      { timestamp: base + 2000, total_received: 10, total_transmitted: 5, uptime: 1 },
    ]);
    expect(data[0]!.traffic_up).toBeNaN(); expect(data[1]!.traffic_up).toBe(20);
    expect(data[1]!.traffic_down).toBe(60); expect(data[2]!.traffic_down).toBeNaN();
    expect(data[0]!.connections).toBe(5); expect(data[0]!.connections_tcp).toBe(3);
    expect(timestamp(undefined)).toBe(0); expect(data[0]!.cpu).toBeNaN();
  });
});
