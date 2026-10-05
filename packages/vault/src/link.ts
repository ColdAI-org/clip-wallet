/**
 * Clip Link key material (additive): everything @clip-wallet/link needs that touches a seed or a private key.
 * The link package only ever receives DERIVED keys or handles from here; the seed, the Ed25519 sync secret and
 * every X25519 private key stay in this file.
 *
 * Settings sync (label "clip/sync/v1"):
 *   root    = HKDF-SHA256(ikm = BIP-39 seed, salt = "clip-wallet/vault/sync", info = "clip/sync/v1")
 *   authSk  = HKDF(root, info = "clip/sync/v1/auth-ed25519")     Ed25519 secret (RFC 8032), never leaves the vault
 *   dataKey = HKDF(root, info = "clip/sync/v1/data-xchacha20")   XChaCha20-Poly1305 key, handed to the link package
 *   idKey   = HKDF(root, info = "clip/sync/v1/record-id")        HMAC key for opaque record ids, handed out too
 * The Ed25519 key only signs messages that start with "clip-sync-v1\n" (request authentication), so it can't be
 * used as an oracle for anything else.
 *
 * Pairing (QR / one-time code, then SAS): an ephemeral X25519 key (RFC 7748) per pairing, held here by id for at
 * most 15 minutes.
 *   shared     = X25519(sk, peer)  (all-zero output from a small-order point is refused)
 *   linkSecret = HKDF(shared, salt = transcript hash, info = "clip/link/session/v1")    → link package (channel + SAS)
 *   transferK  = HKDF(shared, salt = transcript hash, info = "clip/link/transfer/v1")   → stays here (wallet transfer)
 * Moving a wallet to another device encrypts the BIP-39 entropy under transferK inside the vault, after the
 * password is re-entered; the receiving vault opens it and imports it. The phrase never crosses the vault API.
 */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromUtf8, randomBytes, toHex, utf8, wipe } from "./bytes.js";
import { hkdf32, open, seal, type SealedBox } from "./crypto.js";

export const SYNC_LABEL = "clip/sync/v1";
export const SYNC_SIGN_PREFIX = "clip-sync-v1\n";
const PAIRING_TTL_MS = 15 * 60_000;
const MAX_PAIRINGS = 8;
const TRANSFER_AAD = "clip-link/v1/transfer";

/** What the link package gets for settings sync. Holds derived keys only; `sign` re-derives from the seed per call. */
export interface SyncKeyHandle {
  /** Ed25519 public key (32 bytes). */
  publicKey: Uint8Array;
  /** Where the server files this wallet's ciphertext: hex SHA-256 of the public key. */
  space: string;
  /** XChaCha20-Poly1305 key for sync records. */
  dataKey: Uint8Array;
  /** HMAC-SHA256 key that turns (collection, id) into an opaque record id. */
  idKey: Uint8Array;
  /** Signs a sync request (must start with "clip-sync-v1\n"). Throws vault/locked once the wallet locks. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** An ephemeral X25519 key for one pairing. */
export interface PairingKeyHandle {
  id: string;
  publicKey: Uint8Array;
  /** The 32-byte link secret for this pairing (channel keys, SAS, key confirmation). */
  agree(peerPublicKey: Uint8Array, transcriptHash: Uint8Array): Promise<Uint8Array>;
  /** Forget the private key now (it is also forgotten after 15 minutes). */
  destroy(): void;
}

export function syncRoot(seed: Uint8Array): Uint8Array {
  return hkdf32(seed, utf8("clip-wallet/vault/sync"), SYNC_LABEL);
}

function subKey(root: Uint8Array, info: string): Uint8Array {
  return hkdf32(root, new Uint8Array(0), `${SYNC_LABEL}/${info}`);
}

/** Public parts + derived symmetric keys. `seedFn` is called for every signature so a locked vault refuses. */
export function syncKeyHandle(seed: Uint8Array, seedFn: () => Uint8Array): SyncKeyHandle {
  const root = syncRoot(seed);
  const sk = subKey(root, "auth-ed25519");
  try {
    const publicKey = ed25519.getPublicKey(sk);
    return {
      publicKey,
      space: toHex(sha256(publicKey)),
      dataKey: subKey(root, "data-xchacha20"),
      idKey: subKey(root, "record-id"),
      async sign(message: Uint8Array) {
        if (!(message instanceof Uint8Array) || fromUtf8(message.subarray(0, SYNC_SIGN_PREFIX.length)) !== SYNC_SIGN_PREFIX) {
          throw new RangeError("the sync key only signs sync requests");
        }
        const r = syncRoot(seedFn());
        const k = subKey(r, "auth-ed25519");
        try {
          return ed25519.sign(message, k);
        } finally {
          wipe(r, k);
        }
      },
    };
  } finally {
    wipe(root, sk);
  }
}

function isAllZero(b: Uint8Array): boolean {
  let d = 0;
  for (const x of b) d |= x;
  return d === 0;
}

/** Holds ephemeral X25519 private keys by id. */
export class PairingKeys {
  private readonly keys = new Map<string, { sk: Uint8Array; publicKey: Uint8Array; expires: number }>();
  constructor(private readonly now: () => number) {}

  create(): PairingKeyHandle {
    this.sweep();
    while (this.keys.size >= MAX_PAIRINGS) this.drop(this.keys.keys().next().value!);
    const sk = randomBytes(32);
    const publicKey = x25519.getPublicKey(sk);
    const id = toHex(randomBytes(12));
    this.keys.set(id, { sk, publicKey, expires: this.now() + PAIRING_TTL_MS });
    return {
      id,
      publicKey: publicKey.slice(),
      agree: async (peer, transcriptHash) => this.derive(id, peer, transcriptHash, "clip/link/session/v1"),
      destroy: () => this.drop(id),
    };
  }

  /** HKDF(X25519(sk, peer), salt = transcriptHash, info). Throws if the key is gone or the peer key is degenerate. */
  derive(id: string, peer: Uint8Array, transcriptHash: Uint8Array, info: string): Uint8Array {
    this.sweep();
    const k = this.keys.get(id);
    if (!k) throw new Error("pairing key expired");
    if (!(peer instanceof Uint8Array) || peer.length !== 32) throw new Error("peer key must be 32 bytes");
    if (!(transcriptHash instanceof Uint8Array) || transcriptHash.length !== 32) throw new Error("transcript hash must be 32 bytes");
    const shared = x25519.getSharedSecret(k.sk, peer);
    try {
      if (isAllZero(shared)) throw new Error("peer key is not usable");
      return hkdf32(shared, transcriptHash, info);
    } finally {
      wipe(shared);
    }
  }

  drop(id: string): void {
    const k = this.keys.get(id);
    if (k) wipe(k.sk);
    this.keys.delete(id);
  }

  clear(): void {
    for (const id of [...this.keys.keys()]) this.drop(id);
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, k] of this.keys) if (k.expires <= t) this.drop(id);
  }
}

export function sealTransfer(transferKey: Uint8Array, entropy: Uint8Array): SealedBox {
  return seal(transferKey, entropy, TRANSFER_AAD);
}

export function openTransfer(transferKey: Uint8Array, box: SealedBox): Uint8Array {
  return open(transferKey, box, TRANSFER_AAD);
}

export const TRANSFER_INFO = "clip/link/transfer/v1";
