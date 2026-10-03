/**
 * Native side of the in-app browser: it replaces the extension's content-script → background port.
 *
 *   page (1Mask inpage + content bridge, inpage-entry.ts)
 *     └─ ReactNativeWebView.postMessage({ clip1mask: PortRequest }) ─► onMessage(data, nativeUrl)
 *                                                                    └─ router port (engine.attachDappPort)
 *   router replies / events ─► injectJavaScript(`__clip1maskReceive(msg)` guarded by the origin)
 *
 * The origin is ALWAYS the WebView's own main-frame URL (react-native-webview's nativeEvent.url and the
 * navigation state), never anything the page wrote: the page shares this JS world and could forge fields.
 * Each origin gets its own port; navigating away disconnects it, so a late reply for one site can never be
 * delivered to the next site.
 *
 * Pure TypeScript (no React Native imports) so it runs in tests against the real injected bundle.
 */
import type { Network } from "@clip-wallet/core";
import type { RouterPort } from "@clip-wallet/1mask/background";

export const MAX_BRIDGE_MESSAGE_BYTES = 4 * 1024 * 1024;

export interface BridgeOptions {
  /** engine.attachDappPort */
  attach(port: RouterPort, origin: string): void;
  /** WebView.injectJavaScript */
  inject(js: string): void;
  /** The bundled inpage script (inpage.generated.ts). */
  inpageJs: string;
  channel: string;
  networks: Network[];
  identity: { name: string; icon: string; rdns: string };
}

/** http(s) origin of a URL, or null (about:, data:, file:, blob:, javascript: … never talk to the wallet). */
export function webOrigin(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.protocol === "http:" && !isLocalHost(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Plain http is only for a dapp served from this computer / LAN while developing. */
function isLocalHost(h: string): boolean {
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".local") || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

interface OriginPort {
  origin: string;
  port: RouterPort;
  listeners: ((m: unknown) => void)[];
  closers: (() => void)[];
  closed: boolean;
}

export interface WebViewBridge {
  /** Script for injectedJavaScriptBeforeContentLoaded (main frame only). */
  readonly injectedBeforeLoad: string;
  /** Call from onNavigationStateChange / onLoadStart with the main frame's URL. */
  onNavigation(url: string): void;
  /** Call from onMessage with event.nativeEvent.data and event.nativeEvent.url. */
  onMessage(data: string, nativeUrl: string): void;
  /** Current connected origin (for the address bar's "connected" dot), if any. */
  readonly origin: string | null;
  dispose(): void;
}

export function createWebViewBridge(o: BridgeOptions): WebViewBridge {
  let current: OriginPort | null = null;
  let mainOrigin: string | null = null;

  const boot = JSON.stringify({ channel: o.channel, networks: o.networks, identity: o.identity });
  const injectedBeforeLoad = `(function(){try{if(window.top!==window)return;window.__clip1maskBoot=${boot};${o.inpageJs}}catch(e){}})();true;`;

  const close = (p: OriginPort | null) => {
    if (!p || p.closed) return;
    p.closed = true;
    for (const c of p.closers) c();
  };

  const portFor = (origin: string): OriginPort => {
    if (current && current.origin === origin && !current.closed) return current;
    close(current);
    const entry: OriginPort = {
      origin,
      listeners: [],
      closers: [],
      closed: false,
      port: undefined as unknown as RouterPort,
    };
    entry.port = {
      postMessage(message: unknown) {
        if (entry.closed) return;
        // Delivered only if the page is still on the origin this port belongs to.
        const js = `(function(){if(location.origin===${JSON.stringify(origin)}&&window.__clip1maskReceive){window.__clip1maskReceive(${JSON.stringify(message)});}})();true;`;
        o.inject(js);
      },
      onMessage: { addListener: (cb) => void entry.listeners.push(cb) },
      onDisconnect: { addListener: (cb) => void entry.closers.push(cb) },
      disconnect: () => close(entry),
    };
    current = entry;
    o.attach(entry.port, origin);
    return entry;
  };

  return {
    injectedBeforeLoad,
    get origin() {
      return current && !current.closed ? current.origin : null;
    },
    onNavigation(url) {
      const next = webOrigin(url);
      if (next !== mainOrigin) {
        mainOrigin = next;
        if (current && current.origin !== next) close(current);
      }
    },
    onMessage(data, nativeUrl) {
      if (typeof data !== "string" || data.length > MAX_BRIDGE_MESSAGE_BYTES) return;
      const origin = webOrigin(nativeUrl);
      // The message must come from the main frame we are showing.
      if (!origin || (mainOrigin !== null && origin !== mainOrigin)) return;
      mainOrigin ??= origin;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const msg = (parsed as { clip1mask?: unknown } | null)?.clip1mask;
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
      // Overwrite whatever origin the page claimed with the WebView's own; the router re-validates the schema.
      const req = { ...(msg as Record<string, unknown>), origin };
      const entry = portFor(origin);
      for (const l of entry.listeners) l(req);
    },
    dispose() {
      close(current);
      current = null;
    },
  };
}
