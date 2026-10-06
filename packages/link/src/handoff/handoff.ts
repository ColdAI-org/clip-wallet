/**
 * "Continue elsewhere": open the dapp you're using in the Clip app on another device, already connected.
 *
 *   clipwallet://browse?url=<https URL>&h=<token>
 *
 * `h` is sealed with a key derived from the wallet's sync data key, so only a device holding the SAME wallet can
 * open it: { origin, families, issued at }. A valid token lets the receiving app offer a one-tap "Continue on
 * <site>" that restores the connection for that origin (the person still taps it; nothing connects silently).
 * A link without a token, a token from another wallet, or one older than 10 minutes just opens the page.
 *
 * @module
 */
import { b64url, hkdf32, openJson, randomBytes, sealJson } from "../bytes.js";

export const HANDOFF_TTL_MS = 10 * 60_000;

export interface HandoffClaims {
  origin: string;
  families: string[];
  iat: number;
}

const key = (dataKey: Uint8Array) => hkdf32(dataKey, new Uint8Array(0), "clip/link/v1/handoff");

export function httpsOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function buildHandoffLink(p: { url: string; families: string[]; dataKey?: Uint8Array; now?: number }): string {
  const origin = httpsOrigin(p.url);
  if (!origin) throw new RangeError("only https pages can be continued elsewhere");
  const q = new URLSearchParams({ url: p.url });
  if (p.dataKey) {
    const claims: HandoffClaims & { n: string } = { origin, families: p.families.slice(0, 20), iat: p.now ?? Date.now(), n: b64url(randomBytes(8)) };
    q.set("h", sealJson(key(p.dataKey), claims, "clip-handoff/v1"));
  }
  return `clipwallet://browse?${q.toString()}`;
}

export function parseHandoffLink(link: string): { url: string; token?: string } | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "clipwallet:" || (u.hostname !== "browse" && u.pathname.replace(/^\/+/, "") !== "browse")) return null;
  const url = u.searchParams.get("url") ?? "";
  if (!httpsOrigin(url) || url.length > 2000) return null;
  const h = u.searchParams.get("h");
  return { url, ...(h && /^[A-Za-z0-9_-]{60,4000}$/.test(h) ? { token: h } : {}) };
}

/** Null unless the token was made by a device with this wallet, for this URL's origin, within the last 10 minutes. */
export function openHandoffToken(token: string, url: string, dataKey: Uint8Array, now = Date.now()): HandoffClaims | null {
  try {
    const c = openJson<HandoffClaims>(key(dataKey), token, "clip-handoff/v1");
    if (c.origin !== httpsOrigin(url)) return null;
    if (!(c.iat <= now + 60_000 && now - c.iat <= HANDOFF_TTL_MS)) return null;
    if (!Array.isArray(c.families) || c.families.some((f) => typeof f !== "string")) return null;
    return { origin: c.origin, families: c.families, iat: c.iat };
  } catch {
    return null;
  }
}
