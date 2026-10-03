import { ClipError, type Network } from "@clip-wallet/core";

/** A JSON-RPC error the node returned (the request reached a node; trying another URL will not help). */
export class RpcError extends Error {
  constructor(public readonly rpcCode: number, message: string, public readonly data?: unknown) {
    super(message);
  }
}

let nextId = 1;

/**
 * JSON-RPC over the context's fetch. Transport failures fall through to the next public RPC URL;
 * JSON-RPC errors are returned to the caller as RpcError.
 */
export async function rpc<T = unknown>(network: Network, f: typeof fetch, method: string, params: unknown[] = []): Promise<T> {
  let lastErr: unknown;
  for (const url of network.rpcUrls) {
    let body: { result?: T; error?: { code: number; message: string; data?: unknown } };
    try {
      const res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = (await res.json()) as typeof body;
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data);
    return body.result as T;
  }
  throw new ClipError("We couldn't reach the network. Check your connection and try again.", "rpc-unreachable", lastErr);
}

export async function getJson<T = unknown>(f: typeof fetch, url: string): Promise<T | undefined> {
  try {
    const res = await f(url, { headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}
