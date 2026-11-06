import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeGetRpcClient, NodeGetRpcError, normalizeBackendUrl } from "../nodeget/rpc";

class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  messages: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  send(data: string) { this.messages.push(JSON.parse(data)); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  reply(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const clients: NodeGetRpcClient[] = [];
function setup() {
  const sockets: Socket[] = [];
  const client = new NodeGetRpcClient("https://monitor.example", "read-only-test", () => {
    const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  clients.push(client);
  return { client, sockets };
}
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
afterEach(() => { clients.splice(0).forEach(client => client.close()); vi.useRealTimers(); });

describe("NodeGet native WebSocket RPC", () => {
  it("normalizes only transport and default path, preserving custom RPC paths", () => {
    expect(normalizeBackendUrl("https://monitor.example")).toBe("wss://monitor.example/nodeget/rpc");
    expect(normalizeBackendUrl("http://monitor.example/custom/rpc")).toBe("ws://monitor.example/custom/rpc");
    expect(() => normalizeBackendUrl("ftp://monitor.example")).toThrow();
  });
  it("multiplexes calls with the scoped token and accepts responses out of order", async () => {
    const { client, sockets } = setup();
    const one = client.call("one");
    const two = client.call("two", { uuids: ["n1"] });
    sockets[0]!.open(); await settle();
    expect(sockets).toHaveLength(1);
    const [a, b] = sockets[0]!.messages;
    expect(b?.params).toEqual({ uuids: ["n1"], token: "read-only-test" });
    sockets[0]!.reply({ jsonrpc: "2.0", id: b!.id, result: [2] });
    sockets[0]!.reply({ jsonrpc: "2.0", id: a!.id, result: [1] });
    await expect(one).resolves.toEqual([1]); await expect(two).resolves.toEqual([2]);
  });
  it("times out while connecting and does not send the expired request later", async () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const result = client.call("slow", {}, { timeout: 20 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ name: "TimeoutError" });
    sockets[0]!.open(); await settle();
    expect(sockets[0]!.messages).toHaveLength(0);
  });
  it("clears pending calls on disconnect and reconnects on the next read", async () => {
    const { client, sockets } = setup();
    const result = client.call("first").catch(error => error);
    sockets[0]!.open(); await settle(); sockets[0]!.close();
    expect(await result).toBeInstanceOf(Error);
    const next = client.call("second");
    sockets[1]!.open(); await settle();
    sockets[1]!.reply({ id: sockets[1]!.messages[0]!.id, result: "ok" });
    await expect(next).resolves.toBe("ok");
  });
  it("closes the actual socket when disposed during connection establishment", async () => {
    const { client, sockets } = setup();
    const pending = client.call("first").catch(error => error);
    expect(sockets[0]!.readyState).toBe(0);
    client.close();
    expect(sockets[0]!.readyState).toBe(3);
    expect(await pending).toBeInstanceOf(Error);
  });
  it("cancels one call without disturbing the other and ignores late responses", async () => {
    const { client, sockets } = setup();
    const controller = new AbortController();
    const one = client.call("one", {}, { signal: controller.signal }).catch(error => error);
    const two = client.call("two");
    sockets[0]!.open(); await settle(); controller.abort();
    expect(await one).toMatchObject({ name: "AbortError" });
    const [a, b] = sockets[0]!.messages;
    sockets[0]!.reply({ id: a!.id, result: "late" });
    sockets[0]!.reply({ id: b!.id, result: "ok" });
    await expect(two).resolves.toBe("ok");
  });
  it("maps permissions and never exposes server error text or token data", async () => {
    const { client, sockets } = setup();
    const promise = client.call("task_query").catch(error => error);
    sockets[0]!.open(); await settle();
    sockets[0]!.reply({ id: sockets[0]!.messages[0]!.id, error: { code: 102, message: "read-only-test", data: { dangerous: "read-only-test" } } });
    const error = await promise;
    expect(error).toBeInstanceOf(NodeGetRpcError); expect(error).toMatchObject({ status: 403 });
    expect(String(error)).not.toContain("read-only-test");
  });
});
