import { describe, expect, it } from "vitest";
import { mergeNodeStatus, resolveTrafficTotal } from "@/services/wsStore";
import type { NodeMetrics, NodeStatus } from "@/types/models";

const previous: NodeMetrics = {
  online: true, dataStatus: "ready", cpuPct: 20,
  ramUsed: 30, ramTotal: 100, ramPct: 30, swapUsed: 5, swapTotal: 50,
  diskUsed: 80, diskTotal: 200, diskPct: 40, netUp: 10, netDown: 20,
  trafficUp: 1000, trafficDown: 2000, cycleUp: 100, cycleDown: 200, cycleUsed: null,
  cyclePartial: false, uptime: 100, load1: 1, load5: 2, load15: 3,
  process: 10, connectionsTcp: 5, connectionsUdp: 3, updatedAt: 1_800_000_000_000,
};

describe("resolveTrafficTotal", () => {
  it("preserves missing counters and accepts actual zero after a reset", () => {
    expect(resolveTrafficTotal(50, undefined)).toBe(50);
    expect(resolveTrafficTotal(50, Number.NaN)).toBe(50);
    expect(resolveTrafficTotal(50, -1)).toBe(50);
    expect(resolveTrafficTotal(50, 0)).toBe(0);
    expect(resolveTrafficTotal(50, 5)).toBe(5);
  });
});

describe("NodeGet display status merging", () => {
  it("uses the display snapshot directly while preserving missing counters and accepting real zero", () => {
    const merged = mergeNodeStatus(previous, {
      online: true, dataStatus: "ready", metrics: {
        ...previous, cpuPct: 40, connectionsTcp: 9, connectionsUdp: 5,
        swapTotal: Number.NaN, trafficUp: Number.NaN, trafficDown: 0,
        updatedAt: previous.updatedAt + 1000,
      },
    });
    expect(merged).toMatchObject({
      online: true, dataStatus: "ready", cpuPct: 40, connectionsTcp: 9, connectionsUdp: 5,
      swapTotal: 50, trafficUp: 1000, trafficDown: 0, updatedAt: previous.updatedAt + 1000,
    });
    expect(previous.cpuPct).toBe(20);
  });

  it.each<NodeStatus["dataStatus"]>(["unavailable", "partial", "forbidden", "error"])(
    "keeps the last measurements but marks %s status as unknown and clears cycle values",
    dataStatus => {
      const merged = mergeNodeStatus(previous, { online: null, dataStatus, metrics: null });
      expect(merged).toMatchObject({
        online: null, dataStatus, cpuPct: 20, ramUsed: 30, trafficUp: 1000, trafficDown: 2000,
        cycleUp: null, cycleDown: null, cycleUsed: null, updatedAt: previous.updatedAt,
      });
    },
  );

  it("distinguishes a missing source from a confirmed offline node", () => {
    expect(mergeNodeStatus(previous)).toMatchObject({ online: null, dataStatus: "unavailable" });
    expect(mergeNodeStatus(previous, { online: false, dataStatus: "ready", metrics: previous }))
      .toMatchObject({ online: false, dataStatus: "ready", cpuPct: 20 });
  });

  it("replaces directional cycle totals with extension totals without retaining an old split", () => {
    for (const cycleUsed of [2048, 0]) {
      const merged = mergeNodeStatus(previous, {
        online: true, dataStatus: "ready", metrics: {
          ...previous, cycleUp: null, cycleDown: null, cycleUsed,
          cyclePartial: true, cycleReason: "周期起点尚未确认",
        },
      });
      expect(merged).toMatchObject({
        cycleUp: null, cycleDown: null, cycleUsed, cyclePartial: true, cycleReason: "周期起点尚未确认",
      });
    }
  });
});
