import { describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "@/services/requestErrors";
import {
  buildPingOverviewMap,
  buildPingBuckets,
  buildPingOverviewItems,
  resolveHomepagePingRequestMode,
  selectPersistablePingOverview,
} from "@/hooks/usePingOverview";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 6, 17, 11, 2);
const WINDOW_START = NOW - 60 * MINUTE_MS;

function aggregateSamples(intervalMinutes: number) {
  const alignedStart = Date.UTC(2026, 6, 17, 10, 0);
  const count = Math.ceil((NOW - alignedStart) / (intervalMinutes * MINUTE_MS));
  return Array.from({ length: count }, (_, index) => ({
    time: alignedStart + index * intervalMinutes * MINUTE_MS,
    value: 40 + index,
    count: intervalMinutes,
    loss: 0,
  }));
}

describe("homepage ping sample interval projection", () => {
  it("preserves a latest timeout instead of displaying the successful aggregate average", () => {
    const items = buildPingOverviewItems(7, [
      { task_id: 7, client: "node-a", time: NOW, value: 42, count: 2, loss: 50 },
    ], [{
      taskId: 7, client: "node-a", name: "ICMP", type: "icmp", interval: 60,
      total: 2, valid: 1, loss: 50, latest: null, avg: 42, min: 42, max: 42,
      p50: 42, p99: 42, stddev: 0, p99P50Ratio: 1,
    }], 300);
    expect(items.get("node-a")).toMatchObject({ lastValue: null, loss: 50 });
  });

  it("propagates the native sampling interval into the homepage item", () => {
    const items = buildPingOverviewItems(
      7,
      [
        {
          task_id: 7,
          time: "2026-07-17T10:00:00Z",
          value: 42,
          client: "node-a",
          count: 5,
          loss: 0,
        },
      ],
      [],
      300,
    );

    expect(items.get("node-a")?.metricIntervalMs).toBe(5 * MINUTE_MS);
  });

  it("projects five-minute aggregates across twenty-four continuous buckets", () => {
    const buckets = buildPingBuckets(
      {
        metricIntervalMs: 5 * MINUTE_MS,
        samples: aggregateSamples(5),
      },
      24,
      NOW,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.every((bucket) => bucket.total > 0 && bucket.value != null)).toBe(true);
    expect(buckets[0]?.startAt).toBe(WINDOW_START);
    expect(buckets[23]?.endAt).toBe(NOW);
  });

  it("removes the compact-card two-on one-off artifact without hiding a real gap", () => {
    const samples = aggregateSamples(5).filter(
      (sample) => sample.time !== Date.UTC(2026, 6, 17, 10, 30),
    );
    const buckets = buildPingBuckets(
      { metricIntervalMs: 5 * MINUTE_MS, samples },
      18,
      NOW,
    );

    expect(buckets).toHaveLength(18);
    expect(buckets.filter((bucket) => bucket.total === 0)).toHaveLength(2);
  });

  it("keeps two-minute aggregates at the existing 24-bucket density", () => {
    const buckets = buildPingBuckets(
      {
        metricIntervalMs: 2 * MINUTE_MS,
        samples: Array.from({ length: 31 }, (_, index) => ({
          time: WINDOW_START + index * 2 * MINUTE_MS,
          value: 30,
          count: 2,
          loss: 0,
        })),
      },
      24,
      NOW,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.every((bucket) => bucket.total > 0)).toBe(true);
  });

  it("preserves fixed bucket density when interval metadata is absent", () => {
    const buckets = buildPingBuckets(
      {
        samples: [{ time: NOW - MINUTE_MS, value: 25 }],
      },
      18,
      NOW,
    );

    expect(buckets).toHaveLength(18);
    expect(buckets.filter((bucket) => bucket.total > 0)).toHaveLength(1);
  });
});

function pingOverviewResponse(taskId: number, value: number) {
  return {
    records: [
      {
        task_id: taskId,
        time: NOW,
        value,
        client: "node-a",
        count: 1,
        loss: 0,
      },
    ],
    tasks: [
      {
        id: taskId,
        interval: 60,
        name: `Task ${taskId}`,
        loss: 0,
        clients: ["node-a"],
        type: "icmp",
        target: "example.com",
        weight: taskId,
      },
    ],
    stats: [],
    intervalSeconds: 60,
  };
}

