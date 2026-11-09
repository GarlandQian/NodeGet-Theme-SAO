import { NodeInfoSchema, type LoadRecord, type NodeInfo, type NodeMetricSnapshot } from "@/types/models";

export type Row = Record<string, unknown>;
export const DYNAMIC_FIELDS = [
  "cpu_usage", "gpu_usage", "used_swap", "total_swap", "used_memory", "total_memory",
  "load_one", "load_five", "load_fifteen", "uptime", "process_count", "total_space",
  "available_space", "tcp_connections", "udp_connections", "total_received", "total_transmitted",
  "transmit_speed", "receive_speed",
];
export const METADATA_KEYS = [
  "metadata_name", "metadata_region", "metadata_provider", "metadata_city", "metadata_country", "metadata_asn",
  "metadata_public_remark", "metadata_tags", "metadata_hidden", "metadata_order", "metadata_group",
  "metadata_traffic_limit", "metadata_traffic_limit_type", "metadata_billing_mode", "metadata_traffic_period",
  "metadata_traffic_period_start", "metadata_traffic_used",
];
export const COST_KEYS = ["metadata_price", "metadata_price_unit", "metadata_price_cycle"];

export function row(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("主控返回了无效的数据列表");
  return value.map(row);
}
export function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function text(value: unknown, fallback = ""): string {
  const result = decoded(value);
  return typeof result === "string" || typeof result === "number" ? String(result) : fallback;
}
export function number(value: unknown, fallback = Number.NaN): number {
  const result = decoded(value);
  if (result == null || result === "" || typeof result === "boolean") return fallback;
  const parsed = Number(result);
  return Number.isFinite(parsed) ? parsed : fallback;
}
export function boolean(value: unknown): boolean {
  const result = decoded(value);
  return result === true || result === 1 || result === "true" || result === "1";
}
export function timestamp(value: unknown): number {
  const numeric = number(value);
  if (Number.isFinite(numeric)) return numeric > 0 ? (numeric < 1e12 ? numeric * 1000 : numeric) : 0;
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}

/** 53 位稳定 ID；任务顺序、主控排列、Token 轮换不会改变身份。 */
export function stableId(value: string): number {
  let left = 0xdeadbeef;
  let right = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    left = Math.imul(left ^ value.charCodeAt(i), 2654435761);
    right = Math.imul(right ^ value.charCodeAt(i), 1597334677);
  }
  left = Math.imul(left ^ (left >>> 16), 2246822507) ^ Math.imul(right ^ (right >>> 13), 3266489909);
  right = Math.imul(right ^ (right >>> 16), 2246822507) ^ Math.imul(left ^ (left >>> 13), 3266489909);
  return (4294967296 * (2097151 & right) + (left >>> 0)) || 1;
}
export function sourceIdentity(url: string, explicit?: string): string {
  return `s-${stableId(explicit ? `id:${explicit}` : `url:${url}`).toString(36)}`;
}
export function globalUuid(source: string, uuid: string): string { return `${source}~${encodeURIComponent(uuid)}`; }

export function metadataByUuid(payload: unknown): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const item of rows(payload)) {
    const namespace = text(item.namespace);
    const key = text(item.key);
    if (!namespace || !key) continue;
    const map = result.get(namespace) ?? {};
    map[key] = decoded(item.value);
    result.set(namespace, map);
  }
  return result;
}

export function nodeFromData(
  sourceId: string, sourceName: string, uuid: string, metadata: Row, staticData: Row, dynamic: Row,
  statuses: { metadata: string; static: string; costs: boolean },
): NodeInfo {
  const cpu = row(staticData.cpu);
  const system = row(staticData.system);
  const billingMode = text(metadata.metadata_billing_mode).toLowerCase();
  const period = text(metadata.metadata_traffic_period).toLowerCase();
  const extension = ["quota", "payg"].includes(billingMode) && ["hourly", "daily", "weekly", "monthly", "never"].includes(period);
  const tags = decoded(metadata.metadata_tags);
  const price = statuses.costs ? number(metadata.metadata_price) : Number.NaN;
  // 到期日期独立于金额公开开关；字段是否可读仍由 NodeGet Token 权限决定。
  const expires = new Date(timestamp(metadata.metadata_expire_time));
  const rawLimit = Math.max(0, number(metadata.metadata_traffic_limit, 0));
  const trafficLimit = extension ? billingMode === "payg" || period === "never" ? 0 : rawLimit * 1024 ** 3 : rawLimit;
  return NodeInfoSchema.parse({
    uuid: globalUuid(sourceId, uuid), native_uuid: uuid, source_id: sourceId, source_name: sourceName,
    name: text(metadata.metadata_name, uuid.slice(0, 8)),
    group: text(metadata.metadata_group), region: text(metadata.metadata_region, text(metadata.metadata_country)),
    country: text(metadata.metadata_country), provider: text(metadata.metadata_provider), city: text(metadata.metadata_city),
    asn: text(metadata.metadata_asn), public_remark: text(metadata.metadata_public_remark),
    hidden: boolean(metadata.metadata_hidden), weight: number(metadata.metadata_order, 0),
    tags: Array.isArray(tags) ? tags.map(value => text(value)).filter(Boolean).join(";") : text(tags).replaceAll(",", ";"),
    cpu_name: text(cpu.brand, text(row(Array.isArray(cpu.per_core) ? cpu.per_core[0] : undefined).brand)),
    cpu_cores: number(cpu.logical_cores, number(cpu.physical_cores, Array.isArray(cpu.per_core) ? cpu.per_core.length : 0)),
    arch: text(system.system_arch, text(system.arch)), virtualization: text(system.virtualization),
    os: text(system.system_os_long_version, text(system.system_name, text(system.system_os_version))),
    kernel_version: text(system.system_kernel_version, text(system.system_kernel)),
    mem_total: number(dynamic.total_memory, 0), swap_total: number(dynamic.total_swap, 0), disk_total: number(dynamic.total_space, 0),
    price: Number.isFinite(price) ? price : 0, price_configured: Number.isFinite(price),
    currency: statuses.costs ? text(metadata.metadata_price_unit) : "",
    billing_cycle: statuses.costs ? text(metadata.metadata_price_cycle) : "",
    expired_at: expires.getTime() > 0 ? expires.toISOString() : "",
    traffic_limit: trafficLimit, traffic_limit_type: extension ? "sum" : text(metadata.metadata_traffic_limit_type, "sum"),
    ...(extension ? { traffic_billing_mode: billingMode, traffic_period: period } : {}),
    metadata_status: statuses.metadata, static_status: statuses.static,
  });
}

