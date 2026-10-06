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
 * Only the top frame talks to the wallet (audit MOB-02). react-native-webview is patched (patches/) so the native
 * side drops subframe messages and says `isMainFrame: true` on the rest; on Android it never falls back to
 * addJavascriptInterface (visible to every frame, with messages attributed to the top page's URL) when the system
 * WebView lacks WEB_MESSAGE_LISTENER: the page then gets no bridge. A message without `isMainFrame === true` is
 * dropped here as well, so an unpatched or fallback native side fails closed.
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
  // Audit MOB-01: private ranges as IP literals only (the old prefix test also matched "10.evil.com").
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  const [a, b] = ip ? [Number(ip[1]), Number(ip[2])] : [NaN, NaN];
  const privateIp = !!ip && ip.slice(1).every((x) => Number(x) <= 255) && (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31));
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || privateIp;
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
  /** Call from onMessage with event.nativeEvent.data, .url and .isMainFrame (set by the patched native side). */
  onMessage(data: string, nativeUrl: string, isMainFrame: boolean | undefined): void;
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
    onMessage(data, nativeUrl, isMainFrame) {
      // Audit MOB-02: the top frame only, as reported by the native side; anything else (or no answer) is dropped.
      if (isMainFrame !== true) return;
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
