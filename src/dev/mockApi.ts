import type { NodeInfo } from "@/types/models";

const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

function dateAfter(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

const BASE_NODES: NodeInfo[] = [
  {
    uuid: "tokyo-edge-01",
    name: "Tokyo Edge",
    group: "生产",
    region: "JP",
    hidden: false,
    cpu_name: "AMD EPYC 7B13",
    cpu_cores: 4,
    arch: "x86_64",
    virtualization: "KVM",
    os: "debian",
    kernel_version: "6.1.0",
    gpu_name: "",
    mem_total: 8 * GIB,
    swap_total: 2 * GIB,
    disk_total: 160 * GIB,
    weight: 10,
    price: 48,
    billing_cycle: "month",
    auto_renewal: true,
    currency: "CNY",
    expired_at: dateAfter(24),
    tags: "边缘<Cyan>; 高带宽<Teal>; 优选<Ruby>",
    public_remark: "东京入口与静态资源",
    traffic_limit: 4 * TIB,
    traffic_limit_type: "sum",
    ipv4: "203.0.113.11",
    ipv6: "2001:db8::11",
    created_at: dateAfter(-420),
    updated_at: new Date().toISOString(),
  },
  {
    uuid: "singapore-api-01",
    name: "Singapore API",
    group: "生产",
    region: "SG",
    hidden: false,
    cpu_name: "Intel Xeon Gold 6338",
    cpu_cores: 8,
    arch: "x86_64",
    virtualization: "KVM",
    os: "ubuntu",
    kernel_version: "6.8.0",
    gpu_name: "",
    mem_total: 16 * GIB,
    swap_total: 4 * GIB,
    disk_total: 240 * GIB,
    weight: 20,
    price: 18,
    billing_cycle: "month",
    auto_renewal: true,
    currency: "USD",
    expired_at: dateAfter(12),
    tags: "API<Blue>; 核心<Crimson>; 高可用<Jade>",
    public_remark: "东南亚 API 集群",
    traffic_limit: 6 * TIB,
    traffic_limit_type: "sum",
    ipv4: "203.0.113.21",
    ipv6: "2001:db8::21",
    created_at: dateAfter(-310),
    updated_at: new Date().toISOString(),
  },
  {
    uuid: "frankfurt-db-01",
    name: "Frankfurt DB",
    group: "生产",
    region: "DE",
    hidden: false,
    cpu_name: "AMD EPYC 7763",
    cpu_cores: 12,
    arch: "x86_64",
    virtualization: "KVM",
    os: "alma",
    kernel_version: "5.14.0",
    gpu_name: "",
    mem_total: 32 * GIB,
    swap_total: 8 * GIB,
    disk_total: 480 * GIB,
    weight: 30,
    price: 34,
    billing_cycle: "month",
    auto_renewal: false,
    currency: "EUR",
    expired_at: dateAfter(3),
    tags: "数据库<Amber>; 临期<Tomato>; 欧洲<Grass>",
    public_remark: "主数据库副本",
    traffic_limit: 8 * TIB,
    traffic_limit_type: "sum",
    ipv4: "203.0.113.31",
    ipv6: "2001:db8::31",
    created_at: dateAfter(-260),
    updated_at: new Date().toISOString(),
  },
  {
    uuid: "new-york-worker-01",
    name: "New York Worker",
    group: "生产",
    region: "US",
    hidden: false,
    cpu_name: "Intel Xeon Platinum 8370C",
    cpu_cores: 8,
    arch: "x86_64",
    virtualization: "KVM",
    os: "rocky",
    kernel_version: "5.14.0",
    gpu_name: "",
    mem_total: 16 * GIB,
    swap_total: 4 * GIB,
    disk_total: 320 * GIB,
    weight: 40,
    price: 22,
    billing_cycle: "month",
    auto_renewal: true,
    currency: "USD",
    expired_at: dateAfter(46),
    tags: "队列<Pink>; 异步<Lime>; 美东<Sky>",
    public_remark: "北美异步任务",
    traffic_limit: 5 * TIB,
    traffic_limit_type: "sum",
    ipv4: "203.0.113.41",
    ipv6: "2001:db8::41",
    created_at: dateAfter(-180),
    updated_at: new Date().toISOString(),
  },
  {
    uuid: "hong-kong-cache-01",
    name: "Hong Kong Cache",
    group: "边缘",
    region: "HK",
    hidden: false,
    cpu_name: "AMD EPYC 7543P",
    cpu_cores: 4,
    arch: "x86_64",
    virtualization: "KVM",
    os: "alpine",
    kernel_version: "6.6.12",
    gpu_name: "",
    mem_total: 6 * GIB,
    swap_total: 2 * GIB,
    disk_total: 120 * GIB,
    weight: 50,
    price: 68,
    billing_cycle: "quarter",
    auto_renewal: true,
    currency: "CNY",
    expired_at: dateAfter(61),
    tags: "缓存<Gold>; 极速<Mint>; BGP<Plum>; 亚太<Iris>",
    public_remark: "香港缓存层",
    traffic_limit: 3 * TIB,
    traffic_limit_type: "sum",
    ipv4: "203.0.113.51",
    ipv6: "2001:db8::51",
    created_at: dateAfter(-150),
    updated_at: new Date().toISOString(),
  },
  {
    uuid: "sydney-backup-01",
    name: "Sydney Backup",
    group: "备份",
    region: "AU",
    hidden: false,
    cpu_name: "Ampere Altra",
    cpu_cores: 4,
    arch: "aarch64",
    virtualization: "KVM",
    os: "ubuntu",
    kernel_version: "6.8.0",
    gpu_name: "",
    mem_total: 8 * GIB,
    swap_total: 2 * GIB,
    disk_total: 640 * GIB,
    weight: 60,
    price: 14,
    billing_cycle: "month",
    auto_renewal: false,
    currency: "USD",
    expired_at: dateAfter(19),
    tags: "冷备<Bronze>; 归档<Brown>; 离线<Slate>",
    public_remark: "离线备份节点",
    traffic_limit: 2 * TIB,
    traffic_limit_type: "sum",
    ipv4: "203.0.113.61",
    ipv6: "2001:db8::61",
    created_at: dateAfter(-120),
    updated_at: new Date().toISOString(),
  },
];

type Row = Record<string, unknown>;
type MockSource = { id: string; name: string; url: string; nodes: NodeInfo[] };
type RpcRequest = { id?: number | string; method?: string; params?: Row };

function object(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

export function getMockParameters(location: { search: string; hash?: string }) {
  const parameters = new URLSearchParams(location.search);
  const hashQuery = location.hash?.split("?")[1];
  if (hashQuery) new URLSearchParams(hashQuery).forEach((value, key) => parameters.set(key, value));
  return parameters;
}

function fixtureNodes(parameters: URLSearchParams): NodeInfo[] {
  let storedCount = 0;
  try { storedCount = Number(sessionStorage.getItem("nodeget-sao:dev-nodes")) || 0; } catch { /* 测试环境可能没有浏览器存储。 */ }
  const count = Math.min(500, Math.max(6, Number(parameters.get("nodes")) || storedCount || 6));
  const regions = ["NL", "GB", "FR", "KR", "CA", "TW", "SE", "CH", "IN", "BR", "RU", "ZA"];
  return Array.from({ length: count }, (_, index) => {
    const template = BASE_NODES[index % BASE_NODES.length]!;
    return index < BASE_NODES.length ? { ...template } : {
      ...template,
      uuid: `${template.uuid}-sub-${Math.floor(index / BASE_NODES.length) + 1}`,
      name: `${template.name} #${Math.floor(index / BASE_NODES.length) + 1}`,
      region: regions[(index - BASE_NODES.length) % regions.length]!,
      weight: index * 10,
    };
  });
}

function cycleDays(value: string): number {
  return value === "quarter" ? 90 : value === "year" ? 365 : 30;
}

function metadata(node: NodeInfo): Row {
  return {
    metadata_name: node.name,
    metadata_region: node.region,
    metadata_country: node.region,
    metadata_provider: "演示节点",
    metadata_city: "",
    metadata_public_remark: node.public_remark,
    metadata_tags: node.tags.split(";").map(tag => tag.trim()),
    metadata_hidden: false,
    metadata_order: node.weight,
    metadata_group: node.group,
    metadata_price: node.price,
    metadata_price_unit: node.currency,
    metadata_price_cycle: cycleDays(node.billing_cycle),
    metadata_expire_time: Date.parse(node.expired_at),
    // 基础配额约定使用字节，不混用扩展协议中的 GiB。
    metadata_traffic_limit: node.traffic_limit,
    metadata_traffic_limit_type: node.traffic_limit_type,
    metadata_traffic_period_start: new Date().setHours(0, 0, 0, 0),
  };
}

function counters(node: NodeInfo, time: number) {
  const age = Math.max(0, time - Date.UTC(2026, 0, 1)) / 1000;
  const seed = (node.weight % 70) / 10 + 1;
  return {
    total_received: Math.round((1200 + seed * 180) * GIB + age * (28 + seed * 5) * 1024),
    total_transmitted: Math.round((800 + seed * 120) * GIB + age * (12 + seed * 3) * 1024),
  };
}

function summary(node: NodeInfo, timestamp: number): Row {
  const seed = node.weight / 10;
  const phase = timestamp / 80_000 + seed;
  const cpu = Math.max(2, Math.min(97, 28 + seed % 6 * 8 + Math.sin(phase) * 13));
  return {
    uuid: node.uuid, timestamp,
    cpu_usage: cpu,
    gpu_usage: 0,
    total_memory: node.mem_total,
    used_memory: Math.round(node.mem_total * (0.35 + seed % 5 * 0.08 + Math.cos(phase) * 0.03)),
    total_swap: node.swap_total,
    used_swap: Math.round(node.swap_total * 0.08),
    total_space: node.disk_total,
    available_space: Math.round(node.disk_total * (0.65 - seed % 6 * 0.07)),
    load_one: cpu / 100 * node.cpu_cores,
    load_five: cpu / 115 * node.cpu_cores,
    load_fifteen: cpu / 130 * node.cpu_cores,
    receive_speed: Math.round((300 + seed * 75) * 1024 * (0.9 + Math.sin(phase) * 0.3)),
    transmit_speed: Math.round((180 + seed * 48) * 1024 * (0.9 + Math.cos(phase) * 0.3)),
    ...counters(node, timestamp),
    tcp_connections: 160 + seed * 12,
    udp_connections: 16 + seed,
    process_count: 110 + seed * 7,
    uptime: Math.max(0, Math.floor((timestamp - Date.UTC(2026, 0, 1)) / 1000)),
  };
}

function pickFields(record: Row, fields: unknown): Row {
  if (!Array.isArray(fields)) return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => key === "uuid" || key === "timestamp" || fields.includes(key)));
}

