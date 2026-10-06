/**
 * The wallet's own pages are served from `clip-app://wallet/…` out of the app bundle (out/renderer), with a strict
 * Content-Security-Policy header. The scheme is registered ONLY in the default session, which only our windows
 * use: dapp tabs run in per-origin sessions where `clip-app:` doesn't exist.
 *
 * No remote content in wallet windows: scripts, styles and fonts only from the bundle; images only from the bundle,
 * data:/blob: (QR codes) and the configured media proxy (NFT images are proxied, @clip-wallet/media-client);
 * connect-src only 'self' (the renderers do no network I/O: everything goes through the main process).
 */
import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { APP_SCHEME } from "./ipc-guard";
import { TYPES, resolveAppPath } from "./app-paths";

export { walletCsp } from "./app-paths";

/** Must run before app "ready". */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

/** After "ready": serve the renderer bundle. */
export function handleAppScheme(rendererRoot: string, csp: string) {
  protocol.handle(APP_SCHEME, async (req) => {
    const file = resolveAppPath(rendererRoot, req.url);
    if (!file) return new Response("Not found", { status: 404 });
    // Read from disk directly: the default session's request filter (index.ts) blocks file: and the network.
    const body = await readFile(file).catch(() => null);
    if (!body) return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "cross-origin-opener-policy": "same-origin",
      "referrer-policy": "no-referrer",
    });
    if (extname(file) === ".html") headers.set("content-security-policy", csp);
    return new Response(new Uint8Array(body), { status: 200, headers });
  });
}
