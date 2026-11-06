import { describe, expect, it } from "vitest";
import type { PingOverviewBucket } from "@/types/models";
import {
  formatCompactBillingCycle,
  formatCompactExpire,
  healthBarInteractionModel,
  healthBarSlotModel,
} from "@/components/node/nodeCardShared";

function bucket(value: number | null, loss: number | null = 0): PingOverviewBucket {
  return {
    index: 0,
    value,
    loss,
    total: value == null ? 0 : 1,
    lost: 0,
    startAt: null,
    endAt: null,
  };
}

describe("healthBarSlotModel", () => {
  it("keeps every valid latency bucket at one height while color carries severity", () => {
    const values = [0, 20, 55, 88.5, 151, 400];
    const slots = values.map((value) => healthBarSlotModel(bucket(value), "latency"));

    expect(slots.every((slot) => slot.active)).toBe(true);
    expect(new Set(slots.map((slot) => slot.heightFraction))).toEqual(new Set([0.84]));
    expect(slots.map((slot) => slot.color)).toEqual([
      "var(--latency-excellent)",
      "var(--latency-excellent)",
      "var(--latency-excellent)",
      "var(--latency-good)",
      "var(--latency-moderate)",
      "var(--latency-critical)",
    ]);
  });

  it("applies custom latency and loss thresholds and colors when provided", () => {
    const latencyOptions = {
      latencyThresholds: { excellent: 30, good: 70, moderate: 120, elevated: 180 },
      latencyColors: {
        excellent: "#111111",
        good: "#222222",
        moderate: "#333333",
        elevated: "#444444",
        critical: "#555555",
      },
    };
    expect(healthBarSlotModel(bucket(25), "latency", latencyOptions).color).toBe("#111111");
    expect(healthBarSlotModel(bucket(50), "latency", latencyOptions).color).toBe("#222222");
    expect(healthBarSlotModel(bucket(100), "latency", latencyOptions).color).toBe("#333333");
    expect(healthBarSlotModel(bucket(150), "latency", latencyOptions).color).toBe("#444444");
    expect(healthBarSlotModel(bucket(250), "latency", latencyOptions).color).toBe("#555555");

    const lossOptions = {
      lossThresholds: { low: 2, medium: 8 },
      lossColors: {
        zero: "#aaaaaa",
        low: "#bbbbbb",
        medium: "#cccccc",
        high: "#dddddd",
      },
    };
    expect(healthBarSlotModel(bucket(50, 0), "loss", lossOptions).color).toBe("#aaaaaa");
    expect(healthBarSlotModel(bucket(50, 1.5), "loss", lossOptions).color).toBe("#bbbbbb");
    expect(healthBarSlotModel(bucket(50, 5), "loss", lossOptions).color).toBe("#cccccc");
    expect(healthBarSlotModel(bucket(50, 20), "loss", lossOptions).color).toBe("#dddddd");
  });

  it("renders missing latency as a short neutral gap", () => {
    expect(healthBarSlotModel(bucket(null, null), "latency")).toMatchObject({
      active: false,
      heightFraction: 0.25,
      color: "var(--progress-bg)",
    });
  });

  it("keeps loss buckets on the same fixed-height visual language", () => {
    expect(healthBarSlotModel(bucket(20), "latency")).toMatchObject({
      active: true,
      heightFraction: 0.84,
      alpha: 0.94,
    });
    expect(healthBarSlotModel(bucket(20, 12.5), "loss")).toMatchObject({
      active: true,
      heightFraction: 0.84,
      alpha: 0.94,
    });
  });

  it("uses the shared hover lift and sibling fade for canvas renderers", () => {
    const slot = healthBarSlotModel(bucket(55), "latency");

    expect(healthBarInteractionModel(slot, true, 1)).toMatchObject({
      heightFraction: 1,
      alpha: 1,
    });
    expect(healthBarInteractionModel(slot, false, 1).alpha).toBeCloseTo(slot.alpha * 0.54);
    expect(healthBarInteractionModel(slot, true, 0)).toMatchObject({
      heightFraction: slot.heightFraction,
      alpha: slot.alpha,
    });
  });
});

describe("formatCompactExpire", () => {
  it("formats standard days correctly", () => {
    expect(formatCompactExpire({ value: "30", unit: "天" })).toBe("余 30天");
  });

  it("handles missing expiration sentinel", () => {
    expect(formatCompactExpire({ value: "—", unit: "" })).toBe("余 --");
  });
});

describe("formatCompactBillingCycle", () => {
  it("formats standard cycles correctly", () => {
    expect(formatCompactBillingCycle("month")).toBe("月付");
    expect(formatCompactBillingCycle(30)).toBe("月付");
    expect(formatCompactBillingCycle("quarter")).toBe("季付");
    expect(formatCompactBillingCycle(90)).toBe("季付");
    expect(formatCompactBillingCycle("half_year")).toBe("半年付");
    expect(formatCompactBillingCycle(180)).toBe("半年付");
    expect(formatCompactBillingCycle("year")).toBe("年付");
    expect(formatCompactBillingCycle(365)).toBe("年付");
    expect(formatCompactBillingCycle("two_years")).toBe("两年付");
    expect(formatCompactBillingCycle(730)).toBe("两年付");
    expect(formatCompactBillingCycle("三年付")).toBe("三年付");
    expect(formatCompactBillingCycle("three_years")).toBe("三年付");
    expect(formatCompactBillingCycle(1095)).toBe("三年付");
    expect(formatCompactBillingCycle(92)).toBe("季付");
    expect(formatCompactBillingCycle("four_years")).toBe("四年付");
    expect(formatCompactBillingCycle(1460)).toBe("四年付");
    expect(formatCompactBillingCycle("five_years")).toBe("五年付");
    expect(formatCompactBillingCycle(1825)).toBe("五年付");
    expect(formatCompactBillingCycle("lifetime")).toBe("一次性付费");
    expect(formatCompactBillingCycle(-1)).toBe("一次性付费");
    expect(formatCompactBillingCycle(45)).toBe("45天");
  });

  it("handles free price sentinel", () => {
    expect(formatCompactBillingCycle("year", -1)).toBe("免费");
  });

  it("does not invent a yearly billing cycle for missing metadata", () => {
    expect(formatCompactBillingCycle("")).toBe("周期未知");
    expect(formatCompactBillingCycle(null)).toBe("周期未知");
    expect(formatCompactBillingCycle(undefined)).toBe("周期未知");
  });
});
