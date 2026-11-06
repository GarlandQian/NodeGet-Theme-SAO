import { HttpRequestError } from "@/services/requestErrors";

export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export interface RpcCaller {
  call<T = unknown>(method: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
  close(): void;
}

export class NodeGetRpcError extends HttpRequestError {
  constructor(readonly code: number, method: string) {
    // 不回显服务端 message/data：错误正文有可能包含传入的凭据。
    super(
      code === 102 ? "没有权限读取这项数据" :
      code === 105 || code === 106 || code === 107 ? "暂无数据或尚未配置" :
      code === -32601 ? "当前主控不支持这项接口" : "NodeGet 数据请求失败，请稍后重试",
      code === 102 ? 403 : [105, 106, 107].includes(code) ? 404 : 502,
      method,
    );
    this.name = "NodeGetRpcError";
  }
}

export function normalizeBackendUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("主控地址必须是有效的 WS/WSS 地址，且不能包含用户名或密码");
  }
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/nodeget/rpc";
  url.hash = "";
  return url.href;
}

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/** 等待共享操作时只取消当前订阅，不误取消其他消费者。 */
export function waitFor<T>(promise: Promise<T>, options: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const onAbort = () => finish(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    promise.then(value => finish(undefined, value), error => finish(error));
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });
    if (!settled && options.timeout !== undefined) {
      if (options.timeout <= 0) finish(new DOMException("Request timed out", "TimeoutError"));
      else timer = setTimeout(() => finish(new DOMException("Request timed out", "TimeoutError")), options.timeout);
    }
  });
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  method: string;
}

export class NodeGetRpcClient implements RpcCaller {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private cancelConnect: (() => void) | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private disposed = false;
  readonly url: string;

  constructor(
    backendUrl: string,
    private readonly token: string,
    private readonly createSocket: (url: string) => WebSocket = url => new WebSocket(url),
  ) {
    this.url = normalizeBackendUrl(backendUrl);
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<T> {
    aborted(options.signal);
    if (this.disposed) throw new Error("主控连接已关闭");
    const deadline = Date.now() + (options.timeout ?? 12_000);
    await waitFor(this.connect(), { ...options, timeout: deadline - Date.now() });
    aborted(options.signal);
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error("主控连接已断开");
    const id = ++this.nextId;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, token: this.token } }));
      } catch {
        reject(new Error("无法发送主控请求"));
      }
    });
    try {
      return await waitFor(response, { ...options, timeout: deadline - Date.now() }) as T;
    } finally {
      this.pending.delete(id);
    }
  }

  close(): void {
    this.disposed = true;
    const socket = this.socket;
    this.cancelConnect?.();
    this.socket = null;
    socket?.close(1000, "Theme closed");
    this.rejectPending(new Error("主控连接已关闭"));
  }

  private connect(): Promise<void> {
    if (this.socket?.readyState === 1) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const attempt = new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try { socket = this.createSocket(this.url); }
      catch { reject(new Error("无法连接主控，请检查连接地址")); return; }
      this.socket = socket;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelConnect = null;
        if (error) reject(error); else resolve();
      };
      const disconnect = (error: Error) => {
        finish(error);
        if (this.socket === socket) {
          this.socket = null;
          this.rejectPending(error);
        }
      };
      const timer = setTimeout(() => {
        disconnect(new DOMException("Connection timed out", "TimeoutError"));
        socket.close();
      }, 10_000);
      this.cancelConnect = () => disconnect(new Error("主控连接已关闭"));
      socket.onopen = () => finish();
      socket.onerror = () => {
        disconnect(new Error("主控连接失败，请检查网络和连接地址"));
        socket.close();
      };
      socket.onclose = () => disconnect(new Error("主控连接已断开，正在等待重连"));
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        let message: { id?: unknown; result?: unknown; error?: { code?: unknown; data?: { error_id?: unknown } } };
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (!message || typeof message.id !== "number") return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          const code = Number(message.error.data?.error_id ?? message.error.code ?? 999);
          pending.reject(new NodeGetRpcError(code, pending.method));
        } else if (Object.hasOwn(message, "result")) pending.resolve(message.result);
        else pending.reject(new Error("主控返回了无效响应"));
      };
    });
    this.connecting = attempt;
    void attempt.then(
      () => { if (this.connecting === attempt) this.connecting = null; },
      () => { if (this.connecting === attempt) this.connecting = null; },
    );
    return attempt;
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
