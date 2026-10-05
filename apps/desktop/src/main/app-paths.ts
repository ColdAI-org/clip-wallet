/** Pure helpers of the clip-app: protocol (app-protocol.ts): content types, the wallet CSP, path resolution. */
import { join, normalize, sep } from "node:path";
import { APP_HOST, APP_SCHEME } from "./ipc-guard";

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

export function walletCsp(mediaProxyUrl?: string): string {
  const media = mediaProxyUrl ? ` ${new URL(mediaProxyUrl).origin}` : "";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${media}`,
    `media-src 'self' blob:${media}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Resolves a clip-app URL path inside `root`, or null (no traversal, no other hosts). */
export function resolveAppPath(root: string, url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null;
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "wallet/index.html";
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return file;
}

