import { describe, expect, it } from "vitest";
import {
  cycleTrafficFromLatest,
  resolveFlatConnectionsTcp,
  resolveOnline,
  resolveTrafficTotal,
} from "@/services/wsStore";

describe("resolveTrafficTotal", () => {
  it("preserves missing counters and accepts actual zero after a reset", () => {
    expect(resolveTrafficTotal(50, undefined)).toBe(50);
    expect(resolveTrafficTotal(50, Number.NaN)).toBe(50);
    expect(resolveTrafficTotal(50, -1)).toBe(50);
    expect(resolveTrafficTotal(50, 0)).toBe(0);
    expect(resolveTrafficTotal(50, 5)).toBe(5);
  });
});

describe("resolveOnline", () => {
  it("does not turn a missing or failed source into an offline node", () => {
    expect(resolveOnline(undefined)).toBe(null);
    expect(resolveOnline({ online: null, data_status: "forbidden" })).toBe(null);
    expect(resolveOnline({})).toBe(null);
    expect(resolveOnline({ online: false })).toBe(false);
    expect(resolveOnline({ online: true })).toBe(true);
  });
});

describe("resolveFlatConnectionsTcp", () => {
  it("derives TCP as connections − udp (latest-status sends TCP+UDP combined)", () => {
    expect(resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5 })).toBe(7);
  });

  it("prefers an explicit connections_tcp when present", () => {
    expect(
      resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5, connections_tcp: 9 }),
    ).toBe(9);
  });

  it("clamps to 0 when udp exceeds the combined count", () => {
    expect(resolveFlatConnectionsTcp({ connections: 3, connections_udp: 5 })).toBe(0);
  });
});

describe("cycleTrafficFromLatest", () => {
  it("preserves extension totals without fabricating directional traffic", () => {
    expect(cycleTrafficFromLatest({ traffic_cycle: { used: 2048 } }))
      .toEqual({ up: null, down: null, used: 2048 });
    expect(cycleTrafficFromLatest({ traffic_cycle: { used: 0 } }))
      .toEqual({ up: null, down: null, used: 0 });
    expect(cycleTrafficFromLatest({ traffic_cycle: { used: -1 } }))
      .toEqual({ up: null, down: null, used: null });
  });

  it("reads complete native cycle totals before legacy flat fields", () => {
    expect(cycleTrafficFromLatest({
      quality: { traffic_cycle: "ok" },
      traffic_cycle: { up: 123, down: 456, used: null },
    })).toEqual({ up: 123, down: 456, used: null });
  });
  it("extracts cycle traffic when quality.traffic_cycle is ok", () => {
    expect(
      cycleTrafficFromLatest({
        quality: { traffic_cycle: "ok" },
        traffic_up: 1048576,
        traffic_down: 2097152,
      }),
    ).toEqual({ up: 1048576, down: 2097152, used: null });
  });

  it("extracts cycle traffic from traffic_cycle object", () => {
    expect(
      cycleTrafficFromLatest({
        traffic_cycle: { up: 5000, down: 6000, used: null },
      }),
    ).toEqual({ up: 5000, down: 6000, used: null });
  });

  it("returns null when no cycle traffic is reported (no period metadata)", () => {
    expect(
      cycleTrafficFromLatest({
        net_total_up: 1048576,
        net_total_down: 2097152,
      }),
    ).toEqual({ up: null, down: null, used: null });
  });

  it("returns null when quality.traffic_cycle is not ok", () => {
    expect(
      cycleTrafficFromLatest({
        quality: { traffic_cycle: "unknown" },
        traffic_up: 1048576,
        traffic_down: 2097152,
      }),
    ).toEqual({ up: null, down: null, used: null });
  });
});
