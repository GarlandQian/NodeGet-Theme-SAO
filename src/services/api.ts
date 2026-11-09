import { HttpRequestError, isAccessDeniedError } from "@/services/requestErrors";
import { getThemePublicConfig, loadNodeGetConfig, saveLocalThemeSettings } from "@/services/nodegetConfig";
import type { LoadRecordsResponse, NodeInfo, NodeStatus, PingRecordsResponse, PingTask, PingTaskStats, PublicConfig } from "@/types/models";
import { RATE_DOWN_METRIC, RATE_UP_METRIC, TRAFFIC_DOWN_METRIC, TRAFFIC_UP_METRIC, type TrafficMetricSeries } from "@/utils/trafficStats";
import { withTimeoutSignal } from "@/utils/abort";
import { HistoryScheduler } from "./nodeget/history";
import { inferredInterval, number, row, sourceIdentity, timestamp } from "./nodeget/normalize";
import { downsamplePing, type PingData } from "./nodeget/ping";
import { aborted, NodeGetRpcClient, normalizeBackendUrl, type RequestOptions } from "./nodeget/rpc";
import { downsampleLoad, NodeGetSource, publicError, type SourceStatus } from "./nodeget/source";

export { NodeGetRpcError } from "./nodeget/rpc";
export type { SourceStatus } from "./nodeget/source";
export class ApiRequestError extends HttpRequestError {}

export interface DataIssue { status: "unavailable" | "forbidden" | "partial" | "error"; message: string }
export interface TodayTrafficMetricResponse {
  series: TrafficMetricSeries[];
  rangeStartMs: number;
  rangeEndMs: number;
  intervalSeconds?: number;
  issues?: Record<string, DataIssue>;
}
interface PingOverviewResponse {
  records: PingRecordsResponse["records"];
  tasks: PingTask[];
  stats?: PingTaskStats[];
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
  quality?: "partial";
  message?: string;
  issues?: Record<string, DataIssue>;
}

let sources = new Map<string, NodeGetSource>();
let configSignature = "";
let initialization: Promise<void> | null = null;
let scheduler = new HistoryScheduler();
let sourceStatuses: SourceStatus[] = [];
const sourceListeners = new Set<() => void>();

function publish(status: SourceStatus) {
  const old = sourceStatuses.find(item => item.id === status.id);
  if (old?.name === status.name && old.status === status.status && old.error === status.error) return;
  sourceStatuses = old ? sourceStatuses.map(item => item.id === status.id ? status : item) : [...sourceStatuses, status];
  for (const listener of sourceListeners) listener();
}
export function getSourceStatuses(): SourceStatus[] { return sourceStatuses; }
export function subscribeSourceStatuses(listener: () => void): () => void {
  sourceListeners.add(listener);
  return () => { sourceListeners.delete(listener); };
}

async function ensureSources(options: RequestOptions = {}): Promise<Map<string, NodeGetSource>> {
  aborted(options.signal);
  const config = await loadNodeGetConfig(options);
  const theme = row(config.user_preferences.theme_settings);
  const costsVisible = (theme.showPriceForGuests ?? config.user_preferences.showPriceForGuests) === true;
  const signature = JSON.stringify([config.site_tokens, costsVisible]);
  if (signature !== configSignature) {
    if (initialization) await initialization;
    if (signature !== configSignature) {
      const operation = Promise.resolve().then(() => {
        const entries = config.site_tokens.map(entry => {
          const url = normalizeBackendUrl(entry.backend_url);
          return { entry, url, id: sourceIdentity(url, entry.id) };
        });
        if (new Set(entries.map(item => item.id)).size !== entries.length) throw new Error("重复主控地址需要配置不同的 id");
        for (const source of sources.values()) source.close();
        scheduler.close();
        scheduler = new HistoryScheduler();
        sources = new Map();
        sourceStatuses = [];
        configSignature = signature;
        for (const { id, url, entry } of entries) {
          const name = entry.name?.trim() || new URL(url).hostname;
          publish({ id, name, status: "loading" });
          sources.set(id, new NodeGetSource(id, name, new NodeGetRpcClient(url, entry.token), scheduler, costsVisible, publish));
        }
        if (!entries.length) publish({ id: "unconfigured", name: "NodeGet", status: "unconfigured" });
      });
      initialization = operation;
      try { await operation; } finally { if (initialization === operation) initialization = null; }
    }
  }
  return sources;
}