/** 实时读数直接进入展示模型，不经过历史记录或其他探针的数据结构。 */
export function metricsFromData(dynamic: Row): NodeMetricSnapshot {
  const ramUsed = number(dynamic.used_memory, 0);
  const ramTotal = number(dynamic.total_memory, 0);
  const diskTotal = number(dynamic.total_space, 0);
  const diskUsed = diskTotal - number(dynamic.available_space, 0);
  return {
    cpuPct: number(dynamic.cpu_usage, 0),
    ramUsed, ramTotal, ramPct: ramTotal > 0 ? ramUsed / ramTotal * 100 : 0,
    swapUsed: number(dynamic.used_swap, 0), swapTotal: number(dynamic.total_swap),
    diskUsed, diskTotal, diskPct: diskTotal > 0 ? diskUsed / diskTotal * 100 : 0,
    netUp: number(dynamic.transmit_speed, 0), netDown: number(dynamic.receive_speed, 0),
    trafficUp: number(dynamic.total_transmitted), trafficDown: number(dynamic.total_received),
    cycleUp: null, cycleDown: null, cycleUsed: null,
    uptime: number(dynamic.uptime, 0),
    load1: number(dynamic.load_one, 0), load5: number(dynamic.load_five, 0), load15: number(dynamic.load_fifteen, 0),
    process: number(dynamic.process_count, 0),
    connectionsTcp: number(dynamic.tcp_connections, 0), connectionsUdp: number(dynamic.udp_connections, 0),
    updatedAt: timestamp(dynamic.timestamp ?? dynamic.storage_time),
  };
}

export function loadRecord(client: string, dynamic: Row): LoadRecord {
  const diskTotal = number(dynamic.total_space);
  return {
    client, time: new Date(timestamp(dynamic.timestamp ?? dynamic.storage_time)).toISOString(),
    cpu: number(dynamic.cpu_usage), gpu: number(dynamic.gpu_usage),
    ram: number(dynamic.used_memory), ram_total: number(dynamic.total_memory),
    swap: number(dynamic.used_swap), swap_total: number(dynamic.total_swap),
    load: number(dynamic.load_one), load5: number(dynamic.load_five), load15: number(dynamic.load_fifteen),
    temp: Number.NaN, disk: diskTotal - number(dynamic.available_space), disk_total: diskTotal,
    net_in: number(dynamic.receive_speed), net_out: number(dynamic.transmit_speed),
    net_total_up: number(dynamic.total_transmitted), net_total_down: number(dynamic.total_received),
    process: number(dynamic.process_count), connections: number(dynamic.tcp_connections) + number(dynamic.udp_connections),
    connections_tcp: number(dynamic.tcp_connections), connections_udp: number(dynamic.udp_connections),
    uptime: number(dynamic.uptime),
  };
}

export function withTrafficDeltas(client: string, data: Row[]): LoadRecord[] {
  const unique = new Map<number, Row>();
  for (const item of data) {
    const time = timestamp(item.timestamp ?? item.storage_time);
    if (time > 0) unique.set(time, item);
  }
  let previous: Row | undefined;
  return [...unique].sort(([a], [b]) => a - b).map(([, item]) => {
    const record = loadRecord(client, item);
    const valid = previous && number(item.uptime) >= number(previous.uptime);
    const up = valid && previous ? number(item.total_transmitted) - number(previous.total_transmitted) : Number.NaN;
    const down = valid && previous ? number(item.total_received) - number(previous.total_received) : Number.NaN;
    record.traffic_up = up >= 0 ? up : Number.NaN;
    record.traffic_down = down >= 0 ? down : Number.NaN;
    previous = item;
    return record;
  });
}

export function inferredInterval(data: Array<{ time: string | number }>, fallback = 60): number {
  const times = [...new Set(data.map(item => timestamp(item.time)))].sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, i) => time - times[i]!).filter(gap => gap > 0).sort((a, b) => a - b);
  return gaps.length ? Math.max(1, gaps[Math.floor(gaps.length / 2)]! / 1000) : fallback;
}
