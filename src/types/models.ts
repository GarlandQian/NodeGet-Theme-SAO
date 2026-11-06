import { z } from "zod";

/** Schema 接受服务端发来的宽松/不完整数据,并填充合理默认值。 */

const looseString = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((v) => String(v))
  .catch("");
const looseNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number.parseFloat(v) || 0))
  .catch(0);
const looseBool = z
  .union([z.boolean(), z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;

    const normalized = v.trim().toLowerCase();
    if (
      normalized === "" ||
      normalized === "0" ||
      normalized === "false" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }
    if (normalized === "1" || normalized === "true") {
      return true;
    }

    return Boolean(normalized);
  })
  .catch(false);

export const NodeInfoSchema = z
  .object({
    uuid: z.string(),
    source_id: z.string().optional(),
    source_name: z.string().optional(),
    name: looseString.default(""),
    group: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    region: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    hidden: looseBool.default(false),
    cpu_name: looseString.default(""),
    cpu_cores: looseNumber.default(0),
    arch: looseString.default(""),
    virtualization: looseString.default(""),
    os: looseString.default(""),
    kernel_version: looseString.default(""),
    gpu_name: looseString.default(""),
    mem_total: looseNumber.default(0),
    swap_total: looseNumber.default(0),
    disk_total: looseNumber.default(0),
    weight: looseNumber.default(0),
    price: looseNumber.default(0),
    billing_cycle: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    auto_renewal: looseBool.default(false),
    currency: looseString.default(""),
    expired_at: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    tags: looseString.default(""),
    public_remark: looseString.default(""),
    traffic_limit: looseNumber.default(0),
    traffic_limit_type: looseString.default(""),
    ipv4: looseString.default(""),
    ipv6: looseString.default(""),
    created_at: looseString.default(""),
    updated_at: looseString.default(""),
  })
  .passthrough();

export type NodeInfo = z.output<typeof NodeInfoSchema>;

export interface NodeRealtime {
  cpu: { usage: number };
  ram: { total: number; used: number };
  swap: { total: number; used: number };
  load: { load1: number; load5: number; load15: number };
  disk: { total: number; used: number };
  network: { up: number; down: number; totalUp: number; totalDown: number };
  connections: { tcp: number; udp: number };
  uptime: number;
  process: number;
  updated_at?: string | number;
}

/** 展示用模型:扁平化的节点信息 + 实时指标 + 在线标志。 */
export interface NodeMetrics {
  online: boolean | null;
  dataStatus?: string;
  cpuPct: number;
  ramUsed: number;
  ramTotal: number;
  ramPct: number;
  swapUsed: number;
  swapTotal: number;
  diskUsed: number;
  diskTotal: number;
  diskPct: number;
  netUp: number;
  netDown: number;
  trafficUp: number;
  trafficDown: number;
  cycleUp?: number | null;
  cycleDown?: number | null;
  /** 流量扩展提供的周期已用总量；没有可信上下行拆分时保持方向字段为空。 */
  cycleUsed?: number | null;
  cyclePartial?: boolean;
  cycleReason?: string;
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
  process: number;
  connectionsTcp: number;
  connectionsUdp: number;
  updatedAt: number;
}

export type MatrixColorTheme =
  | "default"
  | "eva"
  | "divergence";

/** 方格矩阵开屏动效形式：laser-scan (激光横扫)、digital-rain (数码流雨) */
export type MatrixBootEffect =
  | "laser-scan"
  | "digital-rain"
  | "cyber-glitch"
  | "divergence-flux";


/** 用户自定义点阵预设（浏览器本地保存，可导入导出） */
export interface UserMatrixPreset {
  id: string;
  name: string;
  indices: number[];
  createdAt: number;
}

export interface PingLatencyThresholds {
  excellent: number;
  good: number;
  moderate: number;
  elevated: number;
}

export interface PingLatencyColors {
  excellent: string;
  good: string;
  moderate: string;
  elevated: string;
  critical: string;
}

