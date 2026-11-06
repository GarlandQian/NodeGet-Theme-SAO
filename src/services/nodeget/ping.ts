import type { PingRecord, PingTask, PingTaskStats } from "@/types/models";
import { HistoryScheduler, queryCompleteWindow } from "./history";
import { globalUuid, inferredInterval, number, row, rows, stableId, text, timestamp, type Row } from "./normalize";
import { aborted, type RequestOptions, type RpcCaller } from "./rpc";

interface Identity { id: number; type: "ping" | "tcp_ping"; name: string; target: string; cron?: string }
export interface PingData { records: PingRecord[]; tasks: PingTask[]; stats: PingTaskStats[]; partial: boolean }

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const index = (values.length - 1) * p;
  const lo = Math.floor(index);
  return values[lo]! + (values[Math.ceil(index)]! - values[lo]!) * (index - lo);
}

export function pingStats(records: PingRecord[], tasks: PingTask[]): PingTaskStats[] {
  const groups = new Map<string, PingRecord[]>();
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  for (const record of records) {
    const key = `${record.client}:${record.task_id}`;
    const group = groups.get(key) ?? [];
    group.push(record); groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    group.sort((a, b) => timestamp(a.time) - timestamp(b.time));
    const first = group[0]!;
    const task = taskMap.get(first.task_id);
    const values = group.map(item => item.value).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const p50 = percentile(values, 0.5);
    const p99 = percentile(values, 0.99);
    const last = group[group.length - 1]!.value;
    return {
      client: first.client, taskId: first.task_id, name: task?.name ?? "Ping", type: task?.type ?? "icmp",
      interval: inferredInterval(group), total: group.length, valid: values.length,
      loss: (group.length - values.length) / group.length * 100,
      min: values[0] ?? null, max: values[values.length - 1] ?? null, avg,
      latest: last >= 0 ? last : null, p50, p99,
      stddev: avg !== null ? Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length) : null,
      p99P50Ratio: p50 && p99 != null ? p99 / p50 : 0,
    };
  });
}

/** 图表按时间桶聚合，保留真实 count/loss；区间统计使用聚合前记录。 */
export function downsamplePing(records: PingRecord[], start: number, end: number, maxPoints: number): { records: PingRecord[]; intervalSeconds: number } {
  const width = Math.max(1000, Math.ceil((end - start + 1) / Math.max(1, maxPoints)));
  const groups = new Map<string, PingRecord[]>();
  for (const record of records) {
    const index = Math.floor((timestamp(record.time) - start) / width);
    const key = `${record.client}:${record.task_id}:${index}`;
    const group = groups.get(key) ?? [];
    group.push(record); groups.set(key, group);
  }
  return {
    intervalSeconds: width / 1000,
    records: [...groups.values()].map(group => {
      const valid = group.filter(record => record.value >= 0);
      // 展示层用 intervalSeconds 展开聚合窗口，时间必须对应桶起点。
      const time = start + Math.floor((timestamp(group[0]!.time) - start) / width) * width;
      return {
        ...group[0]!, time: new Date(time).toISOString(), count: group.length,
        value: valid.length ? valid.reduce((sum, record) => sum + record.value, 0) / valid.length : -1,
        loss: (group.length - valid.length) / group.length * 100,
      };
    }).sort((a, b) => timestamp(a.time) - timestamp(b.time)),
  };
}

export class PingReader {
  private readonly identities = new Map<number, Identity>();
  private readonly taskClients = new Map<number, Set<string>>();

  constructor(private readonly source: string, private readonly rpc: RpcCaller, private readonly scheduler: HistoryScheduler) {}

  tasks(): PingTask[] {
    return [...this.identities.values()].map(identity => ({
      id: identity.id, name: identity.name, target: identity.target,
      type: identity.type === "tcp_ping" ? "tcp" : "icmp", interval: 60, loss: 0, weight: 0,
      clients: [...this.taskClients.get(identity.id) ?? []],
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  owns(taskId: number): boolean { return this.identities.has(taskId); }

  async query(uuid: string, start: number, end: number, options: RequestOptions = {}, taskId?: number): Promise<PingData> {
    const identity = taskId === undefined ? undefined : this.identities.get(taskId);
    if (taskId !== undefined && !identity) return { records: [], tasks: [], stats: [], partial: false };
    const types: Array<Identity["type"]> = identity ? [identity.type] : ["ping", "tcp_ping"];
    const responses = await Promise.allSettled(types.map(async type => {
      const conditions: Row[] = [{ uuid }, { type }];
      if (identity?.cron) conditions.push({ cron_source: identity.cron });
      const payload = await queryCompleteWindow(start, end, async (from, to) => {
        aborted(options.signal);
        return rows(await this.scheduler.call(this.rpc, "task_query", {
          task_data_query: { condition: [...conditions, { timestamp_from_to: [from, to] }, { limit: 10_000 }] },
        }, options));
      });
      return this.parseRows(uuid, payload, type, start, end).filter(record => taskId === undefined || record.task_id === taskId);
    }));
    aborted(options.signal);
    const successful = responses.filter((result): result is PromiseFulfilledResult<PingRecord[]> => result.status === "fulfilled");
    const failures = responses.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (!successful.length || (!successful.some(result => result.value.length) && failures.length)) throw failures[0]?.reason ?? new Error("Ping 查询失败");
    const records = successful.flatMap(result => result.value).sort((a, b) => timestamp(a.time) - timestamp(b.time));
    const taskIds = new Set(records.map(record => record.task_id));
    const tasks = this.tasks().filter(task => taskIds.has(task.id)).map(task => ({
      ...task, interval: inferredInterval(records.filter(record => record.task_id === task.id)),
    }));
    return { records, tasks, stats: pingStats(records, tasks), partial: failures.length > 0 };
  }

  private parseRows(uuid: string, data: Row[], requestedType: Identity["type"], start: number, end: number): PingRecord[] {
    const result = new Map<string, PingRecord>();
    for (const item of data) {
      if (item.uuid !== uuid) continue;
      const time = timestamp(item.timestamp ?? item.storage_time);
      if (!time || time < start || time > end) continue;
      const payload = row(item.task_event_result);
      const event = row(item.task_event_type);
      const type: Identity["type"] = Object.hasOwn(payload, "tcp_ping") || Object.hasOwn(event, "tcp_ping") ? "tcp_ping" : requestedType;
      const latency = number(payload[type]);
      const failed = item.success === false;
      if (!failed && !Number.isFinite(latency)) continue;
      const target = text(event[type]);
      const cron = text(item.cron_source);
      const name = cron || text(item.task_name) || target || type;
      // 非计划任务用目标区分；运行记录的 task_id 不是计划任务身份。
      const id = stableId(`${this.source}\0${type}\0${cron ? `cron:${cron}` : `target:${target || name}`}`);
      const existing = this.identities.get(id);
      if (existing && (existing.name !== name || existing.type !== type)) throw new Error("Ping 任务身份冲突");
      this.identities.set(id, { id, name, type, target, ...(cron ? { cron } : {}) });
      const client = globalUuid(this.source, uuid);
      const clients = this.taskClients.get(id) ?? new Set<string>();
      clients.add(client); this.taskClients.set(id, clients);
      // task_id 只用于去重同一返回记录，防止同毫秒多次执行丢失样本。
      const runId = text(item.task_id, `${time}`);
      result.set(`${id}:${time}:${runId}`, {
        client, task_id: id, time: new Date(time).toISOString(), value: !failed && latency >= 0 ? latency : -1,
      });
    }
    return [...result.values()];
  }
}
