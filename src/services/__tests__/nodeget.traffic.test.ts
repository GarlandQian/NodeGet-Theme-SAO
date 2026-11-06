import { describe, expect, it, vi } from "vitest";
import { HistoryScheduler } from "../nodeget/history";
import { NodeGetRpcError, type RpcCaller } from "../nodeget/rpc";
import { parseCurrentTraffic, parseTrafficTotal, TrafficReader } from "../nodeget/traffic";

const start = 1_800_000_000_000;
const end = start + 3_600_000;
const total = {
  uuid: "n1", received: 20, transmitted: 10, possible_data_losses: [],
  interfaces: [{ interface_name: "eth0", received: 20, transmitted: 10, first_snapshot_time: start + 1000, last_snapshot_time: end - 1000 }],
};
describe("native traffic semantics", () => {
  it("preserves actual snapshot boundaries and identifies partial coverage", () => {
    expect(parseTrafficTotal(total, "n1", start, end, true)).toEqual({ up: 10, down: 20, first: start + 1000, last: end - 1000, partial: true });
  });
  it("rejects absent snapshots and inconsistent totals instead of returning zero", () => {
    expect(() => parseTrafficTotal({ ...total, interfaces: [] }, "n1", start, end, true)).toThrow();
    expect(() => parseTrafficTotal({ ...total, received: 200 }, "n1", start, end, true)).toThrow();
  });
  it("recognizes explicit zero traffic when valid snapshots exist", () => {
    const zero = { ...total, received: 0, transmitted: 0, interfaces: [{ ...total.interfaces[0]!, received: 0, transmitted: 0 }] };
    expect(parseTrafficTotal(zero, "n1", start, end, true).down).toBe(0);
  });
  it("falls back to 0.6.0 only on method-not-found, then checks snapshot coverage", async () => {
    const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "agent_query_traffic_total") throw new NodeGetRpcError(-32601, method);
      if ((params?.query as Record<string, unknown>).granularity === "range") {
        return { uuid: "n1", interfaces: [{ first_snapshot_time: start - 1000, last_snapshot_time: end }] };
      }
      return total;
    });
    const scheduler = new HistoryScheduler();
    const reader = new TrafficReader({ call, close() {} } as RpcCaller, scheduler);
    expect((await reader.total("n1", start, end)).up).toBe(10);
    expect(call.mock.calls.map(call => call[0])).toEqual(["agent_query_traffic_total", "agent_query_traffic", "agent_query_traffic"]);
    reader.close(); scheduler.close();
  });
  it("does not turn permission denial into another API call or estimated totals", async () => {
    const call = vi.fn(async () => { throw new NodeGetRpcError(102, "agent_query_traffic_total"); });
    const scheduler = new HistoryScheduler();
    const reader = new TrafficReader({ call, close() {} } as RpcCaller, scheduler);
    await expect(reader.total("n1", start, end)).rejects.toMatchObject({ status: 403 });
    expect(call).toHaveBeenCalledTimes(1); reader.close(); scheduler.close();
  });
  it("keeps native lifetime counters separate and accepts an unset snapshot timestamp", () => {
    const parsed = parseCurrentTraffic([{ uuid: "n1", interfaces: [
      { interface_name: "eth0", total_received: 100, total_transmitted: 50, updated_at: start, last_snapshot_time: null },
      { interface_name: "eth1", total_received: 20, total_transmitted: 10, updated_at: start - 1000, last_snapshot_time: null },
    ] }]);
    expect(parsed.get("n1")).toEqual({ up: 60, down: 120, updatedAt: start - 1000 });
  });
});
