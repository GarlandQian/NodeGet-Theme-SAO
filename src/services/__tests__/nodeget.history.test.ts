import { describe, expect, it, vi } from "vitest";
import { HistoryScheduler, IncompleteHistoryError, queryCompleteWindow } from "../nodeget/history";
import type { RpcCaller } from "../nodeget/rpc";

describe("NodeGet history scheduling", () => {
  it("shares identical reads while cancellation only removes one consumer", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn(() => new Promise(ok => { resolve = ok; }));
    const caller = { call, close() {} } as RpcCaller;
    const scheduler = new HistoryScheduler();
    const controller = new AbortController();
    const one = scheduler.call(caller, "task_query", { n: 1 }, { signal: controller.signal }).catch(error => error);
    const two = scheduler.call(caller, "task_query", { n: 1 });
    controller.abort();
    expect(await one).toMatchObject({ name: "AbortError" }); expect(call).toHaveBeenCalledTimes(1);
    resolve([{ n: 1 }]);
    const result = await two as Array<{ n: number }>;
    result[0]!.n = 9;
    await expect(scheduler.call(caller, "task_query", { n: 1 })).resolves.toEqual([{ n: 1 }]);
    scheduler.close();
  });
  it("bounds concurrency and removes canceled queued requests", async () => {
    const callbacks: Array<(value: unknown) => void> = [];
    const call = vi.fn(() => new Promise(ok => callbacks.push(ok)));
    const caller = { call, close() {} } as RpcCaller;
    const scheduler = new HistoryScheduler(1);
    const one = scheduler.call(caller, "history", { n: 1 });
    const controller = new AbortController();
    const two = scheduler.call(caller, "history", { n: 2 }, { signal: controller.signal }).catch(error => error);
    controller.abort(); expect(await two).toMatchObject({ name: "AbortError" });
    callbacks[0]!([]); await one;
    expect(call).toHaveBeenCalledTimes(1); scheduler.close();
  });
  it("splits inclusive millisecond windows without overlaps when the result hits its cap", async () => {
    const query = vi.fn(async (from: number, to: number) => from === 100 && to === 199 ? Array(10_000).fill(0) as number[] : [from, to]);
    await expect(queryCompleteWindow(100, 199, query)).resolves.toEqual([100, 149, 150, 199]);
    expect(query.mock.calls).toEqual([[100, 199], [100, 149], [150, 199]]);
  });
  it("reports incomplete history when even a single millisecond exceeds the cap", async () => {
    await expect(queryCompleteWindow(100, 100, async () => Array(10_000))).rejects.toBeInstanceOf(IncompleteHistoryError);
  });
});