export function closeNodeGetConnections() {
  for (const source of sources.values()) source.close();
  scheduler.close();
  sources.clear();
  sourceStatuses = [];
  configSignature = "";
  for (const listener of sourceListeners) listener();
}

function resolveNode(uuid: string, available: Map<string, NodeGetSource>): { source: NodeGetSource; uuid: string } {
  const separator = uuid.indexOf("~");
  const source = available.get(uuid.slice(0, separator));
  if (separator < 0 || !source) throw new ApiRequestError("节点所属主控不存在，请刷新节点列表", 404, "node");
  let native: string;
  try { native = decodeURIComponent(uuid.slice(separator + 1)); } catch { throw new Error("节点标识无效"); }
  if (!native) throw new Error("节点标识无效");
  return { source, uuid: native };
}

function range(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 366) throw new Error("历史查询范围无效");
  const rangeEndMs = Math.floor(Date.now() / 15_000) * 15_000;
  return { rangeStartMs: rangeEndMs - hours * 3_600_000, rangeEndMs };
}
function bounded<T>(options: RequestOptions | undefined, operation: (options: RequestOptions) => Promise<T>): Promise<T> {
  return withTimeoutSignal(signal => operation({ ...options, signal }), options?.timeout ?? 45_000, options?.signal);
}
function issue(error: unknown): DataIssue {
  return { status: isAccessDeniedError(error) ? "forbidden" : error instanceof HttpRequestError && error.status === 404 ? "unavailable" : "error", message: publicError(error) };
}

export function getPublic(options?: RequestOptions): Promise<PublicConfig> { return getThemePublicConfig(options); }
export async function saveThemeSettings(_theme: string, settings: Record<string, unknown>): Promise<void> { await saveLocalThemeSettings(settings); }

export async function getNodes(options?: RequestOptions): Promise<NodeInfo[]> {
  const available = await ensureSources(options);
  const list = [...available.values()];
  const results = await Promise.allSettled(list.map(source => source.getNodes(options)));
  aborted(options?.signal);
  const nodes = results.flatMap((result, index) => result.status === "fulfilled" ? result.value : list[index]!.nodes);
  if (list.length && results.every(result => result.status === "rejected") && !nodes.length) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return nodes;
}

export async function getNodesLatestStatus(uuids?: string[], options?: RequestOptions): Promise<Record<string, NodeStatus>> {
  const available = await ensureSources(options);
  const results = await Promise.allSettled([...available.values()].map(async source => {
    const selected = uuids?.filter(uuid => uuid.startsWith(`${source.id}~`)).map(uuid => resolveNode(uuid, available).uuid);
    if (selected && !selected.length) return {};
    return source.latest(selected, options);
  }));
  aborted(options?.signal);
  return Object.assign({}, ...results.flatMap(result => result.status === "fulfilled" ? [result.value] : []));
}

export function getLoadRecords(uuid: string, hours = 6, options?: RequestOptions): Promise<LoadRecordsResponse> {
  return bounded(options, async request => {
    const available = await ensureSources(request);
    const node = resolveNode(uuid, available);
    const requestRange = range(hours);
    const records = downsampleLoad(await node.source.history(node.uuid, requestRange.rangeStartMs, requestRange.rangeEndMs, request));
    return { count: records.length, records, ...requestRange, intervalSeconds: inferredInterval(records) };
  });
}

