import { aborted, waitFor, type RequestOptions, type RpcCaller } from "./rpc";

interface Job {
  key: string;
  caller: RpcCaller;
  method: string;
  params: Record<string, unknown>;
  controller: AbortController;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  consumers: number;
}

/** 所有主控共享历史查询预算；同一请求可共享，取消不影响其他订阅者。 */
export class HistoryScheduler {
  private readonly ids = new WeakMap<RpcCaller, number>();
  private readonly jobs = new Map<string, Job>();
  private readonly cache = new Map<string, { expires: number; value: unknown }>();
  private readonly queue: Job[] = [];
  private nextId = 0;
  private active = 0;

  constructor(private readonly concurrency = 4, private readonly ttl = 15_000) {}

  async call<T = unknown>(caller: RpcCaller, method: string, params: Record<string, unknown>, options: RequestOptions = {}): Promise<T> {
    aborted(options.signal);
    let id = this.ids.get(caller);
    if (id === undefined) { id = ++this.nextId; this.ids.set(caller, id); }
    const key = `${id}:${method}:${JSON.stringify(params)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value) as T;
    this.cache.delete(key);
    let job = this.jobs.get(key);
    if (!job) {
      let resolve!: Job["resolve"];
      let reject!: Job["reject"];
      const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
      job = { key, caller, method, params, controller: new AbortController(), promise, resolve, reject, consumers: 0 };
      this.jobs.set(key, job);
      this.queue.push(job);
    }
    job.consumers++;
    this.drain();
    try {
      return structuredClone(await waitFor(job.promise, { ...options, timeout: options.timeout ?? 30_000 })) as T;
    } finally {
      job.consumers--;
      if (!job.consumers && this.jobs.get(key) === job) {
        this.jobs.delete(key);
        job.controller.abort();
        job.reject(new DOMException("Aborted", "AbortError"));
      }
    }
  }

  close(): void {
    for (const job of this.jobs.values()) { job.controller.abort(); job.reject(new Error("查询已关闭")); }
    this.jobs.clear();
    this.cache.clear();
    this.queue.length = 0;
  }

  private drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (this.jobs.get(job.key) !== job) continue;
      this.active++;
      void this.execute(job);
    }
  }

  private async execute(job: Job) {
    try {
      const value = await job.caller.call(job.method, job.params, { signal: job.controller.signal, timeout: 30_000 });
      if (this.jobs.get(job.key) !== job) return;
      this.cache.set(job.key, { value, expires: Date.now() + this.ttl });
      for (const [key, entry] of this.cache) if (entry.expires <= Date.now()) this.cache.delete(key);
      while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
      job.resolve(value);
    } catch (error) { job.reject(error); }
    finally {
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.active--;
      this.drain();
    }
  }
}

export class IncompleteHistoryError extends Error {
  constructor() { super("记录数量超过查询上限，请缩短时间范围后重试"); this.name = "IncompleteHistoryError"; }
}

/** NodeGet 查询使用闭区间。命中上限时递归细分，不能将截断结果当成完整统计。 */
export async function queryCompleteWindow<T>(
  start: number,
  end: number,
  query: (start: number, end: number) => Promise<T[]>,
  budget = { remaining: 128 },
): Promise<T[]> {
  if (--budget.remaining < 0) throw new IncompleteHistoryError();
  const rows = await query(start, end);
  if (rows.length < 10_000) return rows;
  if (start >= end) throw new IncompleteHistoryError();
  const middle = Math.floor(start + (end - start) / 2);
  return [
    ...await queryCompleteWindow(start, middle, query, budget),
    ...await queryCompleteWindow(middle + 1, end, query, budget),
  ];
}