describe("homepage ping polling selection", () => {
  it("renders completed automatic nodes without waiting for the slowest node", async () => {
    let release!: () => void;
    const slow = new Promise<void>(resolve => { release = resolve; });
    const first = pingOverviewResponse(7, 42);
    const second = { ...first.records[0]!, client: "node-b", value: 88 };
    const snapshots: Array<Array<{ uuid: string; state?: string; value: number | null }>> = [];
    const pending = buildPingOverviewMap(1, ["node-a", "node-b"], {}, [], undefined, undefined,
      async (_hours, _taskId, options) => {
        options?.onProgress?.(first, ["node-a"]);
        await slow;
        return { ...first, records: [...first.records, second], tasks: [{ ...first.tasks[0]!, clients: ["node-a", "node-b"] }] };
      }, undefined, result => snapshots.push([...result.singleItems].map(([uuid, item]) => ({ uuid, state: item.loadState, value: item.lastValue }))));
    await vi.waitFor(() => expect(snapshots).toContainEqual([
      { uuid: "node-a", state: "ready", value: 42 },
      { uuid: "node-b", state: "pending", value: null },
    ]));
    release();
    const result = await pending;
    expect(result.singleItems.get("node-b")).toMatchObject({ loadState: "ready", lastValue: 88 });
  });

  it.each([false, true])("keeps a completed node when a later node fails (explicit binding: %s)", async explicit => {
    const first = pingOverviewResponse(7, 42);
    const snapshots: Array<Array<{ uuid: string; state?: string; value: number | null }>> = [];
    const result = await buildPingOverviewMap(1, ["node-a", "node-b"], explicit ? { 7: ["node-a", "node-b"] } : {}, [], undefined, undefined,
      async (_hours, _taskId, options) => {
        options?.onProgress?.(first, ["node-a"]);
        throw new Error("Slow node disconnected");
      }, undefined, result => snapshots.push([...result.singleItems].map(([uuid, item]) => ({ uuid, state: item.loadState, value: item.lastValue }))));
    expect(snapshots).toContainEqual([
      { uuid: "node-a", state: "ready", value: 42 },
      { uuid: "node-b", state: "pending", value: null },
    ]);
    expect(result.singleItems.get("node-a")).toMatchObject({ loadState: "ready", lastValue: 42 });
    expect(result.singleItems.get("node-a")?.dataIssue).toBeUndefined();
    expect(result.singleItems.get("node-b")).toMatchObject({ loadState: "error", lastValue: null });
  });

  it("automatically uses native ICMP tasks without saved homepage bindings and falls back to TCPing", async () => {
    const icmp = pingOverviewResponse(20, 36);
    const tcp = pingOverviewResponse(10, 12);
    const load = vi.fn(async () => ({
      records: [...icmp.records, ...tcp.records, { ...tcp.records[0]!, client: "node-b", value: 48 }],
      tasks: [...icmp.tasks, { ...tcp.tasks[0]!, type: "tcp", clients: ["node-a", "node-b"] }],
      intervalSeconds: 60,
      stats: [],
    }));
    const result = await buildPingOverviewMap(1, ["node-a", "node-b"], {}, [], undefined, undefined, load);
    expect(load).toHaveBeenCalledWith(1, undefined, expect.objectContaining({ entityIds: ["node-a", "node-b"], includeStats: true }));
    expect(result.singleItems.get("node-a")).toMatchObject({ isAssigned: true, lastValue: 36, loss: 0, loadState: "ready" });
    expect(result.singleItems.get("node-b")).toMatchObject({ isAssigned: true, lastValue: 48, loss: 0, loadState: "ready" });
  });

  it("keeps an explicit task selection while automatically discovering unbound nodes", async () => {
    const load = vi.fn(async (_hours?: number, taskId?: number) => {
      const overview = pingOverviewResponse(taskId ?? 9, taskId === undefined ? 63 : 22);
      return taskId === undefined ? {
        ...overview,
        records: overview.records.map(record => ({ ...record, client: "node-b" })),
        tasks: overview.tasks.map(task => ({ ...task, clients: ["node-b"] })),
      } : overview;
    });
    const result = await buildPingOverviewMap(1, ["node-a", "node-b"], { 7: ["node-a"] }, [], undefined, undefined, load);
    expect(load).toHaveBeenCalledWith(1, 7, expect.objectContaining({ entityIds: ["node-a"] }));
    expect(load).toHaveBeenCalledWith(1, undefined, expect.objectContaining({ entityIds: ["node-b"] }));
    expect(result.singleItems.get("node-a")?.lastValue).toBe(22);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(63);
  });

  it("distinguishes no task, no recent samples and inaccessible native tasks", async () => {
    const task = pingOverviewResponse(20, 36).tasks[0]!;
    const result = await buildPingOverviewMap(1, ["none", "old", "denied"], {}, [], undefined, undefined, async () => ({
      records: [], tasks: [{ ...task, clients: ["old"] }],
      issues: { denied: { status: "forbidden" as const, message: "没有权限读取 Ping 数据" } },
      quality: "partial" as const,
    }));
    expect(result.singleItems.get("none")).toMatchObject({ isAssigned: false, lastValue: null, loss: null, loadState: "ready" });
    expect(result.singleItems.get("old")).toMatchObject({ isAssigned: true, lastValue: null, loss: null, loadState: "ready" });
    expect(result.singleItems.get("denied")).toMatchObject({ isAssigned: true, lastValue: null, loss: null, loadState: "error", dataIssue: { status: "forbidden" } });
    expect(result.singleItems.get("none")?.dataIssue).toBeUndefined();
  });

  it("shows discovery permission failures instead of claiming Ping is unconfigured", async () => {
    const result = await buildPingOverviewMap(1, ["node-a"], {}, [], undefined, undefined, async () => {
      throw new HttpRequestError("private", 403, "task_query");
    });
    expect(result.singleItems.get("node-a")).toMatchObject({ isAssigned: true, samples: [], loadState: "error", dataIssue: { status: "forbidden" } });
  });

  it("retains partial data warnings in single and multiple lines, then clears them on recovery", async () => {
    const loadPartial = async (_hours?: number, taskId?: number) => ({
      ...pingOverviewResponse(taskId ?? 1, 20),
      quality: "partial" as const,
      message: "部分任务无权限，统计不完整",
    });
    const partial = await buildPingOverviewMap(
      1, ["node-a"], { 1: ["node-a"] }, [], undefined, undefined, loadPartial,
    );
    const multiple = await buildPingOverviewMap(
      1, ["node-a"], {}, [1, 2, 3], undefined, undefined, loadPartial,
    );
    expect(partial.singleItems.get("node-a")).toMatchObject({
      lastValue: 20, loadState: "ready", dataIssue: { status: "partial", message: "部分任务无权限，统计不完整" },
    });
    expect(multiple.multiLines.get("node-a")?.every(line => line.dataIssue?.status === "partial")).toBe(true);
    expect(selectPersistablePingOverview(partial)?.singleItems[0][1].dataIssue?.status).toBe("partial");

    const recovered = await buildPingOverviewMap(
      1, ["node-a"], { 1: ["node-a"] }, [], undefined, partial,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 1, 25),
    );
    const multipleRecovered = await buildPingOverviewMap(
      1, ["node-a"], {}, [1, 2, 3], undefined, multiple,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 1, 25),
    );
    expect(recovered.singleItems.get("node-a")?.dataIssue).toBeUndefined();
    expect(multipleRecovered.multiLines.get("node-a")?.every(line => !line.dataIssue)).toBe(true);
  });

  it("keeps permission and missing-data failures distinct without fabricating samples", async () => {
    const result = await buildPingOverviewMap(
      1, ["node-a"], {}, [1, 2, 3], undefined, undefined,
      async (_hours, taskId) => {
        if (taskId === 1) throw new HttpRequestError("private", 403, "task_query");
        if (taskId === 2) throw new HttpRequestError("private", 404, "task_query");
        return pingOverviewResponse(taskId ?? 3, 20);
      },
    );
    const lines = result.multiLines.get("node-a") ?? [];
    expect(lines[0]).toMatchObject({ lastValue: null, samples: [], loadState: "error", dataIssue: { status: "forbidden" } });
    expect(lines[1]).toMatchObject({ lastValue: null, samples: [], loadState: "error", dataIssue: { status: "unavailable" } });
    expect(lines[2]).toMatchObject({ lastValue: 20, loadState: "ready" });
  });

  it("reports only the nodes affected by each completed task", async () => {
    const progress: Array<string[] | undefined> = [];
    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      { 1: ["node-a"], 2: ["node-b"] },
      [],
      undefined,
      undefined,
      async (_hours, taskId) => ({
        ...pingOverviewResponse(taskId ?? 0, taskId ?? 0),
        records: [
          {
            ...pingOverviewResponse(taskId ?? 0, taskId ?? 0).records[0],
            client: taskId === 1 ? "node-a" : "node-b",
          },
        ],
      }),
      undefined,
      (next) => progress.push(next.changedUuids),
    );

    expect(progress[0]).toEqual(["node-a", "node-b"]);
    expect(progress).toContainEqual(["node-a"]);
    expect(progress).toContainEqual(["node-b"]);
    expect(result.singleItems.get("node-a")?.lastValue).toBe(1);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(2);
  });

  it("requests multi-ping across all views when multi-ping is enabled and configured", () => {
    expect(resolveHomepagePingRequestMode("large", true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode("compact", true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode("mini", true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode("list", true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode("large", false, [1, 2, 3])).toBe("single");
    expect(resolveHomepagePingRequestMode("large", true, [1, 2])).toBe("multi");
    expect(resolveHomepagePingRequestMode("large", true, [])).toBe("single");
  });

  it("retains the previous line when one multi-ping task fails", async () => {
    const first = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10),
    );

    const second = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      first,
      async (_hours, taskId) => {
        if (taskId === 2) throw new Error("temporary task failure");
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10 + 100);
      },
    );

    expect(first.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      10,
      20,
      30,
    ]);
    expect(second.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      110,
      20,
      130,
    ]);
    expect(second.multiLines.get("node-a")?.map((line) => line.loadState)).toEqual([
      "ready",
      "error",
      "ready",
    ]);
    expect(second.multiLines.get("node-a")?.[1]?.taskName).toBe("Task 2");
  });

  it("reports all failed tasks and refuses to persist an empty placeholder result", async () => {
    const progress: string[][] = [];
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      { 8: ["node-a"] },
      [],
      undefined,
      undefined,
      async () => {
        throw new Error("temporary task failure");
      },
      undefined,
      (next) => {
        progress.push([next.pendingTaskIds.join(","), next.failedTaskIds.join(",")]);
      },
    );

    expect(result.successfulTaskIds).toEqual([]);
    expect(result.failedTaskIds).toEqual([8]);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.singleItems.get("node-a")).toMatchObject({ loadState: "error" });
    expect(progress).toContainEqual(["", "8"]);
    expect(selectPersistablePingOverview(result)).toBeNull();
  });

  it("persists only ready lines after a partial task failure", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, taskId ?? 0),
    );
    const partial = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      result,
      async (_hours, taskId) => {
        if (taskId === 2) throw new Error("temporary task failure");
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) + 100);
      },
    );

    const persisted = selectPersistablePingOverview(partial);
    const persistedLines = persisted?.multiLines.find(([uuid]) => uuid === "node-a")?.[1];
    expect(persistedLines?.map((line) => line.taskId)).toEqual([1, 3]);
    expect(persistedLines?.every((line) => line.loadState === "ready")).toBe(true);
  });

  it("keeps existing task data ready while a background refresh is pending", async () => {
    const previous = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, taskId ?? 0),
    );
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const progress: Array<{ pending: number[]; states: Array<string | undefined> }> = [];

    const refresh = buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      previous,
      async (_hours, taskId) => {
        await refreshGate;
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) + 100);
      },
      undefined,
      (next) => {
        progress.push({
          pending: next.pendingTaskIds,
          states: next.multiLines.get("node-a")?.map((line) => line.loadState) ?? [],
        });
      },
    );

    expect(progress[0]).toEqual({
      pending: [1, 2, 3],
      states: ["ready", "ready", "ready"],
    });
    releaseRefresh();
    await refresh;
  });

  it("emits a completed task before a slower task settles", async () => {
    let releaseSlowTask!: () => void;
    const slowTask = new Promise<void>((resolve) => {
      releaseSlowTask = resolve;
    });
    const progress: number[][] = [];
    const pending = buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => {
        if (taskId === 2) await slowTask;
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10);
      },
      undefined,
      (result) => {
        progress.push(
          result.multiLines.get("node-a")?.map((line) => line.lastValue ?? -1) ?? [],
        );
      },
    );

    await vi.waitFor(() => {
      expect(progress.some((values) => values[0] === 10 && values[1] === -1)).toBe(true);
    });

    releaseSlowTask();
    const result = await pending;
    expect(result.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      10,
      20,
      30,
    ]);
  });

  it("loads all selected task stats once and reuses them across task series", async () => {
    const loadOverview = vi.fn(
      async (
        _hours?: number,
        taskId?: number,
        _options?: {
          signal?: AbortSignal;
          entityIds?: string[];
          includeStats?: boolean;
        },
      ) => {
        void _hours;
        void _options;
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10);
      },
    );
    const loadStats = vi.fn(async (_hours: number, taskIds: number[]) =>
      taskIds.map((taskId) => ({
        client: "node-a",
        taskId,
        name: `Server Task ${taskId}`,
        type: "icmp",
        interval: 60,
        total: 10,
        valid: 10,
        loss: 0,
        min: 10,
        max: 200 + taskId,
        avg: 50,
        latest: 100 + taskId,
        p50: 40,
        p99: 80,
        stddev: 5,
        p99P50Ratio: 1,
      })),
    );

    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      loadOverview,
      loadStats,
    );

    expect(loadStats).toHaveBeenCalledTimes(1);
    expect(loadStats).toHaveBeenCalledWith(
      1,
      [1, 2, 3],
      expect.objectContaining({ entityIds: ["node-a"] }),
    );
    expect(loadOverview).toHaveBeenCalledTimes(3);
    expect(loadOverview.mock.calls.every((call) => call[2]?.includeStats === false)).toBe(true);
    expect(result.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      101,
      102,
      103,
    ]);
  });

  it("propagates polling cancellation to an in-flight request", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const pending = buildPingOverviewMap(
      1,
      ["node-a"],
      { 8: ["node-a"] },
      [],
      controller.signal,
      undefined,
      async (_hours, taskId, options) => {
        requestSignal = options?.signal;
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return pingOverviewResponse(taskId ?? 0, 80);
      },
    );

    await Promise.resolve();
    controller.abort();
    const result = await pending;

    expect(requestSignal?.aborted).toBe(true);
    expect(result.singleItems.get("node-a")?.lastValue).toBeNull();
  });

  it("resolves real task names via loadTasks even if overview returns fallback names", async () => {
    const loadOverview = vi.fn(async (_hours?: number, taskId?: number) => ({
      records: [{ task_id: taskId ?? 1, time: 1000, value: 50, client: "node-a", loss: 0 }],
      tasks: [{ id: taskId ?? 1, name: `任务 #${taskId}`, interval: 60, loss: 0, clients: [], type: "icmp" as const, target: "", weight: 1 }],
      stats: [],
      intervalSeconds: 60,
    }));
    const loadTasks = vi.fn(async () => [
      { id: 1, name: "西南电信", interval: 60, loss: 0, clients: [], type: "icmp" as const, target: "", weight: 1 },
      { id: 2, name: "西南联通", interval: 60, loss: 0, clients: [], type: "icmp" as const, target: "", weight: 2 },
    ]);

    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2],
      undefined,
      undefined,
      loadOverview,
      undefined,
      undefined,
      loadTasks,
    );

    expect(result.multiLines.get("node-a")?.map((l) => l.taskName)).toEqual(["西南电信", "西南联通"]);
  });

  it("does not overwrite real task names from previous state with fallback names", async () => {
    const previousResult = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1],
      undefined,
      undefined,
      async () => ({
        records: [{ task_id: 1, time: 1000, value: 50, client: "node-a", loss: 0 }],
        tasks: [{ id: 1, name: "西南电信", interval: 60, loss: 0, clients: [], type: "icmp" as const, target: "", weight: 1 }],
        stats: [],
        intervalSeconds: 60,
      }),
    );

    const nextResult = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1],
      undefined,
      previousResult,
      async () => ({
        records: [{ task_id: 1, time: 2000, value: 45, client: "node-a", loss: 0 }],
        tasks: [{ id: 1, name: "任务 #1", interval: 60, loss: 0, clients: [], type: "icmp" as const, target: "", weight: 1 }],
        stats: [],
        intervalSeconds: 60,
      }),
      undefined,
      undefined,
      async () => [],
    );

    expect(nextResult.multiLines.get("node-a")?.[0]?.taskName).toBe("西南电信");
  });
});
