import type { LoadRecord, NodeInfo } from "@/types/models";
import { isAccessDeniedError } from "@/services/requestErrors";
import { HistoryScheduler, queryCompleteWindow } from "./history";
import {
  COST_KEYS, DYNAMIC_FIELDS, METADATA_KEYS, globalUuid, loadRecord, metadataByUuid,
  nodeFromData, number, row, rows, text, timestamp, withTrafficDeltas, type Row,
} from "./normalize";
import { PingReader } from "./ping";
import { aborted, NodeGetRpcError, waitFor, type RequestOptions, type RpcCaller } from "./rpc";
import { readExtensionTrafficPeriod, TrafficReader } from "./traffic";

export interface SourceStatus {
  id: string;
  name: string;
  status: "loading" | "connected" | "error" | "unconfigured";
  error?: string;
}

export class NodeGetSource {
  readonly ping: PingReader;
  readonly traffic: TrafficReader;
  nodes: NodeInfo[] = [];
  private uuids: string[] = [];
  private readonly metadata = new Map<string, Row>();
  private dynamics = new Map<string, Row>();
  private dynamicUpdatedAt = 0;
  private nodesUpdatedAt = 0;
  private metadataStatus = "unavailable";
  private nodesPending: Promise<NodeInfo[]> | null = null;
  private dynamicsPending: Promise<Map<string, Row>> | null = null;
  private discoveryPending: Promise<void> | null = null;
  private discoveryUpdatedAt = 0;
  private closed = false;

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly rpc: RpcCaller,
    private readonly scheduler: HistoryScheduler,
    private readonly costsVisible: boolean,
    private readonly update: (status: SourceStatus) => void,
  ) {
    this.ping = new PingReader(id, rpc, scheduler);
    this.traffic = new TrafficReader(rpc, scheduler);
  }

  nativeIds(): string[] { return [...this.uuids]; }

  async getNodes(options: RequestOptions = {}): Promise<NodeInfo[]> {
    aborted(options.signal);
    if (Date.now() - this.nodesUpdatedAt < 25_000) return this.nodes;
    if (!this.nodesPending) {
      const operation = this.loadNodes();
      this.nodesPending = operation;
      void operation.then(
        () => { if (this.nodesPending === operation) this.nodesPending = null; },
        () => { if (this.nodesPending === operation) this.nodesPending = null; },
      );
    }
    return waitFor(this.nodesPending, options);
  }

  private async loadNodes(): Promise<NodeInfo[]> {
    try {
      // 官方公开主题预设授予 NodeGet::ListAllAgentUuid；UUID 管理接口使用不同权限。
      const payload = await this.rpc.call("nodeget-server_list_all_agent_uuid");
      const raw = Array.isArray(payload) ? payload : row(payload).uuids;
      if (!Array.isArray(raw)) throw new Error("主控返回了无效节点列表");
      this.uuids = [...new Set(raw.map(item => typeof item === "string" ? item : text(row(item).uuid)).filter(Boolean))].sort();
      if (!this.uuids.length) {
        this.nodes = [];
        this.nodesUpdatedAt = Date.now();
        this.setStatus("connected");
        return [];
      }
      const namespace_key = this.uuids.flatMap(uuid => [...METADATA_KEYS, ...(this.costsVisible ? COST_KEYS : [])]
        .map(key => ({ namespace: uuid, key })));
      const [staticResult, metadataResult, dynamicResult, expiryResult] = await Promise.allSettled([
        this.rpc.call("agent_static_data_multi_last_query", { uuids: this.uuids, fields: ["cpu", "system"] }),
        this.rpc.call("kv_get_multi_value", { namespace_key }),
        this.loadDynamics(),
        // KV 批次里任一字段无权限会整批失败，到期读取不能影响监控元数据。
        this.rpc.call("kv_get_multi_value", {
          namespace_key: this.uuids.map(namespace => ({ namespace, key: "metadata_expire_time" })),
        }).then(metadataByUuid),
      ]);
      const statics = staticResult.status === "fulfilled" ? new Map(rows(staticResult.value).map(item => [text(item.uuid), item])) : new Map<string, Row>();
      const expiryMetadata = expiryResult.status === "fulfilled" ? expiryResult.value : new Map<string, Row>();
      if (metadataResult.status === "fulfilled") {
        const data = metadataByUuid(metadataResult.value);
        this.metadata.clear();
        for (const [uuid, item] of data) this.metadata.set(uuid, item);
      }
      const statusOf = (result: PromiseSettledResult<unknown>) => result.status === "fulfilled" ? "ready" : isAccessDeniedError(result.reason) ? "forbidden" : "unavailable";
      this.metadataStatus = statusOf(metadataResult);
      const oldNodes = new Map(this.nodes.map(node => [text(node.native_uuid), node]));
      this.nodes = this.uuids.map(uuid => {
        const node = nodeFromData(this.id, this.name, uuid, {
          ...this.metadata.get(uuid),
          metadata_expire_time: expiryMetadata.get(uuid)?.metadata_expire_time,
        }, statics.get(uuid) ?? {}, this.dynamics.get(uuid) ?? {}, {
          metadata: statusOf(metadataResult), static: statusOf(staticResult), costs: this.costsVisible,
        });
        if (staticResult.status === "rejected") {
          const old = oldNodes.get(uuid);
          if (old) for (const key of ["cpu_name", "cpu_cores", "arch", "os", "kernel_version", "virtualization"] as const) Object.assign(node, { [key]: old[key] });
        }
        return node;
      });
      this.nodesUpdatedAt = Date.now();
      if (dynamicResult.status === "rejected") this.setStatus("error", publicError(dynamicResult.reason));
      else this.setStatus("connected");
      return this.nodes;
    } catch (error) {
      this.setStatus("error", publicError(error));
      throw error;
    }
  }

  private async loadDynamics(): Promise<Map<string, Row>> {
    if (Date.now() - this.dynamicUpdatedAt < 1000) return this.dynamics;
    if (!this.dynamicsPending) {
      const operation = this.rpc.call("agent_dynamic_summary_multi_last_query", { uuids: this.uuids, fields: DYNAMIC_FIELDS }).then(payload => {
        this.dynamics = new Map(rows(payload).map(item => [text(item.uuid), item]));
        this.dynamicUpdatedAt = Date.now();
        return this.dynamics;
      });
      this.dynamicsPending = operation;
      void operation.then(
        () => { if (this.dynamicsPending === operation) this.dynamicsPending = null; },
        () => { if (this.dynamicsPending === operation) this.dynamicsPending = null; },
      );
    }
    return this.dynamicsPending;
  }

  async latest(requested?: string[], options: RequestOptions = {}): Promise<Record<string, unknown>> {
    if (!this.nodesUpdatedAt) await this.getNodes(options);
    const ids = requested ?? this.uuids;
    if (!ids.length) return {};
    try {
      const data = await waitFor(this.loadDynamics(), options);
      this.setStatus("connected");
      this.traffic.refreshCurrent(ids);
      const now = Date.now();
      return Object.fromEntries(ids.map(uuid => {
        const key = globalUuid(this.id, uuid);
        const dynamic = data.get(uuid);
        if (!dynamic) return [key, { online: null, data_status: "unavailable", source_id: this.id }];
        const time = timestamp(dynamic.timestamp ?? dynamic.storage_time);
        const missingFields = ["cpu_usage", "used_memory", "total_memory", "total_space", "available_space", "receive_speed", "transmit_speed", "uptime"]
          .filter(field => !Number.isFinite(number(dynamic[field])));
        // 缺少主指标时不把不完整的快照灌进数字 Store，否则默认值会伪造成 0。
        // 保留字段清单供界面解释，之前的有效快照可继续以“数据不完整”状态展示。
        if (!time || missingFields.length) return [key, {
          online: null, data_status: time ? "partial" : "unavailable", source_id: this.id,
          missing_fields: missingFields, updated_at: time,
        }];
        const current = this.traffic.readCurrent(uuid);
        const metadata = this.metadata.get(uuid) ?? {};
        const extension = readExtensionTrafficPeriod(metadata, now);
        const periodStart = extension?.start ?? timestamp(metadata.metadata_traffic_period_start);
        const period = !extension || extension.canReadSnapshots ? this.traffic.readPeriod(uuid, periodStart) : undefined;
        const cycleUsed = extension?.used;
        const cycleAvailable = cycleUsed !== undefined || period !== undefined;
        const cyclePartial = this.metadataStatus !== "ready" || (cycleUsed !== undefined ? extension!.partial : period?.partial);
        const cycleReason = cycleAvailable && this.metadataStatus !== "ready"
          ? "流量配置读取失败，显示上次周期用量"
          : period ? undefined : extension?.reason;
        const value = {
          ...loadRecord(key, dynamic), online: time > 0 ? now - time < 30_000 && time < now + 300_000 : null,
          updated_at: time, source_id: this.id, data_status: time > 0 ? "ready" : "unavailable",
          ...(current && current.updatedAt >= time - 120_000 ? { net_total_up: current.up, net_total_down: current.down } : {}),
          ...(cycleUsed !== undefined ? { traffic_cycle: { used: cycleUsed } } : period ? { traffic_cycle: { up: period.up, down: period.down } } : {}),
          ...(cycleReason ? { traffic_cycle_reason: cycleReason } : {}),
          quality: { traffic_total: current ? "ok" : "counter", traffic_cycle: cycleAvailable ? cyclePartial ? "partial" : "ok" : "unavailable" },
        };
        return [key, value];
      }));
    } catch (error) {
      aborted(options.signal);
      this.setStatus("error", publicError(error));
      return Object.fromEntries(ids.map(uuid => [globalUuid(this.id, uuid), {
        online: null, data_status: isAccessDeniedError(error) ? "forbidden" : "error", source_id: this.id,
      }]));
    }
  }

  async history(uuid: string, start: number, end: number, options: RequestOptions = {}): Promise<LoadRecord[]> {
    const query = async (from: number, to: number) => rows(await this.scheduler.call(this.rpc, "agent_query_dynamic_summary", {
      query: { fields: DYNAMIC_FIELDS, condition: [{ uuid }, { timestamp_from_to: [from, to] }, { limit: 10_000 }] },
    }, options));
    const data = await queryCompleteWindow(start, end, query);
    aborted(options.signal);
    // 只额外读一个前驱点，避免为了首个差值拉取范围之前的大量记录。
    const predecessor = rows(await this.scheduler.call(this.rpc, "agent_query_dynamic_summary", {
      query: { fields: DYNAMIC_FIELDS, condition: [{ uuid }, { timestamp_to: start - 1 }, { limit: 1 }] },
    }, options));
    return withTrafficDeltas(globalUuid(this.id, uuid), [...predecessor, ...data])
      .filter(item => timestamp(item.time) >= start && timestamp(item.time) <= end);
  }

  async discoverTasks(options: RequestOptions = {}): Promise<void> {
    aborted(options.signal);
    if (Date.now() - this.discoveryUpdatedAt < 60_000) return;
    if (!this.discoveryPending) {
      const operation = (async () => {
        await this.getNodes();
        const end = Math.floor(Date.now() / 15_000) * 15_000;
        const results = await Promise.allSettled(this.uuids.map(async uuid => {
          const recent = await this.ping.query(uuid, end - 3_600_000, end);
          if (!recent.records.length) await this.ping.discover(uuid, end);
        }));
        const failure = results.find((item): item is PromiseRejectedResult => item.status === "rejected");
        if (failure && !this.ping.tasks().length) throw failure.reason;
        this.discoveryUpdatedAt = Date.now();
      })();
      this.discoveryPending = operation;
      void operation.then(
        () => { if (this.discoveryPending === operation) this.discoveryPending = null; },
        () => { if (this.discoveryPending === operation) this.discoveryPending = null; },
      );
    }
    return waitFor(this.discoveryPending, options);
  }

  close() { this.closed = true; this.traffic.close(); this.rpc.close(); }

  private setStatus(status: SourceStatus["status"], error?: string) {
    if (!this.closed) this.update({ id: this.id, name: this.name, status, ...(error ? { error } : {}) });
  }
}

