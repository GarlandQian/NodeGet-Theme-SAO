import type { PingRecord } from "@/types/models";

export function resolvePingSampleCounts(
  sample: Pick<PingRecord, "value" | "count" | "loss">,
) {
  const total =
    typeof sample.count === "number" && Number.isFinite(sample.count) && sample.count > 0
      ? Math.max(1, Math.round(sample.count))
      : 1;
  const reportedLoss = sample.loss;
  const lost =
    typeof reportedLoss === "number" && Number.isFinite(reportedLoss)
      ? Math.min(total, Math.max(0, Math.round((reportedLoss / 100) * total)))
      : sample.value < 0
        ? total
        : 0;
  return { total, lost, valid: total - lost };
}

/** 长区间图表必须优先使用数据聚合间隔，而不是原始 Ping 任务周期。 */
export function resolvePingChartInterval(
  metricIntervalSeconds: number | null | undefined,
  taskIntervalSeconds: number | null | undefined,
  fallbackSeconds = 60,
) {
  for (const value of [metricIntervalSeconds, taskIntervalSeconds, fallbackSeconds]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 60;
}
