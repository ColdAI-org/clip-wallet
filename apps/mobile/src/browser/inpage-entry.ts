/**
 * Runs inside the in-app browser's WebView, in the page, before any page script (bundled by
 * scripts/build-inpage.mjs into inpage.generated.ts and injected with injectedJavaScriptBeforeContentLoaded).
 *
 * It is the extension's two scripts in one: 1Mask's inpage providers (EIP-1193 + EIP-6963, Solana and Bitcoin
 * Wallet Standard) plus 1Mask's content bridge, whose "runtime port" is the React Native message channel.
 * The page shares this JS world, so NOTHING here is trusted by the app: the native side ignores any origin
 * the page could set and uses the WebView's own navigation URL instead (bridge.ts).
 */
import { installOneMask } from "@clip-wallet/1mask/inpage";
import { createContentBridge, type RuntimePort } from "@clip-wallet/1mask/content";
import type { InpageConfig } from "@clip-wallet/1mask";

interface Boot {
  channel: string;
  networks: InpageConfig["networks"];
  identity: NonNullable<InpageConfig["identity"]>;
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    __clip1maskBoot?: Boot;
    __clip1maskReceive?: (msg: unknown) => void;
  }
}

(() => {
  const boot = window.__clip1maskBoot;
  delete window.__clip1maskBoot;
  if (!boot || !window.ReactNativeWebView || (window as { __clip1maskInstalled?: boolean }).__clip1maskInstalled) return;
  Object.defineProperty(window, "__clip1maskInstalled", { value: true });
  const rn = window.ReactNativeWebView;

  const messageListeners = new Set<(m: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  // Native → page. Non-writable so a page can't swap it out from under the bridge after load.
  Object.defineProperty(window, "__clip1maskReceive", {
    value: (msg: unknown) => {
      if (msg && typeof msg === "object" && (msg as { type?: unknown }).type === "disconnect") {
        for (const l of disconnectListeners) l();
        return;
      }
      for (const l of messageListeners) l(msg);
    },
    writable: false,
    configurable: false,
  });

  const port: RuntimePort = {
    postMessage: (message) => rn.postMessage(JSON.stringify({ clip1mask: message })),
    onMessage: { addListener: (cb) => void messageListeners.add(cb) },
    onDisconnect: { addListener: (cb) => void disconnectListeners.add(cb) },
    disconnect: () => undefined,
  };

  createContentBridge({ channel: boot.channel, connect: () => port });
  installOneMask({ networks: boot.networks, channel: boot.channel, identity: boot.identity });
})();
