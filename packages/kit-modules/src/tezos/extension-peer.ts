import { MessageBasedClient, Serializer, getSenderId } from "@airgap/beacon-core";
import { getKeypairFromSeed, prefixPublicKey, toHex } from "@airgap/beacon-utils";
import {
  BEACON_MESSAGE,
  DEFAULT_TEZOS_NETWORKS,
  TEZOS_WALLET_METHODS,
  beaconErrorType,
  beaconResponse,
  mapBeaconRequest,
  type BeaconV2Request,
  type TezosNetworkMap,
  type WalletDispatch,
} from "./messages.js";

/**
 * Beacon browser-extension peer (wallet side of Beacon's PostMessage transport), running in the
 * extension background. 1Mask's page relay (packages/1mask/src/inpage/tezos.ts) forwards what the dApp
 * posts; this peer pairs, decrypts, turns Beacon v2 requests into Clip wallet calls (`dispatch`, i.e.
 * the 1Mask router, so permissions and approvals apply), and returns encrypted replies.
 *
 * Crypto is Beacon's own (@airgap/beacon-core MessageBasedClient / @airgap/beacon-utils: crypto_box_seal
 * for the pairing response, X25519 session keys + secretbox afterwards), so it interoperates with
 * @airgap/beacon-dapp exactly. The peer's keypair is a COMMUNICATION key derived by Beacon's
 * `getKeypairFromSeed` from a random seed kept in `storage`; it is not account key material and never
 * signs anything for the user (account signatures come from the vault through `dispatch`).
 *
 * Needs a global `Buffer` (Beacon's packages use it): bundle a `buffer` polyfill in the background.
 */

export interface BeaconPeerStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface BeaconExtensionPeerOptions {
  /** Wallet name shown in the dApp's Beacon UI and pairing response. */
  name: string;
  iconUrl?: string;
  appUrl?: string;
  dispatch: WalletDispatch;
  storage: BeaconPeerStorage;
  networks?: TezosNetworkMap;
  /** New random seed for the communication keypair (first run only). Default: 32 bytes from crypto.getRandomValues. */
  randomSeed?: () => string;
  /** Clock for expiring uncollected results (tests). Default Date.now. */
  now?: () => number;
}

/**
 * Audit 1MASK-L: results wait in `pending` until the page collects them. A page that never does can't grow the map:
 * at most this many per site (more are answered with a Beacon error and never dispatched)...
 */
const MAX_PENDING_PER_ORIGIN = 16;
/** ...and a result nobody collected is dropped after this long (longer than the 10-minute approval timeout). */
const PENDING_TTL_MS = 15 * 60_000;

export interface BeaconReply {
  payload?: string;
  encryptedPayload?: string;
}

interface PeerRecord {
  publicKey: string;
  senderId: string;
  name: string;
  icon?: string;
  appUrl?: string;
  version: string;
}

interface PostMessagePairingRequestLike {
  id: string;
  type?: string;
  name: string;
  icon?: string;
  appUrl?: string;
  publicKey: string;
  version: string;
}

const SEED_KEY = "beacon:seed";
const PEERS_KEY = "beacon:peers";

/** MessageBasedClient's crypto, without its window listeners. */
class PeerCrypto extends MessageBasedClient {
  protected readonly activeListeners = new Map<string, unknown>();
  async init(): Promise<void> {}
  /** Replies go back through the page relay, never straight to a window. */
  async sendMessage(): Promise<void> {
    throw new Error("PeerCrypto does not send");
  }
  decrypt(senderPublicKey: string, payloadHex: string): Promise<string> {
    return this.decryptMessage(senderPublicKey, payloadHex);
  }
  encrypt(recipientPublicKey: string, message: string): Promise<string> {
    return this.encryptMessage(recipientPublicKey, message);
  }
  seal(recipientPublicKey: string, message: string): Promise<string> {
    return this.encryptMessageAsymmetric(recipientPublicKey, message);
  }
}

const defaultSeed = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

