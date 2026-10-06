/**
 * The wire between the app and a plugin's WebView sandbox. Pure (no React Native imports), so it is unit-tested
 * in Node (test/plugins-bridge.vitest.ts).
 *
 * react-native-webview gives exactly one channel each way, and nothing else is injected:
 *   app → page   `webViewRef.postMessage(string)`: the native side evaluates
 *                `window.dispatchEvent(new MessageEvent('message', {data}))` (iOS, apple/RNCWebViewImpl.m) or
 *                `document.dispatchEvent(…)` (Android, RNCWebViewManagerImpl.kt). Data is always a string.
 *   page → app   `window.ReactNativeWebView.postMessage(string)` → `onMessage({ nativeEvent: { data, url } })`.
 * Both directions carry JSON of the schemas in @clip-wallet/plugins/messages (strict zod, size-capped), checked on
 * both sides. The sandbox page is loaded from an inline HTML string with baseUrl about:blank, so its origin is
 * opaque ("null"); a message whose frame URL isn't about:blank is dropped.
 */
import { LIMITS, parseFromHost, parseFromSandbox, type HostToSandbox, type SandboxToHost } from "@clip-wallet/plugins";

/** The sandbox page's URL (inline HTML, opaque origin). */
export const SANDBOX_URL = "about:blank";

/** Serialises a host message for the WebView, or null if it doesn't pass the schema (never sent then). */
export function encodeForSandbox(msg: HostToSandbox): string | null {
  const ok = parseFromHost(msg);
  return ok ? JSON.stringify(ok) : null;
}

/**
 * A raw string from a sandbox WebView's onMessage → a validated message, or null. Drops anything from a frame
 * other than the about:blank sandbox page, anything oversized, non-JSON, or outside the schema.
 */
export function decodeFromSandbox(data: unknown, url: string | undefined): SandboxToHost | null {
  if (url !== SANDBOX_URL) return null;
  if (typeof data !== "string" || data.length > LIMITS.maxMessageBytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  return parseFromSandbox(raw);
}

/**
 * Only about:blank may load in a sandbox WebView: the inline sandbox page itself. Every navigation (links,
 * location changes, redirects, file:, data:, javascript:) is refused, so JavaScript only ever runs in the
 * sandbox HTML. Used for `onShouldStartLoadWithRequest`.
 */
export function allowSandboxLoad(req: { url: string; isTopFrame?: boolean }): boolean {
  return req.url === SANDBOX_URL && req.isTopFrame !== false;
}
