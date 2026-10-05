import type { WalletIdentity } from "../shared/config.js";
import { HEDERA_WC_PAIR, isWalletConnectPairingUri } from "../shared/hedera.js";
import type { InpageTransport } from "./transport.js";

/**
 * Hedera extension discovery, as @hashgraph/hedera-wallet-connect's DAppConnector (and HashConnect v3 on top of it)
 * finds HashPack, Kabila or Blade (src/lib/shared/extensionController.ts):
 *
 *   dApp → { type: "hedera-extension-query" }
 *   us   → { type: "hedera-extension-response", metadata: { id, name, icon, url } }      (listed in dAppConnector.extensions)
 *   dApp → { type: "hedera-extension-connect-<id>", pairingString: "wc:…" }              (connectExtension(id))
 *   dApp → { type: "hedera-extension-open-<id>" }                                          (before each request; ignored:
 *                                                                                          Clip opens its own approval window)
 *
 * Not a provider: the session is a normal WalletConnect session. The pairing code goes to the background, which pairs
 * exactly as if the user had pasted it; the user still approves the proposal ("Connect to …?"). Nothing secret here.
 */
export const HEDERA_EXTENSION_EVENTS = {
  query: "hedera-extension-query",
  response: "hedera-extension-response",
  connect: "hedera-extension-connect-",
  open: "hedera-extension-open-",
} as const;

export interface HederaDiscoveryOptions {
  /** The id dApps address us by (`hedera-extension-connect-<id>`). Default: the browser extension id if given, else rdns. */
  extensionId?: string;
  /** Shown by dApps next to the name. */
  url?: string;
}

export { isWalletConnectPairingUri };

export function installHederaExtensionDiscovery(win: Window, identity: WalletIdentity, transport: InpageTransport, opts: HederaDiscoveryOptions = {}): { extensionId: string; stop(): void } {
  const id = opts.extensionId ?? identity.rdns;
  const targetOrigin = win.location.origin === "null" ? "*" : win.location.origin;
  const metadata = { id, name: identity.name, icon: identity.icon, ...(opts.url ? { url: opts.url } : {}) };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== win) return;
    const data = ev.data as { type?: unknown; pairingString?: unknown } | null;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type === HEDERA_EXTENSION_EVENTS.query) {
      win.postMessage({ type: HEDERA_EXTENSION_EVENTS.response, metadata }, targetOrigin);
    } else if (data.type === `${HEDERA_EXTENSION_EVENTS.connect}${id}` && typeof data.pairingString === "string" && isWalletConnectPairingUri(data.pairingString)) {
      // The dApp's DAppConnector waits for the session; a refused or failed pairing simply never settles it.
      void transport.request("hedera", HEDERA_WC_PAIR, { uri: data.pairingString }).catch(() => undefined);
    }
  };
  win.addEventListener("message", onMessage);
  return { extensionId: id, stop: () => win.removeEventListener("message", onMessage) };
}