export function getTodayTrafficMetrics(entityIds: string[], startMs: number, endMs: number, options?: RequestOptions & { includeRates?: boolean }): Promise<TodayTrafficMetricResponse> {
  return bounded(options, async request => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) throw new Error("流量查询范围无效");
    const available = await ensureSources(request);
    const series: TrafficMetricSeries[] = [];
    const issues: Record<string, DataIssue> = {};
    const includeRates = options?.includeRates !== false;
    await Promise.all([...new Set(entityIds)].map(async client => {
      let node: ReturnType<typeof resolveNode>;
      try { node = resolveNode(client, available); } catch (error) { issues[client] = issue(error); return; }
      const [total, history] = await Promise.allSettled([
        node.source.traffic.total(node.uuid, startMs, endMs, request),
        includeRates ? node.source.history(node.uuid, startMs, endMs, request) : Promise.resolve([]),
      ]);
      if (total.status === "fulfilled") {
        const data = total.value;
        for (const [metricKey, value] of [[TRAFFIC_UP_METRIC, data.up], [TRAFFIC_DOWN_METRIC, data.down]] as const) {
          series.push({ metricKey, client, semantics: "interval_delta_v2", quality: data.partial ? "partial" : "ok", points: [{ time: new Date(data.last).toISOString(), value, count: 1 }] });
        }
        if (data.partial) issues[client] = { status: "partial", message: "流量按已有快照统计，覆盖区间可能不完整" };
      } else issues[client] = issue(total.reason);
      if (includeRates && history.status === "fulfilled") {
        for (const [metricKey, field] of [[RATE_UP_METRIC, "net_out"], [RATE_DOWN_METRIC, "net_in"]] as const) {
          const buckets = new Map<number, { time: string; value: number; count: number }>();
          for (const record of history.value) {
            const value = number(record[field]);
            if (!Number.isFinite(value) || value < 0) continue;
            const time = timestamp(record.time);
            const bucket = Math.floor((time - startMs) / 300_000);
            const previous = buckets.get(bucket);
            if (!previous || value > previous.value) buckets.set(bucket, { time: new Date(time).toISOString(), value, count: 1 });
          }
          series.push({ metricKey, client, intervalSeconds: 300, quality: "sampled", points: [...buckets.values()] });
        }
      } else if (history.status === "rejected") issues[client] ??= { ...issue(history.reason), message: "流量合计可用，速率历史读取失败" };
    }));
    aborted(request.signal);
    return { series, rangeStartMs: startMs, rangeEndMs: endMs, intervalSeconds: 300, issues };
  });
}

export async function getPublicPingTasks(options?: RequestOptions): Promise<PingTask[]> {
  const available = await ensureSources(options);
  const results = await Promise.allSettled([...available.values()].map(source => source.discoverTasks(options)));
  aborted(options?.signal);
  const tasks = [...available.values()].flatMap(source => source.ping.tasks());
  const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (!tasks.length && firstFailure) throw firstFailure.reason;
  return tasks;
}
export function getCachedPublicPingTasks(): PingTask[] | null {
  const tasks = [...sources.values()].flatMap(source => source.ping.tasks());
  return tasks.length ? tasks : null;
}

async function queryPing(uuid: string, hours: number, options: RequestOptions): Promise<PingData & { rangeStartMs: number; rangeEndMs: number }> {
  const available = await ensureSources(options);
  const node = resolveNode(uuid, available);
  const requestRange = range(hours);
  const data = await node.source.ping.query(node.uuid, requestRange.rangeStartMs, requestRange.rangeEndMs, options);
  return { ...data, ...requestRange };
}
export function getPingRecords(uuid: string, hours = 6, options?: RequestOptions): Promise<PingRecordsResponse> {
  return bounded(options, async request => {
    const data = await queryPing(uuid, hours, request);
    const sampled = downsamplePing(data.records, data.rangeStartMs, data.rangeEndMs, 500);
    return {
      // 任务从本次记录直接推导，不增加辅助请求。曲线始终需要这些身份来建立 series。
      count: sampled.records.length, ...sampled, tasks: data.tasks,
      rangeStartMs: data.rangeStartMs, rangeEndMs: data.rangeEndMs,
      stats: data.stats,
      ...(data.partial ? { quality: "partial" as const, message: "部分 Ping 类型无法读取，统计仅包含可读任务" } : {}),
    };
  });
}
interface PingOverviewOptions extends RequestOptions {
  entityIds?: string[];
  includeStats?: boolean;
  /** 每次只包含已完成节点的完整区间结果，未完成节点继续保留加载状态。 */
  onProgress?: (overview: PingOverviewResponse, entityIds: string[]) => void;
}

