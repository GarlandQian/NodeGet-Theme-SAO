import { HttpRequestError, isAccessDeniedError } from "@/services/requestErrors";
import { getThemePublicConfig, loadNodeGetConfig, saveLocalThemeSettings } from "@/services/nodegetConfig";
import type { LoadRecordsResponse, NodeInfo, PingRecordsResponse, PingTask, PingTaskStats, PublicConfig } from "@/types/models";
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

export async function getNodesLatestStatus(uuids?: string[], options?: RequestOptions): Promise<Record<string, unknown>> {
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

export function getTodayTrafficMetrics(entityIds: string[], startMs: number, endMs: number, options?: RequestOptions): Promise<TodayTrafficMetricResponse> {
  return bounded(options, async request => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) throw new Error("流量查询范围无效");
    const available = await ensureSources(request);
    const series: TrafficMetricSeries[] = [];
    const issues: Record<string, DataIssue> = {};
    await Promise.all([...new Set(entityIds)].map(async client => {
      let node: ReturnType<typeof resolveNode>;
      try { node = resolveNode(client, available); } catch (error) { issues[client] = issue(error); return; }
      const [total, history] = await Promise.allSettled([
        node.source.traffic.total(node.uuid, startMs, endMs, request),
        node.source.history(node.uuid, startMs, endMs, request),
      ]);
      if (total.status === "fulfilled") {
        const data = total.value;
        for (const [metricKey, value] of [[TRAFFIC_UP_METRIC, data.up], [TRAFFIC_DOWN_METRIC, data.down]] as const) {
          series.push({ metricKey, client, semantics: "interval_delta_v2", quality: data.partial ? "partial" : "ok", points: [{ time: new Date(data.last).toISOString(), value, count: 1 }] });
        }
        if (data.partial) issues[client] = { status: "partial", message: "流量按已有快照统计，覆盖区间可能不完整" };
      } else issues[client] = issue(total.reason);
      if (history.status === "fulfilled") {
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
      } else issues[client] ??= { ...issue(history.reason), message: "流量合计可用，速率历史读取失败" };
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
async function queryOverview(hours: number, taskIds: number[] | undefined, options: RequestOptions & { entityIds?: string[] }): Promise<PingOverviewResponse> {
  const available = await ensureSources(options);
  const nodes = await getNodes(options);
  if (taskIds?.length) await getPublicPingTasks(options);
  const requestRange = range(hours);
  const selected = nodes.filter(node => !options.entityIds || options.entityIds.includes(node.uuid));
  const jobs = selected.flatMap(node => {
    const { source, uuid } = resolveNode(node.uuid, available);
    const ids = taskIds?.filter(id => source.ping.owns(id));
    if (ids && !ids.length) return [];
    return (ids ?? [undefined]).map(id => ({
      client: node.uuid,
      query: async () => {
        const data = await source.ping.query(uuid, requestRange.rangeStartMs, requestRange.rangeEndMs, options, id);
        // NodeGet 的计划任务身份来自执行记录。首页默认无需手工绑定；当最近窗口为空，
        // 只用一天内的记录发现任务，旧记录不能充当当前窗口的延迟或丢包样本。
        if (id === undefined && !data.records.length) {
          const discovered = await source.ping.query(uuid, requestRange.rangeEndMs - 86_400_000, requestRange.rangeEndMs, options);
          data.partial ||= discovered.partial;
        }
        const knownTasks = source.ping.tasks().filter(task => task.clients.includes(node.uuid) && (id === undefined || task.id === id));
        return { ...data, tasks: [...new Map([...knownTasks, ...data.tasks].map(task => [task.id, task])).values()] };
      },
    }));
  });
  const results = await Promise.allSettled(jobs.map(job => job.query()));
  aborted(options.signal);
  const data: PingData[] = [];
  const issues: Record<string, DataIssue> = {};
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]!;
    const client = jobs[index]!.client;
    if (result.status === "rejected") {
      issues[client] = issue(result.reason);
    } else {
      data.push(result.value);
      if (result.value.partial && !issues[client]) issues[client] = { status: "partial", message: "部分 Ping 类型无法读取，统计仅包含可读任务" };
    }
  }
  const partial = Object.keys(issues).length > 0;
  const tasks = [...new Map(data.flatMap(item => item.tasks).map(task => [task.id, task])).values()];
  return {
    ...downsamplePing(data.flatMap(item => item.records), requestRange.rangeStartMs, requestRange.rangeEndMs, 24),
    tasks, stats: data.flatMap(item => item.stats), ...requestRange, issues,
    ...(partial ? { quality: "partial" as const, message: "部分主控或 Ping 任务无法读取，统计不完整" } : {}),
  };
}
export function getPingOverview(hours = 1, taskId?: number, options?: RequestOptions & { entityIds?: string[]; includeStats?: boolean }): Promise<PingOverviewResponse> {
  return bounded(options, request => queryOverview(hours, taskId === undefined ? undefined : [taskId], { ...request, entityIds: options?.entityIds }));
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
