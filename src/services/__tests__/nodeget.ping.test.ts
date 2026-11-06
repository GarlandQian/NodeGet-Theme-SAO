import { describe, expect, it, vi } from "vitest";
import { HistoryScheduler } from "../nodeget/history";
import { downsamplePing, PingReader } from "../nodeget/ping";
import type { RpcCaller } from "../nodeget/rpc";

const start = 1_800_000_000_000;
const payload = [
  { uuid: "same", cron_source: "Tokyo", task_id: 1, timestamp: start, success: true, task_event_result: { ping: 10 }, task_event_type: { ping: "example.com" } },
  { uuid: "same", cron_source: "Tokyo", task_id: 2, timestamp: start + 1000, success: false, task_event_result: {}, task_event_type: { ping: "example.com" } },
  { uuid: "same", cron_source: "Tokyo", task_id: 3, timestamp: start + 2000, success: true, task_event_result: { ping: 20 }, task_event_type: { ping: "example.com" } },
];
describe("NodeGet task histories", () => {
  it("counts failed tasks without a numeric result and calculates loss before chart sampling", async () => {
    const call = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      const conditions = (params?.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      return conditions.some(item => item.type === "ping") ? payload : [];
    });
    const scheduler = new HistoryScheduler();
    const reader = new PingReader("s-one", { call, close() {} } as RpcCaller, scheduler);
    const data = await reader.query("same", start, start + 5000);
    expect(data.records.map(record => record.value)).toEqual([10, -1, 20]);
    expect(data.stats[0]).toMatchObject({ total: 3, valid: 2, avg: 15 });
    expect(data.stats[0]!.loss).toBeCloseTo(100 / 3);
    const sampled = downsamplePing(data.records, start, start + 5000, 1);
    expect(sampled.records).toHaveLength(1);
    expect(sampled.records[0]).toMatchObject({ count: 3, value: 15, time: new Date(start).toISOString() });
    expect(sampled.records[0]!.loss).toBeCloseTo(100 / 3);
    scheduler.close();
  });
  it("namespaces identical tasks across sources and sends cron_source instead of synthesized IDs", async () => {
    const call = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
      const conditions = (params?.task_data_query as { condition: Array<Record<string, unknown>> }).condition;
      return conditions.some(item => item.type === "ping") ? payload : [];
    });
    const scheduler = new HistoryScheduler(4, 0);
    const rpc = { call, close() {} } as RpcCaller;
    const one = new PingReader("s-one", rpc, scheduler);
    const two = new PingReader("s-two", rpc, scheduler);
    await one.query("same", start, start + 5000); await two.query("same", start, start + 5000);
    expect(one.tasks()[0]!.id).not.toBe(two.tasks()[0]!.id);
    expect(one.tasks()[0]!.clients).toEqual(["s-one~same"]);
    call.mockClear();
    await one.query("same", start, start + 5000, {}, one.tasks()[0]!.id);
    expect(call.mock.calls[0]?.[1]).toEqual({ task_data_query: { condition: [
      { uuid: "same" }, { type: "ping" }, { cron_source: "Tokyo" },
      { timestamp_from_to: [start, start + 5000] }, { limit: 10_000 },
    ] } });
    scheduler.close();
  });
});