export interface PingLossThresholds {
  low: number;
  medium: number;
}

export interface PingLossColors {
  zero: string;
  low: string;
  medium: string;
  high: string;
}

export interface TrafficSpectrumColors {
  start: string;
  mid: string;
  high: string;
  end: string;
}

export type OverviewCardId =
  | "connections"
  | "cpu"
  | "ram"
  | "disk"
  | "traffic"
  | "asset"
  | "nodes"
  | "bandwidth"
  | "swap"
  | "process"
  | "cores";

export interface ThemeSettings {
  defaultAppearance?: "system" | "light" | "dark";
  desktopNodeViewMode?: "large" | "compact" | "mini" | "list";
  mobileNodeViewMode?: "large" | "compact" | "mini" | "list";
  showPingChart?: boolean;
  homepagePingBindings?: Record<string, string[]>;
  enableHomepageMultiPing?: boolean;
  homepageMultiPingTaskIds?: number[];
  pingLatencyThresholds?: Partial<PingLatencyThresholds>;
  pingLatencyColors?: Partial<PingLatencyColors>;
  pingLossThresholds?: Partial<PingLossThresholds>;
  pingLossColors?: Partial<PingLossColors>;
  trafficSpectrumColors?: Partial<TrafficSpectrumColors>;
  showHomeOverview?: boolean;
  /** 首页顶部总览左侧小卡片列表（固定 6 个槽位，不多不少） */
  overviewCards?: OverviewCardId[];
  showGroupTabs?: boolean;
  showRegionBar?: boolean;
  showCardGroup?: boolean;
  /** 首页右侧集群状态卡片的展示模式：经典上下双层（classic）、机架方格矩阵（nodes）。 */
  clusterOverviewMode?: "classic" | "nodes";
  /** 机架方格矩阵配色风格。 */
  matrixColorTheme?: MatrixColorTheme;
  /** 模拟数据填充空闲机位插槽。 */
  matrixMockFill?: boolean;
  /** 是否启用方格矩阵 SAO 主题开场动画（默认开启）。 */
  matrixBootAnimation?: boolean;
  /** 开屏动效形式：laser-scan (激光横扫)、digital-rain (数码流雨)。 */
  matrixBootEffect?: MatrixBootEffect;
  /** 自定义方格矩阵开场点阵图案（0~99的像素序号数组），为 null 或空时回退为默认 SAO。 */
  matrixCustomPattern?: number[] | null;
  /** 浏览器本地保存的用户自定义点阵预设列表。 */
  matrixUserPresets?: UserMatrixPreset[];
  homeGroupOrder?: string[];
  enableHomeSort?: boolean;
  homeSortField?: "default" | "name" | "speed" | "traffic" | "price";
  homeSortDirection?: "asc" | "desc";
  showTrafficPageButton?: boolean;
  showTrafficPageForGuests?: boolean;
  showCostSummary?: boolean;
  showCostSummaryFloatingButton?: boolean;
  showPriceForGuests?: boolean;
  showOverviewRatings?: boolean;
  showTrafficRating?: boolean;
  showBandwidthRating?: boolean;
  showAssetRating?: boolean;
  trafficRatingLabels?: string;
  bandwidthRatingLabels?: string;
  assetRatingLabels?: string;
  compactShowTrafficTotal?: boolean;
  compactShowBilling?: boolean;
  compactShowUptime?: boolean;
  showConnections?: boolean;
  showTodayTrafficPopover?: boolean;
  hiddenNodes?: string[];
  costIgnoredNodes?: string[];
  // 值支持旧版纯数字(自动升格)或 { amount, paidCny?, acquiredAt? } 条目,见 normalizeCostPremiums。
  costPremiums?: Record<
    string,
    number | { amount?: number; paidCny?: number; acquiredAt?: string }
  >;
  costRateApiUrl?: string;
}

