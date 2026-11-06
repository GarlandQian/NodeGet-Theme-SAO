import { HistoryScheduler } from "./history";
import { number, row, rows, timestamp, type Row } from "./normalize";
import { NodeGetRpcError, type RequestOptions, type RpcCaller } from "./rpc";

export interface TrafficTotal {
  up: number;
  down: number;
  first: number;
  last: number;
  partial: boolean;
}

function count(value: unknown): number {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("主控返回了无效流量数据");
  return parsed;
}

export function parseTrafficTotal(payload: unknown, uuid: string, start: number, end: number, modern: boolean): TrafficTotal {
  const value = row(payload);
  if (value.uuid !== uuid) throw new Error("流量响应与节点不匹配");
  const interfaces = rows(value.interfaces);
  if (!interfaces.length) throw new NodeGetRpcError(105, "traffic");
  let up = 0;
  let down = 0;
  let first = start;
  let last = end;
  const names = new Set<string>();
  for (const network of interfaces) {
    if (typeof network.interface_name !== "string" || names.has(network.interface_name)) throw new Error("无效的网卡流量响应");
    names.add(network.interface_name);
    up = count(up + count(network.transmitted));
    down = count(down + count(network.received));
    if (modern) {
      const earliest = timestamp(network.first_snapshot_time);
      const latest = timestamp(network.last_snapshot_time);
      if (!earliest || latest <= earliest || earliest < start || latest > end) throw new Error("无效的流量快照区间");
      first = Math.max(first, earliest);
      last = Math.min(last, latest);
    }
  }
  if (count(value.transmitted) !== up || count(value.received) !== down) throw new Error("网卡流量合计不一致");
  return {
    up, down, first, last,
    partial: !Array.isArray(value.possible_data_losses) || value.possible_data_losses.length > 0 ||
      (modern && (first > start || last < end)),
  };
}

export function parseCurrentTraffic(payload: unknown): Map<string, { up: number; down: number; updatedAt: number }> {
  const output = new Map<string, { up: number; down: number; updatedAt: number }>();
  for (const node of rows(payload)) {
    if (typeof node.uuid !== "string") continue;
    const interfaces = rows(node.interfaces);
    if (!interfaces.length) continue;
    let up = 0;
    let down = 0;
    let updatedAt = Infinity;
    const names = new Set<string>();
    for (const network of interfaces) {
      if (typeof network.interface_name !== "string" || names.has(network.interface_name)) throw new Error("无效的网卡流量响应");
      names.add(network.interface_name);
      up = count(up + count(network.total_transmitted));
      down = count(down + count(network.total_received));
      updatedAt = Math.min(updatedAt, timestamp(network.updated_at));
    }
    if (updatedAt > 0) output.set(node.uuid, { up, down, updatedAt });
  }
  return output;
}

export class TrafficReader {
  private version: "modern" | "legacy" | undefined;
  private readonly current = new Map<string, { up: number; down: number; updatedAt: number }>();
  private currentRefresh = 0;
  private currentPending = false;
  private closed = false;
  private readonly periods = new Map<string, { value?: TrafficTotal; refresh: number; pending: boolean }>();

  constructor(private readonly rpc: RpcCaller, private readonly scheduler: HistoryScheduler) {}

  async total(uuid: string, start: number, end: number, options?: RequestOptions): Promise<TrafficTotal> {
    const query: Row = { uuid, start_time: start, end_time: end };
    let payload: unknown;
    if (this.version !== "legacy") {
      try {
        payload = await this.scheduler.call(this.rpc, "agent_query_traffic_total", { query }, options);
        this.version = "modern";
      } catch (error) {
        if (!(error instanceof NodeGetRpcError) || error.code !== -32601) throw error;
        this.version = "legacy";
      }
    }
    if (this.version === "legacy") {
      payload = await this.scheduler.call(this.rpc, "agent_query_traffic", { query: { ...query, granularity: "total" } }, options);
      // 0.6.0 totals 本身没有快照覆盖区间；必须同时确认快照真实存在。
      const range = row(await this.scheduler.call(this.rpc, "agent_query_traffic", {
        query: { uuid, granularity: "range" },
      }, options));
      const interfaces = rows(range.interfaces);
      if (!interfaces.length || interfaces.some(item => timestamp(item.first_snapshot_time) > start || timestamp(item.last_snapshot_time) < start)) {
        throw new NodeGetRpcError(105, "agent_query_traffic");
      }
    }
    const total = parseTrafficTotal(payload, uuid, start, end, this.version === "modern");
    if (this.version === "legacy") {
      // 老版只保证开始快照存在，结束可能不是精确边界，保守标记快照统计。
      total.partial = true;
    }
    return total;
  }

  refreshCurrent(uuids: string[]) {
    if (this.closed || this.currentPending || Date.now() < this.currentRefresh || !uuids.length) return;
    this.currentPending = true;
    this.currentRefresh = Date.now() + 15_000;
    void this.rpc.call("agent_query_traffic_current", { uuids }, { timeout: 6_000 }).then(payload => {
      if (this.closed) return;
      const parsed = parseCurrentTraffic(payload);
      this.current.clear();
      for (const [uuid, value] of parsed) this.current.set(uuid, value);
    }).catch(() => { this.currentRefresh = Date.now() + 60_000; }).finally(() => { this.currentPending = false; });
  }

  readCurrent(uuid: string) {
    const value = this.current.get(uuid);
    return value && Date.now() - value.updatedAt < 120_000 ? value : undefined;
  }

  readPeriod(uuid: string, start: number): TrafficTotal | undefined {
    if (this.closed || start <= 0 || start >= Date.now()) return undefined;
    const key = `${uuid}:${start}`;
    const entry = this.periods.get(key) ?? { refresh: 0, pending: false };
    this.periods.set(key, entry);
    if (!entry.pending && Date.now() >= entry.refresh) {
      entry.pending = true;
      entry.refresh = Date.now() + 60_000;
      void this.total(uuid, start, Math.floor(Date.now() / 15_000) * 15_000).then(value => {
        if (!this.closed) entry.value = value;
      }).catch(() => { entry.value = undefined; }).finally(() => { entry.pending = false; });
    }
    while (this.periods.size > 256) this.periods.delete(this.periods.keys().next().value!);
    return entry.value;
  }

  close() { this.closed = true; this.current.clear(); this.periods.clear(); }
}