export function publicError(error: unknown): string {
  if (isAccessDeniedError(error)) return "没有权限读取主控数据";
  if (error instanceof NodeGetRpcError && error.status === 404) return "暂无数据或尚未配置";
  if (error instanceof Error && error.name === "TimeoutError") return "主控响应超时";
  return "主控连接或数据请求失败";
}

/** 限制曲线规模，同时保留流量增量的和；统计使用原始数据另行完成。 */
export function downsampleLoad(records: LoadRecord[], maximum = 1500): LoadRecord[] {
  if (records.length <= maximum) return records;
  const width = Math.ceil(records.length / maximum);
  const output: LoadRecord[] = [];
  for (let offset = 0; offset < records.length; offset += width) {
    const group = records.slice(offset, offset + width);
    const record = { ...group[group.length - 1]! };
    for (const key of ["cpu", "gpu", "ram", "swap", "load", "disk", "net_in", "net_out", "process", "connections", "connections_udp"] as const) {
      const values = group.map(item => number(item[key])).filter(Number.isFinite);
      record[key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
    }
    for (const key of ["traffic_up", "traffic_down"] as const) {
      const values = group.map(item => number(item[key])).filter(Number.isFinite);
      record[key] = values.length ? values.reduce((sum, value) => sum + value, 0) : Number.NaN;
    }
    output.push(record);
  }
  return output;
}
