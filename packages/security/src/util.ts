import { ClipError } from "@clip-wallet/core";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** "text" returns the raw body (YAML lists). */
  as?: "json" | "text";
}

/**
 * fetch with a timeout and plain-language errors naming the service. Never puts headers (API keys) into
 * errors or messages.
 */
export async function fetchJson<T>(fetchImpl: typeof fetch, url: string, what: string, opts: HttpOptions = {}): Promise<T> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) : undefined;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: { accept: opts.as === "text" ? "*/*" : "application/json", ...(opts.body === undefined ? {} : { "content-type": "application/json" }), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctl?.signal,
    });
  } catch (cause) {
    throw new ClipError(`Couldn't reach ${what} right now. Check your connection and try again.`, "security/unreachable", cause);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 429) throw new ClipError(`${what} is busy right now. Try again in a minute.`, "security/rate-limited");
  if (!res.ok) throw new ClipError(`${what} couldn't answer that right now. Try again in a moment.`, `security/http-${res.status}`);
  return (opts.as === "text" ? await res.text() : await res.json()) as T;
}

export class JsonRpcError extends Error {
  constructor(
    public readonly rpcCode: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** One JSON-RPC call. Throws JsonRpcError for an RPC-level error so callers can react (e.g. "range too large"). */
export async function rpcCall<T>(fetchImpl: typeof fetch, url: string, method: string, params: unknown[], what = "the network"): Promise<T> {
  const body = await fetchJson<{ result?: T; error?: { code?: number; message?: string } }>(fetchImpl, url, what, {
    body: { jsonrpc: "2.0", id: 1, method, params },
  });
  if (body.error) throw new JsonRpcError(body.error.code, body.error.message ?? "rpc error");
  return body.result as T;
}

export function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function shortAddress(a: string): string {
  return a.length > 14 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

/** Hostname of an origin or URL, lowercased, without a trailing dot. Null for non-web origins ("wallet"). */
export function hostOf(originOrUrl: string): string | null {
  try {
    const u = new URL(originOrUrl.includes("://") ? originOrUrl : `https://${originOrUrl}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase().replace(/\.$/, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]!);
    }
  });
  await Promise.all(workers);
  return out;
}
