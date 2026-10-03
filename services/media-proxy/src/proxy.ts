/**
 * GET /v1/media?src=<canonical source>&kind=image|video
 *
 *  1. Re-validate the source with @clip-wallet/media-client (same rules the UI used).
 *  2. Fetch it (ipfs:// and ar:// through the configured gateways), following at most 3 redirects by hand and
 *     re-validating every hop, so a redirect can't reach a private address or a disallowed scheme.
 *  3. Sniff the first bytes; only PNG/JPEG/GIF/WebP/AVIF/SVG/MP4/WebM pass, and the kind must match.
 *  4. Enforce the size cap from Content-Length and again while streaming.
 *  5. Answer with a fresh header set (nothing from upstream: no cookies, no CSP/CORS from the origin), a
 *     sandboxing CSP (SVG scripts can't run even if the file is opened directly), and cache it.
 */
import {
  type AllowedMediaType,
  type MediaKind,
  type MediaSource,
  MEDIA_LIMITS,
  kindOfType,
  normaliseMediaSource,
  parseProxyQuery,
  sniffMediaType,
} from "@clip-wallet/media-client";

export interface Env {
  IPFS_GATEWAY?: string;
  ARWEAVE_GATEWAY?: string;
  MEDIA_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export interface ProxyDeps {
  /** Upstream fetch (tests inject one). */
  fetch?: typeof fetch;
  /** Cache (defaults to caches.default); null disables. */
  cache?: Cache | null;
  timeoutMs?: number;
}

const SNIFF_BYTES = 1024;

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  // Applies if the response is ever opened as a document (e.g. an SVG in a new tab): no scripts, no requests.
  "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  "cross-origin-resource-policy": "cross-origin",
  "access-control-allow-origin": "*",
  "referrer-policy": "no-referrer",
  "content-disposition": "inline",
};

class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function errorResponse(status: number, code: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json", "cache-control": status === 404 || status === 415 ? "public, max-age=3600" : "no-store", ...SECURITY_HEADERS, ...extra },
  });
}

/** ipfs:// / ar:// → a gateway URL; http(s) unchanged. */
export function upstreamUrl(src: MediaSource, env: Env): string {
  const ipfs = (env.IPFS_GATEWAY ?? "https://ipfs.filebase.io").replace(/\/+$/, "");
  const ar = (env.ARWEAVE_GATEWAY ?? "https://arweave.net").replace(/\/+$/, "");
  if (src.scheme === "ipfs") return `${ipfs}/ipfs/${src.url.slice("ipfs://".length)}`;
  if (src.scheme === "ar") return `${ar}/${src.url.slice("ar://".length)}`;
  return src.url;
}

function maxBytes(kind: MediaKind): number {
  return kind === "video" ? MEDIA_LIMITS.maxVideoBytes : MEDIA_LIMITS.maxImageBytes;
}

async function fetchUpstream(first: MediaSource, env: Env, f: typeof fetch, timeoutMs: number): Promise<Response> {
  let src = first;
  for (let hop = 0; hop <= MEDIA_LIMITS.maxRedirects; hop++) {
    const url = upstreamUrl(src, env);
    let res: Response;
    try {
      res = await f(url, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "image/*,video/*;q=0.9", "user-agent": "ClipWalletMediaProxy/1" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ProxyError(502, "upstream-unreachable");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new ProxyError(502, "bad-redirect");
      let next: string;
      try {
        next = new URL(loc, url).toString();
      } catch {
        throw new ProxyError(502, "bad-redirect");
      }
      const v = normaliseMediaSource(next);
      if (!v) throw new ProxyError(403, "redirect-blocked");
      src = v;
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      throw new ProxyError(404, "not-found");
    }
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel();
      throw new ProxyError(502, "upstream-error");
    }
    return res;
  }
  throw new ProxyError(502, "too-many-redirects");
}

