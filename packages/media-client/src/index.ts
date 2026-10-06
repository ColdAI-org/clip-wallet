/**
 * @clip-wallet/media-client — the one place that decides what an untrusted NFT media URL may become.
 *
 * Shared by the UI (to build proxy URLs) and services/media-proxy (to re-validate them), so both sides
 * agree on what is allowed. Pure functions, no I/O.
 *
 * Rules:
 *  - Sources: https, http, ipfs:// (CIDv0/CIDv1), ar:// (43-char Arweave tx id). Public IPFS/Arweave gateway
 *    URLs are rewritten to ipfs:// / ar:// so the proxy uses its own gateway and caches one copy.
 *  - Never: data:, blob:, javascript:, file:, credentials in the URL, non-default ports, IPv6 literals, IPv4 in
 *    private/loopback/link-local/reserved ranges (any spelling), single-label names and special-use or private-use
 *    names (localhost, .local, .internal, .home.arpa, .lan…). Hosts are parsed, never matched as strings.
 *  - Output types: raster images, SVG (served sandboxed), mp4/webm video. Decided by sniffing bytes in the
 *    proxy, never by the URL or the upstream Content-Type alone.
 *
 * @module
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

/**
 * IPv4 ranges the proxy never fetches: "this network", private (RFC 1918), CGNAT, loopback, link-local (incl. cloud
 * metadata), IETF protocol assignments, documentation (TEST-NET-1/2/3), the 6to4 relay, benchmarking, multicast and
 * reserved (incl. broadcast). [first address, prefix length].
 */
const BLOCKED_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * Top-level labels that only resolve on local networks or never resolve: special-use names (RFC 6761/6762/8375/9476:
 * localhost, local, arpa incl. home.arpa, test, invalid, onion, alt), ICANN's reserved private TLD (internal) and the
 * private-use names routers and companies hand out (lan, home, corp, intranet, private).
 */
const BLOCKED_TLDS = new Set(["localhost", "local", "internal", "arpa", "test", "invalid", "onion", "alt", "lan", "home", "corp", "intranet", "private"]);

const v4Number = (dotted: string): number => dotted.split(".").reduce((n, o) => n * 256 + Number(o), 0);

function inBlockedV4(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4Number(base) / 2 ** (32 - bits)));
}

export type ParsedHost = { kind: "ipv4"; address: string } | { kind: "ipv6"; address: string } | { kind: "name"; labels: string[] };

/**
 * A host as the WHATWG URL parser (what fetch uses) reads it: IDNA-mapped and lower-cased, IPv4 in any spelling
 * (127.1, 0x7f.0.0.1, 2130706433, full-width digits) turned into dotted decimal, IPv6 in brackets. Null when it isn't
 * a valid host on its own (spaces, credentials, a port, a path…).
 */
export function parseHost(hostname: string): ParsedHost | null {
  let raw = hostname.trim();
  if (!raw) return null;
  if (raw.includes(":") && raw[0] !== "[") raw = `[${raw}]`; // a bare IPv6 address
  let u: URL;
  try {
    u = new URL(`http://${raw}/`);
  } catch {
    return null;
  }
  if (u.username || u.password || u.port || u.pathname !== "/" || u.search || u.hash || !u.hostname) return null;
  const h = u.hostname;
  if (h.includes(":")) return { kind: "ipv6", address: h };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return { kind: "ipv4", address: h };
  const labels = h.split(".");
  if (labels.at(-1) === "") labels.pop(); // a trailing dot is the same name
  if (!labels.length || labels.some((l) => !l)) return null;
  return { kind: "name", labels };
}

/**
 * True for hosts the proxy must never fetch (SSRF guard, audit MEDIA-01). The host is parsed (parseHost), never
 * matched as a string: IPv4 against the blocked ranges, any IPv6 literal (nothing legitimate needs one), and names by
 * their labels (single-label names and the special-use / private-use top-level labels above).
 */
export function isBlockedHost(hostname: string): boolean {
  const host = parseHost(hostname);
  if (!host) return true;
  switch (host.kind) {
    case "ipv6":
      return true;
    case "ipv4":
      return inBlockedV4(v4Number(host.address));
    case "name":
      return host.labels.length < 2 || BLOCKED_TLDS.has(host.labels.at(-1)!);
  }
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
  // Subdomain gateway: <cidv1>.ipfs.<gateway host>, read by labels.
  const labels = u.hostname.split(".");
  if (labels.length >= 3 && labels[1] === "ipfs" && CID_V1.test(labels[0]!) && !u.search) {
    return normaliseMediaSource(`ipfs://${labels[0]}${u.pathname === "/" ? "" : u.pathname}`);
  }
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
