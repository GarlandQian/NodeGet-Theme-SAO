import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo, NodeMetrics } from "@/types/models";
import { getDisplayRegionCode } from "@/utils/geo";

export const HOME_ALL_GROUP = "__all__";
export const HOME_ALL_REGION = "__all__";

export interface HomeRegionOption {
  /** 展示地区代码(如 "US"),同时用作国旗输入与筛选键;无法识别的地区归入 "UN"。 */
  code: string;
  count: number;
}

// 默认地区排序优先级:中国大陆(CN)最前,港澳台紧随,再新加坡/日本/美国,然后欧洲诸国整体一档,
// 其余垫底。列表内每个代码有唯一名次,所以无论数量多少都固定这个顺序。
const REGION_PRIORITY: string[] = ["CN", "HK", "MO", "TW", "SG", "JP", "US"];

// 欧洲诸国(含跨洲但通常并入欧洲的 TR/RU/外高加索),统一排在优先列表之后、其余地区之前。
const EUROPE_CODES = new Set<string>([
  // "EU":geo.ts 会把 Europe/欧洲 解析成 EU,归入本档而非"其余"。
  "EU",
  "GB", "IE", "FR", "DE", "NL", "BE", "LU", "CH", "AT", "IT", "ES", "PT",
  "SE", "NO", "FI", "DK", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "GR",
  "HR", "SI", "RS", "BA", "ME", "MK", "AL", "LT", "LV", "EE", "UA", "MD",
  "BY", "RU", "TR", "CY", "MT", "LI", "MC", "AD", "SM", "VA", "GE", "AM", "AZ",
]);

function regionRank(code: string): number {
  const index = REGION_PRIORITY.indexOf(code);
  if (index !== -1) return index;
  if (EUROPE_CODES.has(code)) return REGION_PRIORITY.length;
  return REGION_PRIORITY.length + 1;
}

/**
 * 按展示地区代码聚合节点数,按固定地理优先级排序(见 REGION_PRIORITY):中国(大陆优先,含港澳台)
 * → 新加坡 → 日本 → 美国 → 欧洲诸国 → 其余。同一档内(欧洲/其余)再按数量降序、代码升序。
 */
export function getHomeRegionOptions(nodes: HomeNodeSummary[]): HomeRegionOption[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const code = getDisplayRegionCode(node.region);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ code, count })).sort(
    (a, b) =>
      regionRank(a.code) - regionRank(b.code) ||
      b.count - a.count ||
      a.code.localeCompare(b.code),
  );
}

export function getHomeGroupLabel(group: string) {
  return group.trim();
}

/** 对一组原始 group 值做 trim、去空、去重,保留首次出现的顺序。 */
export function dedupeGroupLabels(groups: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of groups) {
    const label = getHomeGroupLabel(String(raw ?? ""));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }

  return result;
}

export function getHomeGroupOptions(nodes: HomeNodeSummary[]) {
  return dedupeGroupLabels(nodes.map((node) => node.group));
}

/** 规范化存下来的 group 排序:trim、去空、去重(首次出现的优先)。 */
export function normalizeHomeGroupOrder(value: unknown): string[] {
  return Array.isArray(value) ? dedupeGroupLabels(value as Array<string | null | undefined>) : [];
}

/**
 * 按用户配置的 `order` 给 `groups` 排序:仍存在的已配置 group 排在前面(按配置顺序),其余 group
 * 保持原本首次出现的顺序。没设排序时原样返回 `groups`。
 */
export function sortHomeGroupOptions(groups: string[], order: string[]): string[] {
  if (order.length === 0) return groups;

  const available = new Set(groups);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of order) {
    if (available.has(group) && !seen.has(group)) {
      seen.add(group);
      result.push(group);
    }
  }
  for (const group of groups) {
    if (!seen.has(group)) {
      seen.add(group);
      result.push(group);
    }
  }

  return result;
}

export function sortNodesByWeight(nodes: readonly NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((left, right) => {
    const leftWeight = Number(left.weight) || 0;
    const rightWeight = Number(right.weight) || 0;
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    const nameCmp = (left.name || "").localeCompare(right.name || "", "zh-CN");
    if (nameCmp !== 0) return nameCmp;
    return (left.uuid || "").localeCompare(right.uuid || "");
  });
}

