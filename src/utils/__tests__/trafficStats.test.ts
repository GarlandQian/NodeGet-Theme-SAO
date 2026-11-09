import { describe, expect, it } from "vitest";
import {
  buildTodayTrafficMetricSamples,
  RATE_DOWN_METRIC,
  RATE_UP_METRIC,
  summarizeTodayTrafficMetrics,
  TRAFFIC_DOWN_METRIC,
  TRAFFIC_UP_METRIC,
  type TrafficMetricSeries,
} from "@/utils/trafficStats";

function metricSeries(
  metricKey: string,
  values: Array<[string, number | null, number?]>,
): TrafficMetricSeries {
  return {
    metricKey,
    client: "node-a",
    intervalSeconds: 300,
    points: values.map(([time, value, count = 1]) => ({ time, value, count })),
  };
}

describe("today traffic stats", () => {
  it("sums traffic buckets and keeps the timestamp of each direction peak", () => {
    const stats = summarizeTodayTrafficMetrics(
      [
        metricSeries(TRAFFIC_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 100],
          ["2026-07-16T00:05:00Z", 50],
        ]),
        metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 300]]),
        metricSeries(RATE_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", 25],
        ]),
        metricSeries(RATE_DOWN_METRIC, [
          ["2026-07-16T00:00:00Z", 40],
          ["2026-07-16T00:05:00Z", 30],
        ]),
      ],
      ["node-a", "node-b"],
    );

    expect(stats[0]).toMatchObject({
      trafficUp: 150,
      trafficDown: 300,
      peakUp: 25,
      peakUpAt: Date.parse("2026-07-16T00:05:00Z"),
      peakDown: 40,
      peakDownAt: Date.parse("2026-07-16T00:00:00Z"),
      sampleCount: 2,
      hasSamples: true,
    });
    expect(stats[1]).toMatchObject({ uuid: "node-b", hasSamples: false, sampleCount: 0 });
  });

  it("does not assign a pseudo peak timestamp when every rate sample is zero", () => {
    const metricStat = summarizeTodayTrafficMetrics(
      [
        metricSeries(RATE_UP_METRIC, [["2026-07-16T00:05:00Z", 0]]),
        metricSeries(RATE_DOWN_METRIC, [["2026-07-16T00:05:00Z", 0]]),
      ],
      ["node-a"],
    )[0];

    expect(metricStat).toMatchObject({
      peakUp: 0,
      peakUpAt: null,
      peakDown: 0,
      peakDownAt: null,
    });
  });

  it("builds newest-first upload and download samples for the detail table", () => {
    const metricSamples = buildTodayTrafficMetricSamples(
      [
        metricSeries(RATE_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", 20],
        ]),
        metricSeries(RATE_DOWN_METRIC, [
          ["2026-07-16T00:00:00Z", 30],
          ["2026-07-16T00:05:00Z", 40],
        ]),
      ],
      "node-a",
    );

    expect(metricSamples).toEqual([
      { timeMs: Date.parse("2026-07-16T00:05:00Z"), up: 20, down: 40 },
      { timeMs: Date.parse("2026-07-16T00:00:00Z"), up: 10, down: 30 },
    ]);
  });
});
