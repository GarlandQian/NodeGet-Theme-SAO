import { describe, expect, it } from "vitest";
import {
  resolvePingSampleCounts,
  resolvePingChartInterval,
} from "@/utils/pingMetrics";

describe("resolvePingChartInterval", () => {
  it("uses the 7-day rollup interval instead of splitting points by the raw task cadence", () => {
    expect(resolvePingChartInterval(15 * 60, 60)).toBe(15 * 60);
    expect(resolvePingChartInterval(undefined, 60)).toBe(60);
  });
});

describe("resolvePingSampleCounts", () => {
  it("uses aggregate count and loss percentage instead of treating a bucket as one sample", () => {
    expect(resolvePingSampleCounts({ value: 45, count: 20, loss: 25 })).toEqual({
      total: 20,
      lost: 5,
      valid: 15,
    });
  });

  it("falls back safely for malformed metadata and keeps failed probes", () => {
    expect(resolvePingSampleCounts({ value: 12, count: Number.NaN, loss: Number.NaN })).toEqual({
      total: 1,
      lost: 0,
      valid: 1,
    });
    expect(resolvePingSampleCounts({ value: -1 })).toEqual({
      total: 1,
      lost: 1,
      valid: 0,
    });
  });
});