/** Reads at least `n` bytes (or to EOF) and returns them plus a stream of the whole body, capped at `cap`. */
async function sniffAndCap(body: ReadableStream<Uint8Array>, n: number, cap: number): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array>; complete: Uint8Array | null }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let have = 0;
  let done = false;
  while (have < n) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    chunks.push(r.value);
    have += r.value.byteLength;
    if (have > cap) {
      await reader.cancel();
      throw new ProxyError(413, "too-large");
    }
  }
  const head = new Uint8Array(have);
  let o = 0;
  for (const c of chunks) {
    head.set(c, o);
    o += c.byteLength;
  }
  if (done) return { head, stream: new Blob([head]).stream(), complete: head };
  let sent = have;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(head);
    },
    async pull(ctrl) {
      const r = await reader.read();
      if (r.done) return ctrl.close();
      sent += r.value.byteLength;
      if (sent > cap) {
        await reader.cancel();
        return ctrl.error(new Error("too large"));
      }
      ctrl.enqueue(r.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head, stream, complete: null };
}

function cacheKey(src: MediaSource, kind: MediaKind): Request {
  return new Request(`https://media-proxy.cache/v1/${kind}?src=${encodeURIComponent(src.url)}`);
}

export function createProxy(deps: ProxyDeps = {}) {
  const timeoutMs = deps.timeoutMs ?? 15_000;

  async function serve(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/v1/health") return new Response("ok", { headers: { "cache-control": "no-store" } });
    if (url.pathname !== "/v1/media") return errorResponse(404, "not-found");
    if (req.method !== "GET" && req.method !== "HEAD") return errorResponse(405, "method-not-allowed", { allow: "GET, HEAD" });

    const q = parseProxyQuery(url.searchParams);
    if (!q) return errorResponse(400, "bad-source");

    if (env.MEDIA_LIMITER) {
      const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.MEDIA_LIMITER.limit({ key: ip });
      if (!success) return errorResponse(429, "rate-limited", { "retry-after": "60" });
    }

    const cache = deps.cache === undefined ? (globalThis as unknown as { caches?: CacheStorage & { default: Cache } }).caches?.default ?? null : deps.cache;
    const key = cacheKey(q.source, q.kind);
    if (cache) {
      const hit = await cache.match(key);
      if (hit) return req.method === "HEAD" ? new Response(null, hit) : hit;
    }

    try {
      const f = deps.fetch ?? globalThis.fetch.bind(globalThis);
      const upstream = await fetchUpstream(q.source, env, f, timeoutMs);
      const cap = maxBytes(q.kind);
      const declared = Number(upstream.headers.get("content-length") ?? "NaN");
      if (Number.isFinite(declared) && declared > cap) {
        await upstream.body!.cancel();
        throw new ProxyError(413, "too-large");
      }
      const { head, stream, complete } = await sniffAndCap(upstream.body!, SNIFF_BYTES, cap);
      const type: AllowedMediaType | null = sniffMediaType(head);
      if (!type || kindOfType(type) !== q.kind) {
        await stream.cancel();
        throw new ProxyError(415, "unsupported-type");
      }
      const immutable = q.source.scheme === "ipfs" || q.source.scheme === "ar";
      const headers: Record<string, string> = {
        ...SECURITY_HEADERS,
        "content-type": type,
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=86400",
      };
      if (complete) headers["content-length"] = String(complete.byteLength);
      else if (Number.isFinite(declared)) headers["content-length"] = String(declared);
      const res = new Response(stream, { status: 200, headers });
      if (cache) {
        const toCache = res.clone();
        const put = cache.put(key, toCache).catch(() => undefined);
        if (ctx) ctx.waitUntil(put);
        else await put;
      }
      return req.method === "HEAD" ? new Response(null, { status: 200, headers }) : res;
    } catch (e) {
      if (e instanceof ProxyError) return errorResponse(e.status, e.code);
      return errorResponse(502, "upstream-error");
    }
  }

  return { fetch: serve };
}
