import { prefixPublicKey } from "@airgap/beacon-utils";
import {
  BEACON_MESSAGE,
  DEFAULT_TEZOS_NETWORKS,
  beaconErrorType,
  beaconResponse,
  mapBeaconRequest,
  type BeaconV2Request,
  type TezosNetworkMap,
  type WalletDispatch,
} from "./messages.js";

/**
 * Beacon P2P (Matrix relay) pairing: the "Connect with Beacon / scan QR" path for dApps when the wallet
 * isn't an installed extension on that page (mobile, other browser). Wraps @airgap/beacon-wallet's
 * `WalletClient` (the SDK Beacon documents for wallets) and answers requests through the same
 * `dispatch` as the extension peer.
 *
 *   const beacon = createBeaconP2PWallet({ client: new WalletClient({ name, iconUrl, storage }), dispatch })
 *   await beacon.start()
 *   await beacon.pair(pairingStringFromQr)
 *
 * Run it where `localStorage`-like storage and fetch to the Matrix relays work (popup / offscreen
 * document, or the service worker with a `storage` adapter passed to WalletClient). Needs a `Buffer`
 * polyfill like the rest of Beacon.
 */

/** The slice of @airgap/beacon-wallet WalletClient used here (structural, so tests can fake it). */
export interface WalletClientLike {
  init(): Promise<unknown>;
  connect(cb: (message: any, connectionContext: unknown) => void): Promise<void>;
  respond(message: Record<string, unknown>): Promise<void>;
  addPeer(peer: any, sendPairingResponse?: boolean): Promise<void>;
  getPeers?(): Promise<unknown[]>;
  removePeer?(peer: any, sendDisconnectToPeer?: boolean): Promise<void>;
  destroy?(): Promise<void>;
}

export interface BeaconP2PWalletOptions {
  client: WalletClientLike;
  dispatch: WalletDispatch;
  networks?: TezosNetworkMap;
  /** Permission origin for a P2P dApp (no web origin exists). Default `beacon:<senderId>`. */
  originOf?: (req: BeaconV2Request) => string;
  /** Decodes a pairing string (QR / deep link) into a P2PPairingRequest. Default: Beacon's Serializer. */
  deserialize?: (pairing: string) => Promise<unknown>;
}

export function createBeaconP2PWallet(opts: BeaconP2PWalletOptions) {
  const networks = opts.networks ?? DEFAULT_TEZOS_NETWORKS;
  const originOf = opts.originOf ?? ((req: BeaconV2Request) => `beacon:${req.appMetadata?.senderId ?? req.senderId}`);
  const origins = new Map<string, string>();

  async function onRequest(req: BeaconV2Request): Promise<void> {
    // Later requests carry only senderId; reuse the origin decided at permission time.
    const origin = origins.get(req.senderId) ?? originOf(req);
    origins.set(req.senderId, origin);
    const mapped = mapBeaconRequest(req, networks);
    if (mapped.kind === "error") {
      await opts.client.respond({ type: BEACON_MESSAGE.error, id: req.id, errorType: mapped.errorType });
      return;
    }
    try {
      const input: { family: "tezos"; method: string; params?: unknown; chain?: string } = { family: "tezos", method: mapped.method, params: mapped.params };
      if (mapped.chain) input.chain = mapped.chain;
      const result = await opts.dispatch(origin, input);
      await opts.client.respond(beaconResponse(req, result, { edpk: prefixPublicKey }));
    } catch (err) {
      await opts.client.respond({ type: BEACON_MESSAGE.error, id: req.id, errorType: beaconErrorType(req, err) });
    }
  }

  return {
    async start(): Promise<void> {
      await opts.client.init();
      await opts.client.connect((message: BeaconV2Request) => {
        void onRequest(message);
      });
    },
    /** Pair from a Beacon pairing string (base58check JSON from the dApp's QR code). */
    async pair(pairing: string): Promise<void> {
      const deserialize = opts.deserialize ?? (async (s: string) => new (await import("@airgap/beacon-core")).Serializer().deserialize(s));
      const peer = await deserialize(pairing.trim());
      if (!peer || typeof peer !== "object") throw new Error("That isn't a Beacon pairing code.");
      await opts.client.addPeer(peer);
    },
    /** Exposed for tests and for wallets that receive messages from elsewhere. */
    handle: onRequest,
  };
}
