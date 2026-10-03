import type { WalletIdentity } from "../shared/config.js";
import { TEZOS_INJECTED } from "../shared/p2-methods.js";
import type { InpageTransport } from "./transport.js";

/**
 * Tezos: Beacon (TZIP-10) browser-extension discovery over window.postMessage, as Beacon's dApp SDK
 * (@airgap/beacon-transport-postmessage, PostMessageTransport / PostMessageClient) speaks it:
 *
 *   dApp → { target: "toExtension", payload: "ping" }
 *   us   → { target: "toPage", payload: "pong", sender: { id, name, iconUrl } }          (we're listed)
 *   dApp → { target: "toExtension", payload: <bs58check pairing request>, targetId: id }
 *   us   → { message: { target: "toPage", payload: <hex sealed box> }, sender: { id } }  (pairing response)
 *   dApp → { target: "toExtension", encryptedPayload: <hex>, targetId: id }
 *   us   → { message: { target: "toPage", encryptedPayload: <hex> }, sender: { id } }
 *
 * This file is only a relay. Pairing keys, decryption and the Beacon message handling live in the
 * background (@clip-wallet/kit-modules/tezos `createBeaconExtensionPeer`), so nothing secret is in the
 * page. The page sees exactly what any Beacon extension (e.g. Temple) shows it.
 */

export const BEACON_TARGET = { page: "toPage", extension: "toExtension" } as const;

export interface BeaconReply {
  payload?: string;
  encryptedPayload?: string;
}

interface RelayResult {
  replies?: BeaconReply[];
  /** Set when a request waits for the user's approval; fetch the answer with tezos:beaconResult. */
  pending?: string;
}

const MAX_PAYLOAD = 1024 * 1024;

export interface BeaconRelayOptions {
  /** Beacon "extension id" the dApp addresses us by. Beacon's wallet list (beacon-sdk scripts/blockchains/tezos.ts `tezosExtensionList[].id`) uses the browser extension id; pass chrome.runtime.id from the build. Default: identity.rdns. */
  extensionId?: string;
}

export function installTezosBeaconRelay(
  win: Window,
  identity: WalletIdentity,
  transport: InpageTransport,
  opts: BeaconRelayOptions = {},
): { extensionId: string; stop(): void } {
  const id = opts.extensionId ?? identity.rdns;
  const targetOrigin = win.location.origin === "null" ? "*" : win.location.origin;
  const sender = { id, name: identity.name, iconUrl: identity.icon };

  const post = (reply: BeaconReply) => {
    const message: Record<string, string> = { target: BEACON_TARGET.page };
    if (typeof reply.payload === "string") message.payload = reply.payload;
    if (typeof reply.encryptedPayload === "string") message.encryptedPayload = reply.encryptedPayload;
    win.postMessage({ message, sender: { id } }, targetOrigin);
  };

  const relay = async (message: BeaconReply) => {
    try {
      const res = (await transport.request("tezos", TEZOS_INJECTED.beacon, { message })) as RelayResult | null;
      for (const r of res?.replies ?? []) post(r);
      if (res?.pending) {
        const later = (await transport.request("tezos", TEZOS_INJECTED.beaconResult, { id: res.pending })) as BeaconReply[] | null;
        for (const r of later ?? []) post(r);
      }
    } catch {
      /* Beacon has no error channel before pairing; the background answers errors as Beacon error messages. */
    }
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== win || (ev.origin && ev.origin !== win.location.origin && win.location.origin !== "null")) return;
    const data = ev.data as { target?: unknown; payload?: unknown; encryptedPayload?: unknown; targetId?: unknown } | null;
    if (!data || typeof data !== "object" || data.target !== BEACON_TARGET.extension) return;
    if (data.payload === "ping") {
      win.postMessage({ target: BEACON_TARGET.page, payload: "pong", sender }, targetOrigin);
      return;
    }
    // Pairing and encrypted messages are addressed to one extension.
    if (data.targetId !== id) return;
    if (typeof data.encryptedPayload === "string" && data.encryptedPayload.length <= MAX_PAYLOAD && /^[0-9a-f]+$/i.test(data.encryptedPayload)) {
      void relay({ encryptedPayload: data.encryptedPayload });
    } else if (typeof data.payload === "string" && data.payload.length <= MAX_PAYLOAD) {
      void relay({ payload: data.payload });
    }
  };

  win.addEventListener("message", onMessage);
  return { extensionId: id, stop: () => win.removeEventListener("message", onMessage) };
}
