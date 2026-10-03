/**
 * NFT media is untrusted. Rules (enforced here and in <NftMedia>):
 *  - Only <img> and <video> elements, and only from the media proxy (never the original URL).
 *  - SVG is rendered as <img> (scripts in an <img> SVG never run), never inlined.
 *  - No HTML, no iframes, no <object>/<embed>, no data:/blob:/javascript: URLs from metadata.
 *  - referrerPolicy="no-referrer"; links in metadata are shown as text, never auto-opened.
 */

export type MediaKind = "image" | "video";

export interface ProxiedMedia {
  kind: MediaKind;
  src: string;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const BLOCKED_EXT = /\.(html?|xhtml|js|mjs|pdf|swf)(\?|#|$)/i;

/** Normalises ipfs:// and ar:// to gateway URLs; returns null for anything that is not http(s). */
export function normaliseMediaUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice(7).replace(/^ipfs\//, "")}`;
  if (url.startsWith("ar://")) return `https://arweave.net/${url.slice(5)}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/**
 * Stub media proxy. Until the proxy service exists this returns null unless `proxyBase` is set,
 * so no untrusted URL is ever fetched directly by the extension.
 */
export function proxyMedia(raw: string | undefined, proxyBase: string | undefined): ProxiedMedia | null {
  const url = normaliseMediaUrl(raw);
  if (!url || !proxyBase) return null;
  if (BLOCKED_EXT.test(url)) return null;
  const kind: MediaKind = VIDEO_EXT.test(url) ? "video" : "image";
  return { kind, src: `${proxyBase}?url=${encodeURIComponent(url)}&kind=${kind}` };
}

/** Deterministic hue for placeholder art. */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Detects URL-like attribute values so they are shown as inert text with a copy button. */
export function looksLikeLink(value: string): boolean {
  return /^(https?|ipfs|ar|javascript|data):/i.test(value.trim()) || /^www\./i.test(value.trim());
}
