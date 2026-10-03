/**
 * @clip-wallet/media-client — the one place that decides what an untrusted NFT media URL may become.
 *
 * Shared by the UI (to build proxy URLs) and services/media-proxy (to re-validate them), so both sides
 * agree on what is allowed. Pure functions, no I/O.
 *
 * Rules:
 *  - Sources: https, http, ipfs:// (CIDv0/CIDv1), ar:// (43-char Arweave tx id). Public IPFS/Arweave gateway
 *    URLs are rewritten to ipfs:// / ar:// so the proxy uses its own gateway and caches one copy.
 *  - Never: data:, blob:, javascript:, file:, credentials in the URL, non-default ports, IP literals in
 *    private/loopback/link-local ranges, localhost/.local/.internal names.
 *  - Output types: raster images, SVG (served sandboxed), mp4/webm video. Decided by sniffing bytes in the
 *    proxy, never by the URL or the upstream Content-Type alone.
 */

export type MediaKind = "image" | "video";

export interface MediaSource {
  /** Canonical source: https://…, http://…, ipfs://<cid>[/path] or ar://<txid>[/path]. */
  url: string;
  scheme: "https" | "http" | "ipfs" | "ar";
}

export const MEDIA_LIMITS = {
  /** Bytes. Larger upstream bodies are cut off and rejected. */
  maxImageBytes: 10 * 1024 * 1024,
  maxVideoBytes: 50 * 1024 * 1024,
  maxSourceLength: 2048,
  maxRedirects: 3,
} as const;

export const ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
] as const;
export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1 = /^b[a-z2-7]{50,}$/;
const AR_TX = /^[A-Za-z0-9_-]{43}$/;
/** Well-known public gateways whose /ipfs/<cid> URLs are rewritten to ipfs://. */
const IPFS_PATH = /^\/ipfs\/([^/?#]+)(\/[^?#]*)?$/;
const SAFE_PATH = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)*$/;

function isCid(s: string): boolean {
  return CID_V0.test(s) || CID_V1.test(s);
}

function safeSubpath(p: string | undefined): string | null {
  if (!p || p === "/") return "";
  if (!SAFE_PATH.test(p) || p.includes("/../") || p.endsWith("/..")) return null;
  return p;
}

/** True for hostnames the proxy must never fetch (SSRF guard). Expects a WHATWG-normalised hostname. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h.startsWith("[")) return true; // IPv6 literals: nothing legitimate needs them
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  if (!h.includes(".")) return true; // single-label names resolve on local networks only
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
  }
  return false;
}

/**
 * Canonicalises an untrusted media reference. Returns null for anything that isn't allowed.
 */
export function normaliseMediaSource(raw: string | null | undefined): MediaSource | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.length > MEDIA_LIMITS.maxSourceLength) return null;

  if (/^ipfs:\/\//i.test(s)) {
    const rest = s.slice(7).replace(/^ipfs\//i, "");
    const [cid, ...path] = rest.split("/");
    if (!cid || !isCid(cid)) return null;
    const sub = safeSubpath(path.length ? `/${path.join("/")}` : undefined);
    if (sub === null) return null;
    return { url: `ipfs://${cid}${sub}`, scheme: "ipfs" };
  }
  if (/^ar:\/\//i.test(s)) {
    const [tx, ...path] = s.slice(5).split("/");
    if (!tx || !AR_TX.test(tx)) return null;
    const sub = safeSubpath(path.length ? `/${path.join("/")}` : undefined);
    if (sub === null) return null;
    return { url: `ar://${tx}${sub}`, scheme: "ar" };
  }
  if (isCid(s.split("/")[0] ?? "")) return normaliseMediaSource(`ipfs://${s}`);

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  if (isBlockedHost(u.hostname)) return null;

  // Gateway URLs → ipfs:// (path gateway or subdomain gateway), arweave.net/<tx> → ar://
  const ip = IPFS_PATH.exec(u.pathname);
  if (ip && ip[1] && isCid(ip[1]) && !u.search) return normaliseMediaSource(`ipfs://${ip[1]}${ip[2] ?? ""}`);
  const sub = /^([a-z2-7]{50,})\.ipfs\./.exec(u.hostname);
  if (sub && sub[1] && !u.search) return normaliseMediaSource(`ipfs://${sub[1]}${u.pathname === "/" ? "" : u.pathname}`);
  if ((u.hostname === "arweave.net" || u.hostname === "www.arweave.net") && !u.search) {
    const [, tx, ...path] = u.pathname.split("/");
    if (tx && AR_TX.test(tx)) return normaliseMediaSource(`ar://${tx}${path.length ? `/${path.join("/")}` : ""}`);
  }
  u.hash = "";
  return { url: u.toString(), scheme: u.protocol === "https:" ? "https" : "http" };
}

const VIDEO_EXT = /\.(mp4|webm|m4v)(\?|#|$)/i;
const BLOCKED_EXT = /\.(html?|xhtml|js|mjs|pdf|swf|exe|zip)(\?|#|$)/i;

export function guessKind(source: string): MediaKind | null {
  if (BLOCKED_EXT.test(source)) return null;
  return VIDEO_EXT.test(source) ? "video" : "image";
}

export interface ProxyUrlOptions {
  /** Defaults to a guess from the extension; the proxy still sniffs the bytes. */
  kind?: MediaKind;
}

/**
 * The URL the UI puts in <img>/<video src>. Returns null when there's no proxy configured or the source
 * isn't allowed: the UI then shows placeholder art and never fetches the original.
 *   `${base}/v1/media?src=<canonical source>&kind=image|video`
 */
export function mediaProxyUrl(base: string | null | undefined, raw: string | null | undefined, opts: ProxyUrlOptions = {}): { kind: MediaKind; src: string } | null {
  if (!base) return null;
  const source = normaliseMediaSource(raw);
  if (!source) return null;
  const kind = opts.kind ?? guessKind(source.url);
  if (!kind) return null;
  const root = base.replace(/\/+$/, "");
  return { kind, src: `${root}/v1/media?src=${encodeURIComponent(source.url)}&kind=${kind}` };
}

/** Parses the proxy's query string; both sides use this so they can't disagree. */
export function parseProxyQuery(params: URLSearchParams): { source: MediaSource; kind: MediaKind } | null {
  const kind = params.get("kind");
  if (kind !== "image" && kind !== "video") return null;
  const source = normaliseMediaSource(params.get("src"));
  if (!source) return null;
  return { source, kind };
}

/** Sniffs the first bytes of a body. Never trusts Content-Type. */
export function sniffMediaType(head: Uint8Array): AllowedMediaType | null {
  const b = head;
  const at = (i: number) => b[i] ?? -1;
  const ascii = (from: number, s: string) => [...s].every((c, i) => at(from + i) === c.charCodeAt(0));
  if (at(0) === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (brand === "avif" || brand === "avis") return "image/avif";
    return "video/mp4";
  }
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return "video/webm";
  // SVG: text, optionally BOM / XML prolog / comments / doctype before <svg
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).replace(/^﻿/, "").trimStart();
  const stripped = text.replace(/^<\?xml[^>]*\?>\s*/i, "").replace(/^(<!--[\s\S]*?-->\s*)*/, "").replace(/^<!DOCTYPE svg[^>]*>\s*/i, "");
  if (/^<svg[\s>]/i.test(stripped)) return "image/svg+xml";
  return null;
}

export function kindOfType(t: AllowedMediaType): MediaKind {
  return t.startsWith("video/") ? "video" : "image";
}
