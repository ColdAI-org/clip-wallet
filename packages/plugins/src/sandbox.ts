/**
 * Host side of the sandbox: the iframe channel and the manifest entries the extension needs.
 *
 * Chrome MV3 sandbox pages (https://developer.chrome.com/docs/extensions/reference/manifest/sandbox):
 * "Sandboxed pages cannot access extension APIs", run in a unique origin, and may use eval. Their CSP must
 * contain the `sandbox` directive and must not contain `allow-same-origin`.
 */
import type { HostToSandbox } from "./messages.js";

/** Path of the sandbox page inside the extension. */
export const SANDBOX_PAGE = "plugin-sandbox.html";

/**
 * CSP for the sandbox page. `allow-scripts` only (no same-origin, forms, popups, modals, top navigation);
 * scripts only from the extension; `unsafe-eval` because SES compartments evaluate the plugin's source; and
 * no network, frames, workers, images or styles at all. A plugin's granted network access is performed by the
 * host on its behalf, against the manifest's exact origins (see PluginHost), never from here.
 */
export const SANDBOX_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Manifest additions (merge into wxt.config.ts manifest()). */
export const SANDBOX_MANIFEST = {
  sandbox: { pages: [SANDBOX_PAGE] },
  content_security_policy: { sandbox: SANDBOX_CSP },
} as const;

/** A bidirectional link to one plugin's sandbox. */
export interface Channel {
  send(msg: HostToSandbox): void;
  onMessage(cb: (raw: unknown) => void): void;
  destroy(): void;
}

export type ChannelFactory = (pluginId: string) => Channel;

/**
 * Creates one hidden sandboxed iframe per plugin inside `doc` (the offscreen host document). Messages are
 * accepted only from that iframe's window. Replies must be sent with targetOrigin "*" because the sandbox's
 * origin is opaque; they still reach only that iframe, since we post to its contentWindow directly.
 */
export function iframeChannelFactory(doc: Document, pageUrl: string): ChannelFactory {
  return () => {
    const frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.display = "none";
    frame.src = pageUrl;
    let listener: ((e: MessageEvent) => void) | null = null;
    const queue: HostToSandbox[] = [];
    let booted = false;
    const win = doc.defaultView!;
    const ch: Channel = {
      send(msg) {
        if (!booted) queue.push(msg);
        else frame.contentWindow?.postMessage(msg, "*");
      },
      onMessage(cb) {
        listener = (e: MessageEvent) => {
          if (!frame.contentWindow || e.source !== frame.contentWindow || e.origin !== "null") return;
          if ((e.data as { type?: unknown })?.type === "booted" && !booted) {
            booted = true;
            for (const m of queue.splice(0)) frame.contentWindow.postMessage(m, "*");
          }
          cb(e.data);
        };
        win.addEventListener("message", listener);
      },
      destroy() {
        if (listener) win.removeEventListener("message", listener);
        frame.remove();
      },
    };
    doc.body.appendChild(frame);
    return ch;
  };
}