export interface AggregatedOverviewMetrics {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
  avgCpu: number;
  totalRamUsed: number;
  totalRamTotal: number;
  ramPct: number;
  totalDiskUsed: number;
  totalDiskTotal: number;
  diskPct: number;
  totalTcpConn: number;
  totalUdpConn: number;
  totalSwapUsed: number;
  totalSwapTotal: number;
  swapPct: number;
  avgLoad1: number;
  avgLoad5: number;
  avgLoad15: number;
  totalProcesses: number;
  totalCores: number;
  recentRebootNode: { name: string; seconds: number } | null;
}

/** 聚合可见节点实时读数与硬件总量；仅在线节点计入负载、占用和实时速率。 */
export function aggregateOverviewMetrics(
  summaries: readonly HomeNodeSummary[],
  meta: readonly NodeInfo[],
  getMetrics: (uuid: string) => NodeMetrics | undefined,
): AggregatedOverviewMetrics {
  let onlineNodes = 0;
  let offlineNodes = 0;
  let trafficUp = 0;
  let trafficDown = 0;
  let netUp = 0;
  let netDown = 0;
  let totalCpu = 0;
  let totalRamUsed = 0;
  let totalRamTotal = 0;
  let totalSwapUsed = 0;
  let totalSwapTotal = 0;
  let totalDiskUsed = 0;
  let totalDiskTotal = 0;
  let totalTcpConn = 0;
  let totalUdpConn = 0;
  let totalProcesses = 0;
  let totalLoad1 = 0;
  let totalLoad5 = 0;
  let totalLoad15 = 0;
  let totalCores = 0;

  for (const node of summaries) {
    if (node.online === true) {
      onlineNodes += 1;
      totalCpu += node.cpuPct || 0;
      totalRamUsed += node.ramUsed || 0;
      totalSwapUsed += node.swapUsed || 0;
      totalDiskUsed += node.diskUsed || 0;
      totalTcpConn += node.connectionsTcp || 0;
      totalUdpConn += node.connectionsUdp || 0;
      totalProcesses += node.process || 0;
      totalLoad1 += node.load1 || 0;
      totalLoad5 += node.load5 || 0;
      totalLoad15 += node.load15 || 0;
      netUp += node.netUp || 0;
      netDown += node.netDown || 0;
    } else if (node.online === false) {
      offlineNodes += 1;
    }
    totalRamTotal += node.ramTotal || 0;
    totalSwapTotal += node.swapTotal || 0;
    totalDiskTotal += node.diskTotal || 0;
    trafficUp += node.trafficUp || 0;
    trafficDown += node.trafficDown || 0;
  }

  let minUptimeSeconds = Number.POSITIVE_INFINITY;
  let recentRebootNode: { name: string; seconds: number } | null = null;

  for (const item of meta) {
    totalCores += item.cpu_cores || 0;
    const metrics = getMetrics(item.uuid);
    if (metrics && metrics.online === true && Number.isFinite(metrics.uptime) && metrics.uptime >= 0) {
      if (metrics.uptime < minUptimeSeconds) {
        minUptimeSeconds = metrics.uptime;
        recentRebootNode = {
          name: item.name?.trim() || item.uuid,
          seconds: metrics.uptime,
        };
      }
    }
  }

  const avgCpu = onlineNodes > 0 ? totalCpu / onlineNodes : 0;
  const avgLoad1 = onlineNodes > 0 ? totalLoad1 / onlineNodes : 0;
  const avgLoad5 = onlineNodes > 0 ? totalLoad5 / onlineNodes : 0;
  const avgLoad15 = onlineNodes > 0 ? totalLoad15 / onlineNodes : 0;
  const ramPct = totalRamTotal > 0 ? (totalRamUsed / totalRamTotal) * 100 : 0;
  const swapPct = totalSwapTotal > 0 ? (totalSwapUsed / totalSwapTotal) * 100 : 0;
  const diskPct = totalDiskTotal > 0 ? (totalDiskUsed / totalDiskTotal) * 100 : 0;

  return {
    totalNodes: summaries.length,
    onlineNodes,
    offlineNodes,
    trafficUp,
    trafficDown,
    netUp,
    netDown,
    avgCpu,
    totalRamUsed,
    totalRamTotal,
    ramPct,
    totalDiskUsed,
    totalDiskTotal,
    diskPct,
    totalTcpConn,
    totalUdpConn,
    totalSwapUsed,
    totalSwapTotal,
    swapPct,
    avgLoad1,
    avgLoad5,
    avgLoad15,
    totalProcesses,
    totalCores,
    recentRebootNode,
  };
}
