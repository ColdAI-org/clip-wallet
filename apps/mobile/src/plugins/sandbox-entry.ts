/**
 * The page script of a plugin's WebView sandbox (bundled by scripts/build-plugin-sandbox.mjs into an inline
 * <script> of the sandbox HTML; one WebView runs exactly one plugin). It is the mobile twin of
 * @clip-wallet/plugins/sandbox (sandbox-entry.ts in the extension's sandbox iframe):
 *
 *  1. take the one way out (react-native-webview's `window.ReactNativeWebView.postMessage`) and drop the global;
 *  2. SES `lockdown()` freezes the shared intrinsics;
 *  3. the plugin bundle is evaluated by the shared runtime in a fresh `Compartment` whose globals are only
 *     `module`, `exports`, the granted `clip` functions and a no-op console. No window, document, fetch,
 *     XMLHttpRequest, WebSocket, storage, timers or the bridge.
 *
 * Messages in arrive as strings from the native side (`postMessage` → a MessageEvent on window (iOS) or document
 * (Android)); they are JSON-parsed, size-capped and schema-checked by the runtime (parseFromHost).
 */
import "ses";
import { createSandboxRuntime, type SesApi } from "@clip-wallet/plugins/runtime";
import { LIMITS, type SandboxToHost } from "@clip-wallet/plugins";

declare const lockdown: (opts?: Record<string, string>) => void;
declare const Compartment: SesApi["Compartment"];
declare const harden: SesApi["harden"];

type Bridge = { postMessage(data: string): void };
const w = window as unknown as { ReactNativeWebView?: Bridge };
const bridge = w.ReactNativeWebView;
try {
  delete w.ReactNativeWebView;
} catch {
  /* Android's injected Java object may not be deletable; the plugin can't reach `window` either way. */
}

lockdown({ errorTaming: "safe", overrideTaming: "severe", consoleTaming: "safe", localeTaming: "safe" });

const post = (msg: SandboxToHost) => {
  if (bridge) bridge.postMessage(JSON.stringify(msg));
};

const runtime = createSandboxRuntime({ Compartment, harden, post });

function onMessage(e: Event) {
  const m = e as MessageEvent;
  // The native side dispatches a plain MessageEvent with no source; this page has no frames or openers.
  if (m.source) return;
  if (typeof m.data !== "string" || m.data.length > LIMITS.maxMessageBytes * 5) return;
  let raw: unknown;
  try {
    raw = JSON.parse(m.data);
  } catch {
    return;
  }
  runtime.receive(raw);
}
window.addEventListener("message", onMessage);
document.addEventListener("message", onMessage);

post({ type: "booted" });
