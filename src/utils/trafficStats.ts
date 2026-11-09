export const TRAFFIC_UP_METRIC = "traffic.up";
export const TRAFFIC_DOWN_METRIC = "traffic.down";
export const RATE_UP_METRIC = "net.out.rate";
export const RATE_DOWN_METRIC = "net.in.rate";

export interface TrafficMetricSeries {
  metricKey: string;
  client: string;
  intervalSeconds?: number;
  semantics?: string;
  quality?: string;
  points: Array<{ time: string; value: number | null; count: number }>;
}

export interface TodayTrafficStat {
  uuid: string;
  trafficUp: number;
  trafficDown: number;
  peakUp: number;
  peakUpAt: number | null;
  peakDown: number;
  peakDownAt: number | null;
  sampleCount: number;
  hasSamples: boolean;
  trafficAvailable?: boolean;
  ratesAvailable?: boolean;
  partial?: boolean;
  statusMessage?: string;
}

export interface TodayTrafficSample {
  timeMs: number;
  up: number;
  down: number;
}

function emptyStat(uuid: string): TodayTrafficStat {
  return {
    uuid,
    trafficUp: 0,
    trafficDown: 0,
    peakUp: 0,
    peakUpAt: null,
    peakDown: 0,
    peakDownAt: null,
    sampleCount: 0,
    hasSamples: false,
  };
}

function validPoint(point: TrafficMetricSeries["points"][number]) {
  return point.count > 0 && point.value != null && Number.isFinite(point.value);
}

export function summarizeTodayTrafficMetrics(
  series: TrafficMetricSeries[],
  uuids: string[],
): TodayTrafficStat[] {
  const stats = new Map(uuids.map((uuid) => [uuid, emptyStat(uuid)] as const));
  const sampleTimes = new Map(uuids.map((uuid) => [uuid, new Set<number>()] as const));

  for (const item of series) {
    const stat = stats.get(item.client);
    if (!stat) continue;
    for (const point of item.points) {
      if (!validPoint(point)) continue;
      const timeMs = Date.parse(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const value = Math.max(0, point.value ?? 0);
      sampleTimes.get(item.client)?.add(timeMs);
      stat.hasSamples = true;

      switch (item.metricKey) {
        case TRAFFIC_UP_METRIC:
          stat.trafficUp += value;
          break;
        case TRAFFIC_DOWN_METRIC:
          stat.trafficDown += value;
          break;
        case RATE_UP_METRIC:
          if (value > stat.peakUp) {
            stat.peakUp = value;
            stat.peakUpAt = timeMs;
          }
          break;
        case RATE_DOWN_METRIC:
          if (value > stat.peakDown) {
            stat.peakDown = value;
            stat.peakDownAt = timeMs;
          }
          break;
      }
    }
  }

  for (const [uuid, stat] of stats) {
    stat.sampleCount = sampleTimes.get(uuid)?.size ?? 0;
  }
  return [...stats.values()];
}

export function buildTodayTrafficMetricSamples(
  series: TrafficMetricSeries[],
  uuid: string,
): TodayTrafficSample[] {
  const samples = new Map<number, TodayTrafficSample>();
  for (const item of series) {
    if (
      item.client !== uuid ||
      (item.metricKey !== RATE_UP_METRIC && item.metricKey !== RATE_DOWN_METRIC)
    ) {
      continue;
    }
    for (const point of item.points) {
      if (!validPoint(point)) continue;
      const timeMs = Date.parse(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const sample = samples.get(timeMs) ?? { timeMs, up: 0, down: 0 };
      if (item.metricKey === RATE_UP_METRIC) sample.up = Math.max(0, point.value ?? 0);
      else sample.down = Math.max(0, point.value ?? 0);
      samples.set(timeMs, sample);
    }
  }
  return [...samples.values()].sort((left, right) => right.timeMs - left.timeMs);
}

export function hasTrafficData(stat: TodayTrafficStat | undefined | null): boolean {
  return Boolean(stat?.hasSamples && stat.trafficAvailable !== false);
}

export function hasRateData(stat: TodayTrafficStat | undefined | null): boolean {
  return Boolean(stat?.hasSamples && stat.ratesAvailable !== false);
}
