/**
 * Offscreen host document script (template). Copy to apps/extension/src/entrypoints/plugin-host/main.ts with an
 * index.html that loads it; the background opens it with
 *   chrome.offscreen.createDocument({ url: "plugin-host.html", reasons: ["IFRAME_SCRIPTING"], justification: "Run sandboxed plugins" })
 * Plugins run in sandboxed iframes inside THIS document, never in the approval popup, so a plugin that hangs can
 * only freeze this document; the background's own timeout then closes it (chrome.offscreen.closeDocument).
 */
import { HostBridgeServer, PluginHost, iframeChannelFactory, type HostBridgeRequest } from "@clip-wallet/plugins";

declare const chrome: {
  runtime: {
    getURL(path: string): string;
    sendMessage(msg: unknown): Promise<unknown>;
    onMessage: { addListener(cb: (msg: unknown, sender: unknown, reply: (r: unknown) => void) => boolean | void): void };
  };
};

const host = new PluginHost({
  channels: iframeChannelFactory(document, chrome.runtime.getURL("plugin-sandbox.html")),
  // Notifications go to the background, which shows them labelled "from <plugin>".
  onNotify: (n) => void chrome.runtime.sendMessage({ type: "pluginNotification", ...n }),
});
const bridge = new HostBridgeServer(host);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const m = msg as { target?: string; request?: HostBridgeRequest };
  if (m?.target !== "plugin-host" || !m.request) return;
  bridge.handle(m.request).then(reply, () => reply(null));
  return true;
});
