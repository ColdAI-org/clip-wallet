import { ClipError, msg } from "@clip-wallet/core";

/**
 * A small Electrum Cash protocol (1.4) client over WebSocket for public Fulcrum servers
 * (https://electrum-cash-protocol.readthedocs.io). One session per wallet operation: open, `server.version`, the
 * calls, close. Servers are tried in order; the next one is used when one can't be reached or times out. An error
 * the server answers with (e.g. a rejected broadcast) is not retried elsewhere.
 */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export const defaultSocketFactory: SocketFactory = (url) => {
  const WS = (globalThis as { WebSocket?: new (u: string) => SocketLike }).WebSocket;
  if (!WS) throw new Error("no WebSocket in this environment");
  return new WS(url);
};

export class ElectrumError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

class Connection {
  #id = 0;
  readonly #pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  #closed = false;

  constructor(
    readonly url: string,
    readonly socket: SocketLike,
    readonly timeoutMs: number,
  ) {
    socket.onmessage = (ev) => {
      let m: { id?: number; result?: unknown; error?: { message?: string; code?: number } | string };
      try {
        m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      const p = typeof m.id === "number" ? this.#pending.get(m.id) : undefined;
      if (!p) return; // notifications
      this.#pending.delete(m.id!);
      clearTimeout(p.timer);
      if (m.error !== undefined && m.error !== null) {
        const e = typeof m.error === "string" ? { message: m.error } : m.error;
        p.reject(new ElectrumError(String(e.message ?? "server error"), e.code));
      } else p.resolve(m.result);
    };
    const fail = () => this.#failAll(new Error("connection closed"));
    socket.onclose = fail;
    socket.onerror = fail;
  }

  #failAll(e: Error) {
    this.#closed = true;
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.#pending.clear();
  }

  call<T>(method: string, params: unknown[]): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("connection closed"));
    const id = ++this.#id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("timeout"));
      }, this.timeoutMs);
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  close() {
    this.#closed = true;
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

function open(url: string, factory: SocketFactory, timeoutMs: number): Promise<Connection> {
  return new Promise((resolve, reject) => {
    let socket: SocketLike;
    try {
      socket = factory(url);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error("connect timeout"));
    }, timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(new Connection(url, socket, timeoutMs));
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("connect failed"));
    };
  });
}

export interface ElectrumOptions {
  factory?: SocketFactory;
  timeoutMs?: number;
  clientName?: string;
}

export type Call = <T>(method: string, params?: unknown[]) => Promise<T>;

/**
 * Runs `fn` against the first server that answers `server.version`. A transport failure inside `fn` (closed socket,
 * timeout) moves on to the next server and runs `fn` again; an ElectrumError (the server's own answer) does not.
 */
export async function withElectrum<T>(urls: readonly string[], opts: ElectrumOptions, fn: (call: Call) => Promise<T>): Promise<T> {
  const factory = opts.factory ?? defaultSocketFactory;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  let last: unknown;
  for (const url of urls) {
    let c: Connection | undefined;
    try {
      c = await open(url, factory, timeoutMs);
      await c.call("server.version", [opts.clientName ?? "Clip Wallet", "1.4"]);
      const call: Call = (method, params = []) => c!.call(method, params);
      return await fn(call);
    } catch (e) {
      if (e instanceof ElectrumError || e instanceof ClipError) throw e;
      last = e;
    } finally {
      c?.close();
    }
  }
  throw new ClipError(msg("bg.err.couldntReach", { what: "Bitcoin Cash" }), "bitcoincash/offline", last);
}

/* ------------------------------------------------------------------ response shapes (Fulcrum 2.x) */

export interface ElectrumUtxo {
  tx_hash: string;
  tx_pos: number;
  height: number;
  value: number;
  /** CashTokens (Fulcrum ≥ 1.9): present when the output carries tokens. */
  token_data?: { category: string; amount?: string; nft?: { capability: "none" | "mutable" | "minting"; commitment: string } };
}

export interface ElectrumBalance {
  confirmed: number;
  unconfirmed: number;
}