async function queryOverview(hours: number, taskIds: number[] | undefined, options: PingOverviewOptions): Promise<PingOverviewResponse> {
  const available = await ensureSources(options);
  const nodes = await getNodes(options);
  const requestRange = range(hours);
  const selected = nodes.filter(node => !options.entityIds || options.entityIds.includes(node.uuid));
  const data: PingData[] = [];
  const issues: Record<string, DataIssue> = {};
  const response = (entries: PingData[], nodeIssues: Record<string, DataIssue>): PingOverviewResponse => {
    const partial = Object.keys(nodeIssues).length > 0;
    return {
      ...downsamplePing(entries.flatMap(item => item.records), requestRange.rangeStartMs, requestRange.rangeEndMs, 24),
      tasks: [...new Map(entries.flatMap(item => item.tasks).map(task => [task.id, task])).values()],
      stats: entries.flatMap(item => item.stats), ...requestRange, issues: { ...nodeIssues },
      ...(partial ? { quality: "partial" as const, message: "部分主控或 Ping 任务无法读取，统计不完整" } : {}),
    };
  };
  const publish = (client: string, entries: PingData[], nodeIssues: Record<string, DataIssue>) => {
    if (!options.onProgress || options.signal?.aborted) return;
    try { options.onProgress(response(entries, nodeIssues), [client]); }
    catch { /* 展示回调不影响其他节点的请求与最终结果。 */ }
  };
  await Promise.all(selected.map(async node => {
    const { source, uuid } = resolveNode(node.uuid, available);
    try {
      // 冷启动时直接查询所选节点，再按稳定任务身份筛选；不先扫描整个主控。
      const taskId = taskIds?.length === 1 && source.ping.owns(taskIds[0]!) ? taskIds[0] : undefined;
      const result = await source.ping.query(uuid, requestRange.rangeStartMs, requestRange.rangeEndMs, options, taskId);
      if (!taskIds && !result.records.length) result.partial ||= await source.ping.discover(uuid, requestRange.rangeEndMs, options);
      aborted(options.signal);
      const selectedIds = taskIds && new Set(taskIds);
      const knownTasks = source.ping.tasks().filter(task => task.clients.includes(node.uuid) && (!selectedIds || selectedIds.has(task.id)));
      const filtered: PingData = {
        ...result,
        records: result.records.filter(record => !selectedIds || selectedIds.has(record.task_id)),
        stats: result.stats.filter(stat => !selectedIds || selectedIds.has(stat.taskId)),
        tasks: [...new Map([...knownTasks, ...result.tasks.filter(task => !selectedIds || selectedIds.has(task.id))].map(task => [task.id, task])).values()],
      };
      data.push(filtered);
      if (filtered.partial) issues[node.uuid] = { status: "partial", message: "部分 Ping 类型无法读取，统计仅包含可读任务" };
      publish(node.uuid, [filtered], issues[node.uuid] ? { [node.uuid]: issues[node.uuid]! } : {});
    } catch (error) {
      aborted(options.signal);
      issues[node.uuid] = issue(error);
      publish(node.uuid, [], { [node.uuid]: issues[node.uuid]! });
    }
  }));
  aborted(options.signal);
  return response(data, issues);
}
export function getPingOverview(hours = 1, taskId?: number, options?: PingOverviewOptions): Promise<PingOverviewResponse> {
  return bounded(options, request => queryOverview(hours, taskId === undefined ? undefined : [taskId], {
    ...request, entityIds: options?.entityIds, onProgress: options?.onProgress,
  }));
}
export function getPingOverviewStats(hours: number, taskIds: number[], options?: RequestOptions & { entityIds?: string[] }): Promise<PingTaskStats[]> {
  if (!taskIds.length) return Promise.resolve([]);
  return bounded(options, async request => (await queryOverview(hours, [...new Set(taskIds)], { ...request, entityIds: options?.entityIds })).stats ?? []);
}

const warnings = new Set<string>();
export function warnDegradedOnce(key: string, message: string, _details?: Record<string, unknown>) {
  if (warnings.has(key)) return;
  warnings.add(key);
  // 只允许调用点的静态说明，不记录后端响应或连接信息。
  console.warn(`[NodeGet] ${message}`);
}
