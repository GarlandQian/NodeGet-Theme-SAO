import { describe, expect, it } from "vitest";
import { globalUuid, nodeFromData, sourceIdentity, timestamp, withTrafficDeltas } from "../nodeget/normalize";

describe("NodeGet presentation conversion", () => {
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
