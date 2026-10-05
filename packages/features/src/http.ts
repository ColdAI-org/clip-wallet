import { ClipError, msg } from "@clip-wallet/core";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * fetch → JSON with plain-language errors. `what` names the service in the message
 * ("Jupiter didn't answer…"). Never puts headers (API keys) into errors.
 */
export async function fetchJson<T>(fetchImpl: typeof fetch, url: string, what: string, opts: HttpOptions = {}): Promise<T> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) : undefined;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: { accept: "application/json", ...(opts.body === undefined ? {} : { "content-type": "application/json" }), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctl?.signal,
    });
  } catch (cause) {
    throw new ClipError(msg("bg.err.couldntReach", { what }), "features/unreachable", cause);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 429) throw new ClipError(msg("bg.err.isBusy", { what }), "features/rate-limited");
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = undefined;
    }
    throw new ClipError(`${what} couldn't answer that right now. Try again in a moment.`, `features/http-${res.status}`, detail);
  }
  return (await res.json()) as T;
}

/** JSON-RPC eth_call against an EVM endpoint. */
export async function ethCall(fetchImpl: typeof fetch, rpcUrl: string, to: string, data: string, what = "the network"): Promise<`0x${string}`> {
  const body = await fetchJson<{ result?: string; error?: { message?: string } }>(fetchImpl, rpcUrl, what, {
    body: { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] },
  });
  if (body.error || typeof body.result !== "string") {
    throw new ClipError(`${what} couldn't read that right now.`, "features/eth-call-failed", body.error);
  }
  return body.result as `0x${string}`;
}

/** Hedera mirror node contract call (read-only simulation, free). Docs: POST /api/v1/contracts/call. */
export async function mirrorCall(fetchImpl: typeof fetch, mirrorBase: string, to: string, data: string, what = "Hedera"): Promise<`0x${string}`> {
  const body = await fetchJson<{ result?: string }>(fetchImpl, `${mirrorBase.replace(/\/+$/, "")}/api/v1/contracts/call`, what, {
    body: { block: "latest", data, to, estimate: false },
  });
  if (typeof body.result !== "string") throw new ClipError(`${what} couldn't read that right now.`, "features/contract-call-failed");
  return body.result as `0x${string}`;
}
