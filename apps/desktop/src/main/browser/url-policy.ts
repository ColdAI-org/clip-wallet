/**
 * What the built-in browser may open, and which session a site lives in. Pure (no Electron), unit-tested.
 *
 *  - Only https, plus plain http for a dapp served from this computer or the LAN while developing (same rule as
 *    the mobile in-app browser, apps/mobile/src/browser/bridge.ts). Never file:, data:, javascript:, blob:, about:
 *    (except the blank start page), chrome:, devtools: or the wallet's own clip-app: scheme.
 *  - One persistent session per ORIGIN: `persist:site-<sha256(origin)[0..32]>`. Cookies, storage, cache, service
 *    workers and permission grants of one site are invisible to every other site, and to the wallet windows (which
 *    use the default session and the only session the clip-app: protocol is registered in).
 */
import { createHash } from "node:crypto";

export function isLocalHost(h: string): boolean {
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    /^10\.\d+\.\d+\.\d+$/.test(h) ||
    /^192\.168\.\d+\.\d+$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)
  );
}

/** http(s) origin a dapp may have, or null (anything else never talks to the wallet or loads in a tab). */
export function webOrigin(url: string | undefined | null): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && isLocalHost(u.hostname)) return u.origin;
  return null;
}

/** A URL a tab may load (top-level navigation or a link opened in a new tab). */
export function isNavigable(url: string): boolean {
  return webOrigin(url) !== null;
}

/**
 * Address-bar input → URL to load, or null. No search engine: something that isn't an address is refused with a
 * plain message ("That isn't a site address"). Bare hosts get https:// (http:// for localhost and LAN hosts).
 */
export function normalizeInput(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d+(\/|$)/.test(s)) {
    return isNavigable(s) ? new URL(s).toString() : null;
  }
  const host = s.split(/[/?#]/)[0]!.replace(/:\d+$/, "");
  const looksLikeHost = host === "localhost" || /^\[[0-9a-f:]+\]$/i.test(host) || /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(host);
  if (!looksLikeHost) return null;
  const scheme = isLocalHost(host) ? "http" : "https";
  try {
    const u = new URL(`${scheme}://${s}`);
    return isNavigable(u.toString()) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The Electron session partition for a site. Deterministic, so a site gets its own storage back next time. */
export function partitionFor(origin: string): string {
  return `persist:site-${createHash("sha256").update(origin).digest("hex").slice(0, 32)}`;
}

/** What the address bar shows as "the site": the host, without a leading www. Plain http is flagged elsewhere. */
export function displayHost(origin: string): string {
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return origin;
  }
}

/** Site permissions Chromium may ask for, as the prompt names them. Everything not listed is denied silently. */
export const PROMPTABLE_PERMISSIONS = {
  media: "camera",
  notifications: "notifications",
  "clipboard-read": "clipboard",
  "clipboard-sanitized-write": "clipboard",
  geolocation: "location",
} as const;

export type PromptKind = (typeof PROMPTABLE_PERMISSIONS)[keyof typeof PROMPTABLE_PERMISSIONS] | "microphone";

/** Maps a Chromium permission request to the prompt it gets, or null = deny without asking. */
export function promptFor(permission: string, mediaTypes: readonly string[] = []): PromptKind | null {
  if (permission === "media") {
    if (mediaTypes.includes("video")) return "camera";
    if (mediaTypes.includes("audio")) return "microphone";
    return null;
  }
  return (PROMPTABLE_PERMISSIONS as Record<string, PromptKind>)[permission] ?? null;
}