function queryBounds(query: Row) {
  const conditions = Array.isArray(query.condition) ? query.condition : [];
  const filter = Object.assign({}, ...conditions.map(object)) as Row;
  const interval = Array.isArray(filter.timestamp_from_to) ? filter.timestamp_from_to : [];
  const end = Number(filter.timestamp_to ?? interval[1]) || Date.now();
  const start = Number(filter.timestamp_from ?? interval[0]) || end - 6 * 3_600_000;
  const limit = Math.min(10_000, Math.max(1, Number(filter.limit) || 10_000));
  return { filter, start, end, limit };
}

const PING_TASKS = ["中国电信", "中国联通", "中国移动"];

export function createNodeGetMock(parameters = new URLSearchParams()) {
  const nodes = fixtureNodes(parameters);
  const midpoint = Math.ceil(nodes.length / 2);
  const backupNodes = nodes.slice(midpoint);
  // 第二个主控故意重复一个原生 UUID，用来验证跨主控不会覆盖节点。
  backupNodes[0] = { ...backupNodes[0]!, uuid: nodes[0]!.uuid };
  const sources: MockSource[] = [
    { id: "primary", name: "亚太主控", url: "wss://primary.nodeget-mock.invalid/nodeget/rpc", nodes: nodes.slice(0, midpoint) },
    { id: "backup", name: "全球主控", url: "wss://backup.nodeget-mock.invalid/nodeget/rpc", nodes: backupNodes },
  ];
  const empty = parameters.get("mockEmpty") === "1";
  const permission = parameters.get("mockPermission") === "1";
  const legacy = parameters.get("mockVersion") === "0.6.0";
  const failed = parameters.get("mockFailure") === "1";
  const config = {
    user_preferences: {
      site_name: "NodeGet SAO · 演示",
      description: "原生 NodeGet 多主控监控预览",
      footer: "NodeGet SAO · 开发演示数据",
      theme_settings: {
        desktopNodeViewMode: "compact",
        mobileNodeViewMode: "compact",
        clusterOverviewMode: parameters.get("matrix") === "1" ? "nodes" : "classic",
        showHomeOverview: true,
        showGroupTabs: true,
        showRegionBar: true,
        showCardGroup: true,
        enableHomeSort: true,
        showTrafficPageButton: true,
        showTrafficPageForGuests: true,
        showCostSummary: true,
        showPriceForGuests: parameters.get("costs") === "1",
        showOverviewRatings: true,
        showBandwidthRating: true,
        showPingChart: true,
      },
    },
    site_tokens: sources.map(source => ({
      id: source.id, name: source.name, backend_url: source.url, token: "DEVELOPMENT_MOCK_ONLY",
    })),
  };

  function result(source: MockSource, method: string, params: Row): unknown {
    if (permission && ["task_query", "agent_query_traffic", "agent_query_traffic_total", "agent_query_traffic_current"].includes(method)) throw 102;
    const selected = Array.isArray(params.uuids) ? source.nodes.filter(node => (params.uuids as unknown[]).includes(node.uuid)) : source.nodes;
    switch (method) {
      case "agent-uuid_list_all":
        throw 102; // 官方公开 Token 没有 MonitoringUuid::List 管理权限。
      case "nodeget-server_list_all_agent_uuid":
        return { uuids: source.nodes.map(node => node.uuid) };
      case "agent_static_data_multi_last_query":
        return selected.map(node => pickFields({
          uuid: node.uuid, timestamp: Date.now(),
          cpu: { brand: node.cpu_name, logical_cores: node.cpu_cores, physical_cores: node.cpu_cores },
          system: { system_arch: node.arch, virtualization: node.virtualization, system_name: node.os, system_os_long_version: node.os, system_kernel_version: node.kernel_version },
        }, params.fields));
      case "kv_get_multi_value": {
        const keys = Array.isArray(params.namespace_key) ? params.namespace_key : [];
        return keys.flatMap(value => {
          const request = object(value);
          const node = source.nodes.find(item => item.uuid === request.namespace);
          const meta = node ? metadata(node) : {};
          const key = String(request.key);
          return key in meta ? [{ namespace: request.namespace, key, value: meta[key] }] : [];
        });
      }
      case "agent_dynamic_summary_multi_last_query":
        return selected.map(node => pickFields(summary(node, node.name.startsWith("Sydney") ? Date.now() - 180_000 : Date.now()), params.fields));
      case "agent_query_dynamic_summary": {
        if (empty) return [];
        const query = object(params.query);
        const { filter, start, end, limit } = queryBounds(query);
        const clients = source.nodes.filter(node => !filter.uuid || node.uuid === filter.uuid);
        const samples: Row[] = [];
        const step = 300_000;
        for (let time = Math.floor(end / step) * step; time >= start && samples.length < limit; time -= step) {
          for (const node of clients) {
            if (samples.length >= limit) break;
            samples.push(pickFields(summary(node, time), query.fields));
          }
        }
        return samples;
      }
      case "task_query": {
        if (parameters.get("mockPartialPing") === "1" && JSON.stringify(params).includes("tcp_ping")) throw 102;
        if (empty) return [];
        const { filter, start, end, limit } = queryBounds(object(params.task_data_query));
        const type = filter.type === "tcp_ping" ? "tcp_ping" : "ping";
        const clients = source.nodes.filter(node => !filter.uuid || node.uuid === filter.uuid);
        const tasks = (type === "ping" ? PING_TASKS : ["HTTPS 连通性"]).filter(name => !filter.cron_source || filter.cron_source === name);
        const samples: Row[] = [];
        for (let time = Math.floor(end / 60_000) * 60_000; time >= start && samples.length < limit; time -= 60_000) {
          for (const node of clients) {
            for (const [taskIndex, name] of tasks.entries()) {
              if (samples.length >= limit) break;
              const seed = node.weight / 10;
              const success = !node.name.startsWith("Sydney") && (Math.floor(time / 60_000) + seed + taskIndex) % 29 !== 0;
              samples.push({
                uuid: node.uuid, timestamp: time, storage_time: time,
                cron_source: name, task_id: `${node.uuid}:${name}:${time}`,
                success, error_message: success ? null : "mock timeout",
                task_event_type: { [type]: type === "tcp_ping" ? "example.com:443" : "example.com" },
                task_event_result: success ? { [type]: 35 + seed * 10 + taskIndex * 18 + Math.round(Math.sin(time / 90_000) * 9) } : {},
              });
            }
          }
        }
        return samples;
      }
      case "agent_query_traffic_current":
        return selected.map(node => ({ uuid: node.uuid, interfaces: [{ interface_name: "eth0", ...counters(node, Date.now()), updated_at: Date.now(), last_snapshot_time: Math.floor(Date.now() / 900_000) * 900_000 }] }));
      case "agent_query_traffic":
      case "agent_query_traffic_total":
      case "agent_query_traffic_range":
      case "agent_query_traffic_detail": {
        if (legacy && method !== "agent_query_traffic") throw -32601;
        if (!legacy && method === "agent_query_traffic") throw -32601;
        if (empty) throw 105;
        const query = object(params.query);
        const node = source.nodes.find(item => item.uuid === (query.uuid ?? params.uuid));
        if (!node) throw 105;
        const start = Number(query.start_time) || new Date().setHours(0, 0, 0, 0);
        const end = Number(query.end_time) || Date.now();
        const first = legacy ? start : Math.ceil(start / 900_000) * 900_000;
        const last = legacy ? end : Math.floor(end / 900_000) * 900_000;
        if (query.granularity === "range" || method === "agent_query_traffic_range") return {
          uuid: node.uuid, interfaces: [{ interface_name: "eth0", first_snapshot_time: Date.now() - 90 * 86_400_000, last_snapshot_time: Math.floor(Date.now() / 900_000) * 900_000 }],
        };
        if (method === "agent_query_traffic_detail") {
          const limit = Math.min(10_000, Math.max(1, Number(query.limit) || 10_000));
          const cursor = object(query.cursor);
          const after = Number(cursor.snapshot_time) || 0;
          const snapshots: Row[] = [];
          for (let time = Math.max(first, after > 0 ? after + 900_000 : first); time <= last && snapshots.length <= limit; time += 900_000) {
            snapshots.push({ interface_name: "eth0", snapshot_time: time, ...counters(node, time) });
          }
          const more = snapshots.length > limit;
          const page = snapshots.slice(0, limit);
          return {
            uuid: node.uuid, start_time: start, end_time: end, snapshots: page,
            next_cursor: more ? { interface_name: "eth0", snapshot_time: page.at(-1)!.snapshot_time } : null,
            possible_data_losses: [],
          };
        }
        if (last <= first) throw 105;
        const firstCounter = counters(node, first);
        const lastCounter = counters(node, last);
        const received = lastCounter.total_received - firstCounter.total_received;
        const transmitted = lastCounter.total_transmitted - firstCounter.total_transmitted;
        return {
          uuid: node.uuid, start_time: start, end_time: end, received, transmitted,
          interfaces: [{ interface_name: "eth0", received, transmitted, first_snapshot_time: first, last_snapshot_time: last }],
          possible_data_losses: [],
        };
      }
      default: throw -32601;
    }
  }

  return {
    config,
    fails(url: string) { return failed && new URL(url).hostname === "backup.nodeget-mock.invalid"; },
    reply(url: string, request: RpcRequest) {
      const source = sources.find(item => new URL(item.url).hostname === new URL(url).hostname);
      try {
        if (!source) throw -32601;
        return { jsonrpc: "2.0", id: request.id, result: result(source, request.method ?? "", request.params ?? {}) };
      } catch (error) {
        const code = typeof error === "number" ? error : -32603;
        return { jsonrpc: "2.0", id: request.id, error: { code, message: code === -32601 ? "Method not found" : "Development fixture error", ...(code > 0 ? { data: { error_id: code } } : {}) } };
      }
    },
  };
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

/** 仅由 main.tsx 的 DEV 分支动态加载；所有数据都经过正式 RPC/配置适配层。 */
export function installDevMockApi() {
  const nativeFetch = globalThis.fetch;
  const nativeWebSocket = globalThis.WebSocket;
  const mock = createNodeGetMock(getMockParameters(window.location));
  const sockets = new Set<MockSocket>();

  class MockSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readonly protocol = "";
    readonly extensions = "";
    bufferedAmount = 0;
    binaryType: BinaryType = "blob";
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      sockets.add(this);
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        if (mock.fails(this.url)) {
          const event = new Event("error");
          this.onerror?.(event);
          this.dispatchEvent(event);
          this.close(1006, "Mock source unavailable");
        } else {
          this.readyState = 1;
          const event = new Event("open");
          this.onopen?.(event);
          this.dispatchEvent(event);
        }
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== 1) throw new DOMException("Socket is not open", "InvalidStateError");
      const request = JSON.parse(String(data)) as RpcRequest;
      const reply = mock.reply(this.url, request);
      queueMicrotask(() => {
        if (this.readyState !== 1) return;
        const event = new MessageEvent("message", { data: JSON.stringify(reply) });
        this.onmessage?.(event);
        this.dispatchEvent(event);
      });
    }

    close(code = 1000, reason = "") {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this);
      const event = Object.assign(new Event("close"), { code, reason, wasClean: code === 1000 }) as CloseEvent;
      this.onclose?.(event);
      this.dispatchEvent(event);
    }
  }

  globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
  const mockFetch: typeof fetch = async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, window.location.href);
    if (init?.signal?.aborted) throw init.signal.reason;
    if (url.origin === window.location.origin && url.pathname.endsWith("/config.json")) return json(mock.config);
    if (url.hostname === "api.frankfurter.dev") return json([
      { base: "USD", quote: "CNY", rate: 7.18 }, { base: "USD", quote: "EUR", rate: 0.86 }, { base: "USD", quote: "JPY", rate: 146.4 },
    ]);
    if (["open.er-api.com", "api.exchangerate-api.com"].includes(url.hostname)) return json({ result: "success", rates: { USD: 1, CNY: 7.18, EUR: 0.86, JPY: 146.4, CAD: 1.38, HKD: 7.82, GBP: 0.76 } });
    return nativeFetch(input, init);
  };
  globalThis.fetch = mockFetch;
  window.fetch = mockFetch;
  return () => {
    for (const socket of [...sockets]) socket.close();
    globalThis.fetch = nativeFetch;
    window.fetch = nativeFetch;
    globalThis.WebSocket = nativeWebSocket;
  };
}
