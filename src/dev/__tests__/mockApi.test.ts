import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeGetMock, getMockParameters, installDevMockApi } from "../mockApi";
import { NodeGetRpcClient } from "@/services/nodeget/rpc";

afterEach(() => vi.unstubAllGlobals());

describe("native NodeGet development fixture", () => {
  it("partitions 100 records into two sources with an intentionally shared native UUID", () => {
    const fixture = createNodeGetMock(new URLSearchParams("nodes=100"));
    const [primary, backup] = fixture.config.site_tokens;
    const first = (fixture.reply(primary!.backend_url, { id: 1, method: "nodeget-server_list_all_agent_uuid" }).result as { uuids: string[] }).uuids;
    const second = (fixture.reply(backup!.backend_url, { id: 2, method: "nodeget-server_list_all_agent_uuid" }).result as { uuids: string[] }).uuids;
    expect(first.length + second.length).toBe(100);
    expect(first[0]).toBe(second[0]);
    expect(primary!.id).not.toBe(backup!.id);
    expect(fixture.config.user_preferences.theme_settings).not.toHaveProperty("homepagePingBindings");
    expect(fixture.config.user_preferences.theme_settings.showPriceForGuests).toBe(false);
    expect(createNodeGetMock(new URLSearchParams("costs=1")).config.user_preferences.theme_settings.showPriceForGuests).toBe(true);
  });

  it("respects fields and inclusive history query boundaries", () => {
    const fixture = createNodeGetMock();
    const url = fixture.config.site_tokens[0]!.backend_url;
    const end = Math.floor(Date.now() / 300_000) * 300_000;
    const result = fixture.reply(url, {
      id: 1, method: "agent_query_dynamic_summary", params: {
        query: { condition: [{ uuid: "tokyo-edge-01" }, { timestamp_from_to: [end - 600_000, end] }, { limit: 2 }], fields: ["cpu_usage"] },
      },
    }).result as Array<Record<string, unknown>>;
    expect(result.map(row => row.timestamp)).toEqual([end, end - 300_000]);
    expect(Object.keys(result[0]!).sort()).toEqual(["cpu_usage", "timestamp", "uuid"]);
    expect(fixture.reply(url, { id: 8, method: "common:getNodes" }).error?.code).toBe(-32601);
  });

  it("contains failed task rows and distinguishes missing data from permission errors", () => {
    const fixture = createNodeGetMock();
    const url = fixture.config.site_tokens[0]!.backend_url;
    const request = { id: 1, method: "task_query", params: { task_data_query: { condition: [{ uuid: "tokyo-edge-01" }, { type: "ping" }] } } };
    const rows = fixture.reply(url, request).result as Array<Record<string, unknown>>;
    expect(rows.some(row => row.success === false && Object.keys(row.task_event_result as object).length === 0)).toBe(true);
    expect(createNodeGetMock(new URLSearchParams("mockEmpty=1")).reply(url, request).result).toEqual([]);
    expect(createNodeGetMock(new URLSearchParams("mockPermission=1")).reply(url, request).error?.code).toBe(102);
  });

  it("implements both traffic contracts and reports unavailable snapshots", () => {
    const modern = createNodeGetMock();
    const legacy = createNodeGetMock(new URLSearchParams("mockVersion=0.6.0"));
    const url = modern.config.site_tokens[0]!.backend_url;
    const end = Math.floor(Date.now() / 900_000) * 900_000;
    const params = { query: { uuid: "tokyo-edge-01", start_time: end - 3_600_000, end_time: end } };
    const value = modern.reply(url, { id: 1, method: "agent_query_traffic_total", params }).result as Record<string, unknown>;
    expect(value.received).toBeGreaterThan(0);
    expect(value.interfaces).toHaveLength(1);
    expect(legacy.reply(url, { id: 2, method: "agent_query_traffic_total", params }).error?.code).toBe(-32601);
    expect(legacy.reply(url, { id: 3, method: "agent_query_traffic", params: { query: { ...params.query, granularity: "total" } } }).result).toBeDefined();
    expect(createNodeGetMock(new URLSearchParams("mockEmpty=1")).reply(url, { id: 4, method: "agent_query_traffic_total", params }).error?.code).toBe(105);
  });

  it("reads options from static-host hash routes", () => {
    expect(getMockParameters({ search: "?nodes=50", hash: "#/?mock=1&nodes=100" }).get("nodes")).toBe("100");
  });

  it("drives the production RPC client through async mock sockets and restores globals", async () => {
    const nativeFetch = globalThis.fetch;
    const nativeSocket = globalThis.WebSocket;
    vi.stubGlobal("window", { location: new URL("http://localhost:5173/demo/?mock=1"), fetch: nativeFetch });
    const restore = installDevMockApi();
    const client = new NodeGetRpcClient("wss://primary.nodeget-mock.invalid", "DEVELOPMENT_MOCK_ONLY");
    try {
      const config = await (await fetch("http://localhost:5173/demo/config.json")).json();
      expect(config.site_tokens).toHaveLength(2);
      await expect(client.call("agent-uuid_list_all")).rejects.toMatchObject({ code: 102 });
      const nodes = await client.call<{ uuids: string[] }>("nodeget-server_list_all_agent_uuid");
      expect(nodes.uuids).toContain("tokyo-edge-01");
      await expect(client.call("not_a_method")).rejects.toMatchObject({ code: -32601 });
    } finally {
      client.close();
      restore();
    }
    expect(globalThis.fetch).toBe(nativeFetch);
    expect(globalThis.WebSocket).toBe(nativeSocket);
  });

  it("can fail one source while the other stays available", async () => {
    vi.stubGlobal("window", { location: new URL("http://localhost:5173/?mock=1&mockFailure=1"), fetch: globalThis.fetch });
    const restore = installDevMockApi();
    const primary = new NodeGetRpcClient("wss://primary.nodeget-mock.invalid", "DEVELOPMENT_MOCK_ONLY");
    const backup = new NodeGetRpcClient("wss://backup.nodeget-mock.invalid", "DEVELOPMENT_MOCK_ONLY");
    try {
      await expect(backup.call("nodeget-server_list_all_agent_uuid")).rejects.toThrow();
      await expect(primary.call<{ uuids: string[] }>("nodeget-server_list_all_agent_uuid")).resolves.toMatchObject({ uuids: expect.arrayContaining(["tokyo-edge-01"]) });
    } finally {
      primary.close(); backup.close(); restore();
    }
  });
});
