/**
 * NFT media is untrusted. Rules (enforced here and in <NftMedia>):
 *  - Only <img> and <video> elements, and only from the media proxy (never the original URL).
 *  - SVG is rendered as <img> (scripts in an <img> SVG never run), never inlined.
 *  - No HTML, no iframes, no <object>/<embed>, no data:/blob:/javascript: URLs from metadata.
 *  - referrerPolicy="no-referrer"; links in metadata are shown as text, never auto-opened.
 */

import { mediaProxyUrl } from "@clip-wallet/media-client";

export type MediaKind = "image" | "video";

export interface ProxiedMedia {
  kind: MediaKind;
  src: string;
}


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
 * Untrusted media goes only through the media proxy (services/media-proxy), using the shared URL contract
 * from @clip-wallet/media-client: `${proxyBase}/v1/media?src=<canonical>&kind=image|video`. Without a proxy
 * base this returns null, so nothing remote is fetched and placeholders are drawn.
 */
export function proxyMedia(raw: string | undefined, proxyBase: string | undefined): ProxiedMedia | null {
  return mediaProxyUrl(proxyBase, raw);
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