export const PublicConfigSchema = z
  .object({
    sitename: z.string().default(""),
    description: z.string().default(""),
    theme: z.string().default(""),
    site_logo: z.string().default(""),
    footer: z.string().default(""),
    theme_settings: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

export type PublicConfig = z.output<typeof PublicConfigSchema>;

export const LoadRecordSchema = z
  .object({
    cpu: z.number().default(0),
    gpu: z.number().default(0),
    ram: z.number().default(0),
    ram_total: z.number().default(0),
    swap: z.number().default(0),
    swap_total: z.number().default(0),
    load: z.number().default(0),
    temp: z.number().default(0),
    disk: z.number().default(0),
    disk_total: z.number().default(0),
    net_in: z.number().default(0),
    net_out: z.number().default(0),
    net_total_up: z.number().default(0),
    net_total_down: z.number().default(0),
    process: z.number().default(0),
    connections: z.number().default(0),
    connections_tcp: z.number().optional(),
    connections_udp: z.number().default(0),
    time: z.union([z.string(), z.number()]),
    client: z.string().default(""),
  })
  .passthrough();

export type LoadRecord = z.output<typeof LoadRecordSchema>;

export const PingRecordSchema = z
  .object({
    task_id: z.number(),
    time: z.union([z.string(), z.number()]),
    value: z.number(),
    client: z.string().default(""),
    count: z.number().optional(),
    loss: z.number().nullable().optional(),
  })
  .passthrough();

export type PingRecord = z.output<typeof PingRecordSchema>;

export const PingTaskSchema = z
  .object({
    id: z.number(),
    interval: z.number().default(60),
    name: z.string().default(""),
    loss: z.number().default(0),
    clients: z.array(z.string()).default([]),
    type: z.string().default("icmp"),
    target: z.string().default(""),
    weight: z.number().default(0),
  })
  .passthrough();

export type PingTask = z.output<typeof PingTaskSchema>;

export interface LoadRecordsResponse {
  count: number;
  records: LoadRecord[];
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
}

export interface PingRecordsResponse {
  count: number;
  records: PingRecord[];
  tasks: PingTask[];
  /** 原生任务记录实际采用的展示间隔，用于图表识别长区间连续点。 */
  intervalSeconds?: number;
  rangeStartMs?: number;
  rangeEndMs?: number;
  /** 从 NodeGet 原始任务记录计算的完整区间统计。 */
  stats?: PingTaskStats[];
  quality?: "partial";
  message?: string;
}

export interface PingTaskStats {
  client: string;
  taskId: number;
  name: string;
  type: string;
  interval: number;
  total: number;
  valid: number;
  loss: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
  p50: number | null;
  p99: number | null;
  stddev: number | null;
  p99P50Ratio: number;
}

export type PingOverviewTaskLoadState = "pending" | "ready" | "error";

export interface PingDataIssue {
  status: "partial" | "forbidden" | "unavailable" | "error";
  message: string;
}

export interface PingOverviewItem {
  client: string;
  isAssigned: boolean;
  /** 当前原生任务本轮请求状态。 */
  loadState?: PingOverviewTaskLoadState;
  dataIssue?: PingDataIssue;
  lastValue: number | null;
  /** 任务样本聚合窗口的实际宽度。 */
  metricIntervalMs?: number;
  samples: Array<{
    time: number;
    value: number;
    /** 聚合点覆盖的原始任务样本数。 */
    count?: number;
    /** 聚合窗口的丢包百分比。 */
    loss?: number | null;
  }>;
  max: number;
  loss: number | null;
}

export interface HomepagePingLine extends PingOverviewItem {
  taskId: number;
  taskName: string;
}

export interface HomepagePingDisplayLine extends HomepagePingLine {
  buckets: PingOverviewBucket[];
}

export interface TrafficTrendSample {
  value: number;
  level: number;
  opacity: number;
}

export interface PingOverviewBucket {
  index: number;
  value: number | null;
  loss: number | null;
  total: number;
  lost: number;
  startAt: number | null;
  endAt: number | null;
}
