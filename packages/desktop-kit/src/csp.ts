/**
 * The wallet and approval windows' Content-Security-Policy: sent as a header by the clip-app: protocol
 * (main/app-protocol.ts) and written into the pages' meta tag at build time (electron-vite.ts). No imports, so the
 * build config can load it from source.
 */
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