export function createBeaconExtensionPeer(opts: BeaconExtensionPeerOptions) {
  const networks = opts.networks ?? DEFAULT_TEZOS_NETWORKS;
  const serializer = new Serializer();
  let ready: Promise<{ crypto: PeerCrypto; publicKey: string; senderId: string }> | undefined;
  let peersCache: Record<string, PeerRecord[]> | undefined;
  const pending = new Map<string, { origin: string; at: number; done: Promise<BeaconReply[]> }>();
  let counter = 0;
  const now = opts.now ?? (() => Date.now());
  const sweep = () => {
    const t = now();
    for (const [id, p] of pending) if (t - p.at > PENDING_TTL_MS) pending.delete(id);
  };

  const init = () =>
    (ready ??= (async () => {
      let seed = await opts.storage.get(SEED_KEY);
      if (!seed) {
        seed = (opts.randomSeed ?? defaultSeed)();
        await opts.storage.set(SEED_KEY, seed);
      }
      const keyPair = await getKeypairFromSeed(seed);
      const publicKey = toHex(keyPair.publicKey);
      return { crypto: new PeerCrypto(opts.name, keyPair), publicKey, senderId: await getSenderId(publicKey) };
    })());

  const peers = async (): Promise<Record<string, PeerRecord[]>> => {
    if (!peersCache) {
      const raw = await opts.storage.get(PEERS_KEY);
      try {
        peersCache = raw ? (JSON.parse(raw) as Record<string, PeerRecord[]>) : {};
      } catch {
        peersCache = {};
      }
    }
    return peersCache;
  };
  const savePeers = async () => opts.storage.set(PEERS_KEY, JSON.stringify(await peers()));

  async function pair(origin: string, payload: string): Promise<BeaconReply[]> {
    let req: PostMessagePairingRequestLike;
    try {
      req = (await serializer.deserialize(payload)) as PostMessagePairingRequestLike;
    } catch {
      return [];
    }
    if (!req || typeof req.publicKey !== "string" || !/^[0-9a-f]{64}$/i.test(req.publicKey) || typeof req.id !== "string") return [];
    const { crypto, publicKey } = await init();
    const all = await peers();
    const list = (all[origin] ??= []);
    const record: PeerRecord = { publicKey: req.publicKey, senderId: await getSenderId(req.publicKey), name: String(req.name ?? ""), version: String(req.version ?? "2") };
    if (req.icon) record.icon = req.icon;
    if (req.appUrl) record.appUrl = req.appUrl;
    all[origin] = [...list.filter((p) => p.publicKey !== req.publicKey), record].slice(-8);
    await savePeers();
    const response: Record<string, unknown> = {
      type: "postmessage-pairing-response",
      id: req.id,
      name: opts.name,
      publicKey,
      version: req.version,
    };
    if (opts.iconUrl) response.icon = opts.iconUrl;
    if (opts.appUrl) response.appUrl = opts.appUrl;
    return [{ payload: await crypto.seal(req.publicKey, JSON.stringify(response)) }];
  }

  async function encryptFor(peer: PeerRecord, message: Record<string, unknown>): Promise<BeaconReply> {
    const { crypto, senderId } = await init();
    const full = { ...message, version: "2", senderId };
    return { encryptedPayload: await crypto.encrypt(peer.publicKey, await serializer.serialize(full)) };
  }

  async function handle(origin: string, peer: PeerRecord, req: BeaconV2Request): Promise<BeaconReply[]> {
    const mapped = mapBeaconRequest(req, networks);
    if (mapped.kind === "error") return [await encryptFor(peer, { type: BEACON_MESSAGE.error, id: req.id, errorType: mapped.errorType })];
    try {
      const input: { family: "tezos"; method: string; params?: unknown; chain?: string } = { family: "tezos", method: mapped.method, params: mapped.params };
      if (mapped.chain) input.chain = mapped.chain;
      const result = await opts.dispatch(origin, input);
      return [await encryptFor(peer, beaconResponse(req, result, { edpk: prefixPublicKey }))];
    } catch (err) {
      return [await encryptFor(peer, { type: BEACON_MESSAGE.error, id: req.id, errorType: beaconErrorType(req, err) })];
    }
  }

  async function receive(origin: string, message: BeaconReply): Promise<{ replies: BeaconReply[]; pending?: string }> {
    if (typeof message.payload === "string" && !message.encryptedPayload) return { replies: await pair(origin, message.payload) };
    if (typeof message.encryptedPayload !== "string") return { replies: [] };
    const { crypto } = await init();
    const known = (await peers())[origin] ?? [];
    let peer: PeerRecord | undefined;
    let text: string | undefined;
    for (const p of known) {
      try {
        text = await crypto.decrypt(p.publicKey, message.encryptedPayload);
        peer = p;
        break;
      } catch {
        /* not this peer */
      }
    }
    if (!peer || text === undefined) return { replies: [] };
    let req: BeaconV2Request;
    try {
      req = (await serializer.deserialize(text)) as BeaconV2Request;
    } catch {
      return { replies: [] };
    }
    if (!req || typeof req.id !== "string" || typeof req.type !== "string") return { replies: [] };
    if (req.version !== "2") {
      // Beacon v3 is used for non-Tezos blockchains; nothing for us to serve.
      return { replies: [await encryptFor(peer, { type: BEACON_MESSAGE.error, id: req.id, errorType: "UNKNOWN_ERROR" })] };
    }
    if (req.type === BEACON_MESSAGE.disconnect) {
      const all = await peers();
      all[origin] = (all[origin] ?? []).filter((p) => p.publicKey !== peer!.publicKey);
      await savePeers();
      await opts.dispatch(origin, { family: "tezos", method: TEZOS_WALLET_METHODS.disconnect }).catch(() => undefined);
      return { replies: [] };
    }
    sweep();
    if ([...pending.values()].filter((p) => p.origin === origin).length >= MAX_PENDING_PER_ORIGIN) {
      return { replies: [await encryptFor(peer, { type: BEACON_MESSAGE.error, id: req.id, errorType: "UNKNOWN_ERROR" })] };
    }
    const ack = await encryptFor(peer, { type: BEACON_MESSAGE.acknowledge, id: req.id });
    const id = `b${++counter}`;
    pending.set(id, { origin, at: now(), done: handle(origin, peer, req) });
    return { replies: [ack], pending: id };
  }

  async function result(origin: string, id: string): Promise<BeaconReply[]> {
    sweep();
    const p = pending.get(id);
    if (!p || p.origin !== origin) return [];
    pending.delete(id);
    return p.done;
  }

  return {
    receive,
    result,
    /** Our Beacon sender id (bs58check of blake2b-5 of the communication public key). */
    senderId: async () => (await init()).senderId,
    /** Paired dApps per origin (for a "connected sites" screen). */
    peers: async () => structuredClone(await peers()),
    /** Forget a site's Beacon pairing (the dApp has to pair again). */
    forget: async (origin: string) => {
      const all = await peers();
      delete all[origin];
      await savePeers();
    },
  };
}

export type BeaconExtensionPeer = ReturnType<typeof createBeaconExtensionPeer>;
