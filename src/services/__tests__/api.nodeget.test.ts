import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeGetRpcError } from "../nodeget/rpc";

const state = vi.hoisted(() => ({
  config: { user_preferences: {} as Record<string, unknown>, site_tokens: [] as Array<{ id?: string; name: string; backend_url: string; token: string }> },
  call: vi.fn<(url: string, method: string, params: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock("@/services/nodegetConfig", () => ({
  loadNodeGetConfig: async () => state.config,
  getThemePublicConfig: async () => ({ theme: "NodeGet-Theme-SAO" }),
  saveLocalThemeSettings: vi.fn(async () => {}),
}));
vi.mock("@/services/nodeget/rpc", async importOriginal => {
  const original = await importOriginal<typeof import("@/services/nodeget/rpc")>();
  return { ...original, NodeGetRpcClient: class {
    constructor(readonly url: string) {}
    call(method: string, params: Record<string, unknown> = {}) { return state.call(this.url, method, params); }
    close() {}
  } };
});

let api: typeof import("../api");
beforeEach(async () => {
  state.call.mockReset();
  state.config = { user_preferences: {}, site_tokens: [
    { name: "One", backend_url: "wss://one.example/nodeget/rpc", token: "public-one" },
    { name: "Two", backend_url: "wss://two.example/nodeget/rpc", token: "public-two" },
  ] };
  state.call.mockImplementation(async (_url, method, params) => {
    if (method === "agent-uuid_list_all") throw new NodeGetRpcError(102, method);
    if (method === "nodeget-server_list_all_agent_uuid") return { uuids: ["same"] };
    if (method === "agent_static_data_multi_last_query") return [{ uuid: "same", cpu: { brand: "Test CPU", logical_cores: 4 }, system: { system_name: "Linux" } }];
    if (method === "kv_get_multi_value") return (params.namespace_key as Array<{ namespace: string; key: string }>).filter(pair => pair.key === "metadata_name").map(pair => ({ ...pair, value: "Shared name" }));
    if (method === "agent_dynamic_summary_multi_last_query") return [{ uuid: "same", timestamp: Date.now(), cpu_usage: 10, total_memory: 100, used_memory: 30, total_space: 200, available_space: 100, receive_speed: 100, transmit_speed: 50, uptime: 500, tcp_connections: 5, udp_connections: 3 }];
    if (method === "agent_query_traffic_current") return [];
    if (method === "task_query") return [];
    throw new Error("Unexpected test method");
  });
  api = await import("../api");
});
afterEach(() => { api.closeNodeGetConnections(); vi.useRealTimers(); });

describe("NodeGet public API", () => {
  it("loads homepage traffic totals without querying unused rate histories", async () => {
    const successful = state.call.getMockImplementation()!;
    const start = Date.now() - 3_600_000;
    const end = Date.now();
    state.call.mockImplementation(async (url, method, params) => {
      if (method !== "agent_query_traffic_total") return successful(url, method, params);
      return {
        uuid: "same", transmitted: 100, received: 200, possible_data_losses: [],
        interfaces: [{ interface_name: "eth0", transmitted: 100, received: 200,
          first_snapshot_time: start, last_snapshot_time: end }],
      };
    });
    const nodes = await api.getNodes();
    const data = await api.getTodayTrafficMetrics([nodes[0]!.uuid], start, end, { includeRates: false });
    expect(data.series.map(item => item.metricKey)).toEqual(["traffic.up", "traffic.down"]);
    expect(state.call.mock.calls.some(([, method]) => method === "agent_query_dynamic_summary")).toBe(false);
  });

  it("publishes each completed node while another source is still waiting", async () => {
    const successful = state.call.getMockImplementation()!;
    let release!: () => void;
    const slow = new Promise<void>(resolve => { release = resolve; });
    state.call.mockImplementation(async (url, method, params) => {
      if (method !== "task_query") return successful(url, method, params);
      if (url.includes("two.example")) { await slow; return []; }
      const conditions = (params.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      return conditions.some(condition => condition.type === "ping") ? [
        { uuid: "same", cron_source: "Tokyo", task_id: 1, timestamp: Date.now() - 60_000, success: true, task_event_result: { ping: 12 }, task_event_type: { ping: "example.com" } },
        { uuid: "same", cron_source: "Tokyo", task_id: 2, timestamp: Date.now() - 30_000, success: false, task_event_result: {}, task_event_type: { ping: "example.com" } },
      ] : [];
    });
    const nodes = await api.getNodes();
    const progress = vi.fn();
    let finished = false;
    const pending = api.getPingOverview(1, undefined, { entityIds: nodes.map(node => node.uuid), onProgress: progress })
      .then(result => { finished = true; return result; });
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      stats: [expect.objectContaining({ total: 2, valid: 1, loss: 50 })],
    }), [nodes[0]!.uuid]));
    expect(finished).toBe(false);
    release();
    await pending;
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("resolves a configured task on a cold start without scanning other nodes or loading duplicate statistics", async () => {
    const { stableId } = await import("../nodeget/normalize");
    const nodes = await api.getNodes();
    const source = nodes[0]!.uuid.split("~")[0]!;
    const taskId = stableId(`${source}\0ping\0cron:Tokyo`);
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation(async (url, method, params) => {
      if (method !== "task_query") return successful(url, method, params);
      const conditions = (params.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      return conditions.some(condition => condition.type === "ping") ? [
        { uuid: "same", cron_source: "Tokyo", task_id: 1, timestamp: Date.now() - 60_000, success: true, task_event_result: { ping: 12 }, task_event_type: { ping: "example.com" } },
      ] : [];
    });
    const response = await api.getPingOverview(1, taskId, { entityIds: [nodes[0]!.uuid] });
    expect(response.tasks.map(task => task.id)).toEqual([taskId]);
    expect(response.stats?.[0]?.latest).toBe(12);
    const calls = state.call.mock.calls.filter(([, method]) => method === "task_query");
    expect(calls).toHaveLength(2);
    expect(calls.every(([url]) => url.includes("one.example"))).toBe(true);
  });

  it("does not repeat empty 24-hour discovery on every homepage refresh", async () => {
    vi.useFakeTimers();
    const nodes = await api.getNodes();
    await api.getPingOverview(1, undefined, { entityIds: [nodes[0]!.uuid] });
    vi.advanceTimersByTime(60_000);
    await api.getPingOverview(1, undefined, { entityIds: [nodes[0]!.uuid] });
    const discovery = state.call.mock.calls.filter(([, method, params]) => {
      if (method !== "task_query") return false;
      const conditions = (params.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      const interval = conditions.find(condition => condition.timestamp_from_to)?.timestamp_from_to as number[];
      return interval[1]! - interval[0]! > 3_600_000;
    });
    expect(discovery).toHaveLength(2);
  });

  it("discovers nodes with the official public preset and separates sources", async () => {
    const nodes = await api.getNodes();
    expect(nodes).toHaveLength(2); expect(nodes[0]!.uuid).not.toBe(nodes[1]!.uuid);
    expect(nodes.map(node => node.source_name)).toEqual(["One", "Two"]);
    const latest = await api.getNodesLatestStatus(nodes.map(node => node.uuid));
    expect(latest[nodes[0]!.uuid]).toMatchObject({ online: true, dataStatus: "ready", metrics: { cpuPct: 10, ramPct: 30, diskPct: 50, connectionsTcp: 5, connectionsUdp: 3 } });
    expect(state.call.mock.calls.every(([, method]) => !method.includes("common:"))).toBe(true);
    expect(state.call.mock.calls.some(([, method]) => method === "nodeget-server_list_all_agent_uuid")).toBe(true);
    expect(state.call.mock.calls.some(([, method]) => method === "agent-uuid_list_all")).toBe(false);
    const metadataCalls = state.call.mock.calls.filter(([, method]) => method === "kv_get_multi_value");
    expect(JSON.stringify(metadataCalls)).not.toContain("metadata_price");
  });
  it("reads expiry independently while the site keeps prices private", async () => {
    const successful = state.call.getMockImplementation()!;
    const expires = 1_900_000_000_000;
    state.config.user_preferences = { theme_settings: { showPriceForGuests: false } };
    state.call.mockImplementation(async (url, method, params) => {
      if (method !== "kv_get_multi_value") return successful(url, method, params);
      const pairs = params.namespace_key as Array<{ namespace: string; key: string }>;
      const expiryPairs = pairs.filter(pair => pair.key === "metadata_expire_time");
      if (expiryPairs.length) return expiryPairs.map(pair => ({ ...pair, value: expires }));
      return successful(url, method, params);
    });
    const nodes = await api.getNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes.every(node => node.expired_at === new Date(expires).toISOString())).toBe(true);
    expect(nodes.every(node => node.price_configured === false && node.currency === "" && node.billing_cycle === "")).toBe(true);
    const metadataCalls = state.call.mock.calls.filter(([, method]) => method === "kv_get_multi_value");
    expect(JSON.stringify(metadataCalls)).toContain("metadata_expire_time");
    expect(JSON.stringify(metadataCalls)).not.toContain("metadata_price");
  });
  it("keeps monitoring metadata when the token cannot read expiry", async () => {
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation(async (url, method, params) => {
      if (method === "kv_get_multi_value" && (params.namespace_key as Array<{ key: string }>)
        .some(pair => pair.key === "metadata_expire_time")) throw new NodeGetRpcError(102, method);
      return successful(url, method, params);
    });
    const nodes = await api.getNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes.every(node => node.name === "Shared name" && node.metadata_status === "ready")).toBe(true);
    expect(nodes.every(node => node.expired_at === "")).toBe(true);
  });
  it("discovers native Ping without bindings and isolates a source without task permission", async () => {
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => {
      if (method !== "task_query") return successful(url, method, params);
      if (url.includes("two.example")) return Promise.reject(new NodeGetRpcError(102, method));
      const conditions = (params.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      if (!conditions.some(condition => condition.type === "ping")) return Promise.resolve([]);
      return Promise.resolve([
        { uuid: "same", cron_source: "Tokyo", task_id: 1, timestamp: Date.now() - 60_000, success: true, task_event_result: { ping: 12 }, task_event_type: { ping: "example.com" } },
        { uuid: "same", cron_source: "Tokyo", task_id: 2, timestamp: Date.now() - 30_000, success: false, task_event_result: {}, task_event_type: { ping: "example.com" } },
      ]);
    });
    const nodes = await api.getNodes();
    const response = await api.getPingOverview(1, undefined, { entityIds: nodes.map(node => node.uuid) });
    expect(response.tasks).toHaveLength(1);
    expect(response.tasks[0]!.clients).toEqual([nodes[0]!.uuid]);
    expect(response.stats?.[0]).toMatchObject({ total: 2, valid: 1, loss: 50 });
    expect(response.issues?.[nodes[0]!.uuid]).toBeUndefined();
    expect(response.issues?.[nodes[1]!.uuid]).toMatchObject({ status: "forbidden" });
  });
  it("discovers older native task identities without using old samples for the current hour", async () => {
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => {
      if (method !== "task_query") return successful(url, method, params);
      const conditions = (params.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      const interval = conditions.find(condition => condition.timestamp_from_to)?.timestamp_from_to as number[];
      if (!conditions.some(condition => condition.type === "ping") || interval[1]! - interval[0]! < 4_000_000) return Promise.resolve([]);
      return Promise.resolve([{ uuid: "same", cron_source: "Tokyo", task_id: 1, timestamp: Date.now() - 7_200_000, success: true, task_event_result: { ping: 12 }, task_event_type: { ping: "example.com" } }]);
    });
    const nodes = await api.getNodes();
    const response = await api.getPingOverview(1, undefined, { entityIds: [nodes[0]!.uuid] });
    expect(response.tasks).toHaveLength(1);
    expect(response.records).toEqual([]);
    expect(response.stats).toEqual([]);
    expect(response.issues).toEqual({});
  });
  it("keeps healthy nodes available when another source fails and reports the failing source", async () => {
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => url.includes("two.example") ? Promise.reject(new Error("unreachable")) : successful(url, method, params));
    expect(await api.getNodes()).toHaveLength(1);
    expect(api.getSourceStatuses()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Two", status: "error" })]));
  });
  it("keeps monitoring when optional metadata is forbidden", async () => {
    const { NodeGetRpcError } = await import("../nodeget/rpc");
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => method === "kv_get_multi_value" ? Promise.reject(new NodeGetRpcError(102, method)) : successful(url, method, params));
    const nodes = await api.getNodes();
    expect(nodes).toHaveLength(2); expect(nodes[0]!.metadata_status).toBe("forbidden");
    const latest = await api.getNodesLatestStatus();
    expect(latest[nodes[0]!.uuid]).toMatchObject({ online: true, metrics: { cpuPct: 10 } });
  });
  it("keeps identity after reordering sources and rotating read tokens", async () => {
    const before = (await api.getNodes()).map(node => node.uuid).sort();
    state.config.site_tokens.reverse(); state.config.site_tokens[0]!.token = "rotated-read-token";
    expect((await api.getNodes()).map(node => node.uuid).sort()).toEqual(before);
  });
  it("returns unknown state after source disconnect instead of reusing online=true", async () => {
    vi.useFakeTimers();
    const nodes = await api.getNodes();
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => method === "agent_dynamic_summary_multi_last_query" ? Promise.reject(new Error("disconnected")) : successful(url, method, params));
    vi.advanceTimersByTime(2000);
    const latest = await api.getNodesLatestStatus();
    expect(latest[nodes[0]!.uuid]).toMatchObject({ online: null, dataStatus: "error" });
  });
  it("uses asynchronously refreshed native traffic counters without requiring a newer dynamic snapshot", async () => {
    vi.useFakeTimers();
    const successful = state.call.getMockImplementation()!;
    let release!: (value: unknown) => void;
    const current = new Promise(resolve => { release = resolve; });
    state.call.mockImplementation((url, method, params) => method === "agent_query_traffic_current"
      ? current : successful(url, method, params));
    const nodes = await api.getNodes();
    const before = await api.getNodesLatestStatus([nodes[0]!.uuid]);
    expect(before[nodes[0]!.uuid]!.metrics!.trafficUp).toBeNaN();
    release([{ uuid: "same", interfaces: [{
      interface_name: "eth0", total_transmitted: 0, total_received: 456, updated_at: Date.now(),
    }] }]);
    const after = await api.getNodesLatestStatus([nodes[0]!.uuid]);
    expect(after[nodes[0]!.uuid]!.metrics).toMatchObject({
      trafficUp: 0, trafficDown: 456, updatedAt: before[nodes[0]!.uuid]!.metrics!.updatedAt,
    });
  });
  it("does not accept another probe's realtime fields as a NodeGet snapshot", async () => {
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => method === "agent_dynamic_summary_multi_last_query"
      ? Promise.resolve([{ uuid: "same", timestamp: Date.now(), cpu: { usage: 50 }, ram: { used: 1, total: 2 }, network: { up: 10, down: 20 } }])
      : successful(url, method, params));
    const nodes = await api.getNodes();
    const latest = await api.getNodesLatestStatus([nodes[0]!.uuid]);
    expect(latest[nodes[0]!.uuid]).toMatchObject({ online: null, dataStatus: "partial", metrics: null });
  });
  it("represents an unconfigured site explicitly", async () => {
    state.config.site_tokens = [];
    await expect(api.getNodes()).resolves.toEqual([]);
    expect(api.getSourceStatuses()[0]?.status).toBe("unconfigured");
    expect(state.call).not.toHaveBeenCalled();
  });
  it("marks missing timestamps as unknown and incomplete core metrics as partial", async () => {
    const successful = state.call.getMockImplementation()!;
    state.call.mockImplementation((url, method, params) => {
      if (method === "agent_dynamic_summary_multi_last_query") {
        return Promise.resolve([{ uuid: "same", ...(url.includes("one.example") ? {} : { timestamp: Date.now() }), cpu_usage: 10 }]);
      }
      return successful(url, method, params);
    });
    const nodes = await api.getNodes();
    const latest = await api.getNodesLatestStatus();
    expect(latest[nodes[0]!.uuid]).toMatchObject({ online: null, dataStatus: "unavailable" });
    expect(latest[nodes[1]!.uuid]).toMatchObject({ online: null, dataStatus: "partial", missingFields: expect.arrayContaining(["used_memory"]) });
    expect(latest[nodes[0]!.uuid]!.metrics).toBeNull();
    expect(latest[nodes[1]!.uuid]!.metrics).toBeNull();
  });
  it("retains rate samples while exposing missing traffic snapshots without inventing zero totals", async () => {
    const nodes = await api.getNodes();
    const { NodeGetRpcError } = await import("../nodeget/rpc");
    const successful = state.call.getMockImplementation()!;
    const end = Date.now();
    state.call.mockImplementation((url, method, params) => {
      if (method === "agent_query_traffic_total") return Promise.reject(new NodeGetRpcError(105, method));
      if (method === "agent_query_dynamic_summary") return Promise.resolve([
        { uuid: "same", timestamp: end - 2000, receive_speed: 200, transmit_speed: 100, total_received: 1_000_000, total_transmitted: 800_000, uptime: 10 },
      ]);
      return successful(url, method, params);
    });
    const response = await api.getTodayTrafficMetrics([nodes[0]!.uuid], end - 3_600_000, end);
    expect(response.issues?.[nodes[0]!.uuid]?.status).toBe("unavailable");
    expect(response.series.map(item => item.metricKey)).toEqual(["net.out.rate", "net.in.rate"]);
    expect(response.series[0]!.points[0]!.value).toBe(100);
  });
});
