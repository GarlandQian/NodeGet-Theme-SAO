import { getNodePingWindowStats } from "@/services/api";
import type { PingTaskStats, YesterdayBestScope } from "@/types/models";
import { detectCarrier, type CarrierType } from "@/utils/carrierLoss";

export interface YesterdayBestNodeResult {
  date: string; // "YYYY-MM-DD"
  timestamp?: number;
  uuid: string;
  name?: string;
  score: number;
  avgLatency: number;
  avgLoss: number;
  cv: number;
  spikeRatio: number;
  p99?: number | null;
  sampleCount: number;
  taskCount?: number;
  scope?: YesterdayBestScope;
  isQualified?: boolean;
  missingCarriers?: CarrierType[];
  coveredCarriers?: CarrierType[];
}

export interface YesterdayLeaderboardItem extends YesterdayBestNodeResult {
  rank: number;
}

export interface YesterdayBestMetricsInput {
  loss: number;
  avg?: number;
  stddev?: number;
  p50?: number;
  p99?: number;
}

/** 上游稳定性评分综合丢包、线路内方差和延迟尖峰。 */
export function calculateNodeNetworkScore(input: YesterdayBestMetricsInput): number {
  const { loss, avg = 0, stddev = 0, p50 = avg, p99 = avg } = input;
  let score = 100;

  // 1. 丢包惩罚（平滑梯级，最高扣 50 分）
  if (loss > 0) {
    if (loss <= 1) {
      score -= (loss / 0.1) * 0.4; // 1% 时扣 4 分
    } else if (loss <= 5) {
      score -= 4 + (loss - 1) * 2.5; // 5% 时扣 14 分
    } else if (loss <= 12) {
      score -= 14 + (loss - 5) * 2.3; // 12% 时扣 30.1 分
    } else if (loss <= 25) {
      score -= 30.1 + (loss - 12) * (19.9 / 13); // 25% 时精确扣满 50 分
    } else {
      score -= 50; // > 25% 扣满 50 分
    }
  }

  // 科学平衡分母基准：限制在 60ms ~ 160ms 区间，消除“高延迟大分母保护伞”，同时保护美西直连与极低延迟节点不被微小抖动误伤
  const effAvg = avg > 0 ? Math.min(Math.max(avg, 60), 160) : 100;

  // 2. 抖动离散度惩罚（有效变异系数 cvEff，最高扣 30 分）
  if (avg > 0 && stddev > 0) {
    const cvEff = stddev / effAvg;
    // 若绝对标准差 <= 4ms（平直如专线，例如内网或高质量美西优化线），完全豁免抖动扣分
    if (cvEff > 0.05 && stddev > 4) {
      if (cvEff <= 0.15) {
        score -= (cvEff - 0.05) * 60; // 0.15 时扣 6 分
      } else if (cvEff <= 0.35) {
        score -= 6 + (cvEff - 0.15) * 70; // 0.35 时扣 20 分
      } else {
        score -= 20 + Math.min(10, (cvEff - 0.35) * 50); // 最高扣 30 分
      }
    }
  }

  // 3. 极端尖峰与晚高峰拥塞惩罚（最高扣 20 分）
  const baseline = Math.max(p50, avg);
  if (baseline > 0 && p99 > baseline) {
    const delta = p99 - baseline;
    // 若绝对突增量 <= 8ms（属于网络合理采样噪点/毛刺），完全豁免尖峰扣分
    if (delta > 8) {
      const ratio = 1 + (delta / effAvg);
      if (ratio > 1.15) {
        if (ratio <= 1.50) {
          score -= (ratio - 1.15) * 20; // 1.50 时扣 7 分
        } else if (ratio <= 2.20) {
          score -= 7 + (ratio - 1.50) * 15; // 2.20 时扣 17.5 分
        } else {
          score -= 17.5 + Math.min(2.5, (ratio - 2.20) * 5); // 最高扣 20 分
        }
      }
    }
  }

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

export async function calculateYesterdayBestLeaderboard(
  candidateUuids: string[],
  options: { scope?: YesterdayBestScope; now?: number; signal?: AbortSignal } = {},
) {
  const scope = options.scope ?? "tri";
  const result = candidateUuids.length
    ? await getNodePingWindowStats(candidateUuids, 24, { signal: options.signal })
    : { stats: [], issues: {} };
  const date = new Date(options.now ?? Date.now()).toLocaleDateString("sv-SE");
  return { ...rankNodePingStats(result.stats, candidateUuids, scope, date), issues: result.issues };
}

export function rankNodePingStats(
  stats: PingTaskStats[],
  candidateUuids: string[],
  scope: YesterdayBestScope,
  date: string,
) {
  const candidates = new Set(candidateUuids);
  const byNode = new Map<string, PingTaskStats[]>();
  for (const sample of stats) {
    if (!candidates.has(sample.client) || !sample.total) continue;
    const carrier = detectCarrier(sample.name);
    if (scope === "tri" && carrier === "unknown") continue;
    if (scope !== "tri" && scope !== "all" && scope !== carrier) continue;
    const group = byNode.get(sample.client) ?? [];
    group.push(sample);
    byNode.set(sample.client, group);
  }
  const list: YesterdayBestNodeResult[] = [];
  for (const [uuid, group] of byNode) {
    const valid = group.filter((s): s is PingTaskStats & {
      avg: number; p50: number; p99: number; stddev: number;
    } => s.valid > 0 && s.avg !== null && s.p50 !== null && s.p99 !== null && s.stddev !== null);
    if (!valid.length) continue;
    const count = valid.reduce((sum, s) => sum + s.valid, 0);
    const avg = valid.reduce((sum, s) => sum + s.avg * s.valid, 0) / count;
    const p50 = valid.reduce((sum, s) => sum + s.p50 * s.valid, 0) / count;
    const p99 = Math.max(...valid.map(s => s.p99));
    const stddev = Math.sqrt(valid.reduce((sum, s) => sum + s.stddev ** 2 * s.valid, 0) / count);
    // 每条有记录的线路等权计入丢包，包含全超时线路；延迟只加权有效响应。
    const loss = group.reduce((sum, s) => sum + s.loss, 0) / group.length;
    const coveredCarriers = [...new Set(group.map(s => detectCarrier(s.name)))].filter(c => c !== "unknown");
    const required = scope === "tri" ? (["ct", "cu", "cm"] as const) : scope === "all" ? [] : [scope];
    const missingCarriers = required.filter(c => !coveredCarriers.includes(c));
    list.push({
      uuid, date, scope, score: calculateNodeNetworkScore({ loss, avg, p50, p99, stddev }),
      avgLatency: Math.round(avg * 10) / 10, avgLoss: Math.round(loss * 10) / 10,
      cv: avg > 0 ? stddev / avg : 0, spikeRatio: avg > 0 ? p99 / avg : 1, p99,
      sampleCount: group.reduce((sum, s) => sum + s.total, 0), taskCount: group.length,
      coveredCarriers, missingCarriers, isQualified: !missingCarriers.length,
    });
  }
  const candidateOrder = new Map(candidateUuids.map((id, index) => [id, index]));
  list.sort((a, b) => Number(b.isQualified) - Number(a.isQualified) ||
    b.score - a.score || a.cv - b.cv || a.spikeRatio - b.spikeRatio ||
    a.avgLatency - b.avgLatency || (candidateOrder.get(a.uuid) ?? -1) - (candidateOrder.get(b.uuid) ?? -1));
  const leaderboard = list.map((item, i): YesterdayLeaderboardItem => ({ ...item, rank: i + 1 }));
  return { best: leaderboard.find(item => item.isQualified) ?? null, leaderboard };
}

export interface YesterdayAverageResult {
  score: number;
  avgLatency: number;
  avgLoss: number;
  nodeCount: number;
  qualifiedCount: number;
}

/**
 * 从天梯榜中计算参评节点的综合平均分数（反映集群整体健康度大盘基线）
 * 优先计算具备评分资格的节点平均值；若均未齐备则计算全量参评节点的平均值。
 */
export function calculateYesterdayAverageScore(
  leaderboard: YesterdayLeaderboardItem[],
): YesterdayAverageResult | null {
  if (!leaderboard || leaderboard.length === 0) return null;
  const qualifiedList = leaderboard.filter((item) => item.isQualified);
  const targetList = qualifiedList.length > 0 ? qualifiedList : leaderboard;

  const totalScore = targetList.reduce((acc, cur) => acc + cur.score, 0);
  const totalLatency = targetList.reduce((acc, cur) => acc + cur.avgLatency, 0);
  const totalLoss = targetList.reduce((acc, cur) => acc + cur.avgLoss, 0);
  const count = targetList.length;

  return {
    score: Number((totalScore / count).toFixed(1)),
    avgLatency: Number((totalLatency / count).toFixed(1)),
    avgLoss: Number((totalLoss / count).toFixed(2)),
    nodeCount: count,
    qualifiedCount: qualifiedList.length,
  };
}
