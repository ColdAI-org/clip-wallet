/**
 * Encrypted app data (Phase 2.5, additive): small JSON documents the wallet keeps for the user that aren't keys
 * but are private, such as the address book (packages/social). Same construction as the vault metadata
 * (meta.ts), with its own key per namespace so one feature's ciphertext can't be swapped for another's:
 *
 *   key = HKDF-SHA256(ikm = BIP-39 seed, salt = "clip-wallet/vault/app-data", info = "clip-wallet/vault/app-data/<ns>/v1")
 *   box = XChaCha20-Poly1305(key, utf8(plaintext), aad = "clip-vault/v1/app-data/<ns>")
 *
 * Tied to the seed: available only while unlocked, survives password changes, and a restored wallet (same
 * phrase) can open a synced copy.
 */
import { fromUtf8, utf8, wipe } from "./bytes.js";
import { hkdf32, open, seal, type SealedBox } from "./crypto.js";

const NAMESPACE = /^[a-z][a-z0-9-]{0,31}$/;

export function checkNamespace(ns: string): void {
  if (!NAMESPACE.test(ns)) throw new RangeError("app-data namespace must be [a-z][a-z0-9-]{0,31}");
}

function appDataKey(seed: Uint8Array, ns: string): Uint8Array {
  return hkdf32(seed, utf8("clip-wallet/vault/app-data"), `clip-wallet/vault/app-data/${ns}/v1`);
}

export function sealAppData(seed: Uint8Array, ns: string, plaintext: string): SealedBox {
  checkNamespace(ns);
  const k = appDataKey(seed, ns);
  try {
    return seal(k, utf8(plaintext), `clip-vault/v1/app-data/${ns}`);
  } finally {
    wipe(k);
  }
}

/** Throws on a wrong seed, another namespace's box, or tampering. */
export function openAppData(seed: Uint8Array, ns: string, box: SealedBox): string {
  checkNamespace(ns);
  const k = appDataKey(seed, ns);
  let raw: Uint8Array | undefined;
  try {
    raw = open(k, box, `clip-vault/v1/app-data/${ns}`);
    return fromUtf8(raw);
  } finally {
    wipe(k, raw);
  }
}
