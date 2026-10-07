import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bech32 } from "@scure/base";

/**
 * Account addresses, matching the vault (packages/vault/src/encodings87.ts):
 *  - secp256k1 (cosmos, provenance, thorchain): bech32(prefix, RIPEMD-160(SHA-256(compressed key))) — ADR-028 legacy
 *    accounts, cosmjs `pubkeyToAddress`.
 *  - ethsecp256k1 (initia): bech32("init", keccak256(uncompressed x‖y)[12..]) — the EVM address's 20 bytes
 *    (initia crypto/ethsecp256k1 PubKey.Address()).
 */
export type KeyKind = "secp256k1" | "ethsecp256k1";

export function compressedKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 33 && publicKey.length !== 65) throw new Error("expected a secp256k1 public key");
  return secp256k1.Point.fromBytes(publicKey).toBytes(true);
}

export function addressBytes(publicKey: Uint8Array, kind: KeyKind): Uint8Array {
  if (kind === "ethsecp256k1") {
    const full = secp256k1.Point.fromBytes(compressedKey(publicKey)).toBytes(false);
    return keccak_256(full.subarray(1)).subarray(12);
  }
  return ripemd160(sha256(compressedKey(publicKey)));
}

export function bech32Address(prefix: string, data: Uint8Array): string {
  return bech32.encode(prefix, bech32.toWords(data));
}

/** { prefix, data } for a valid bech32 (not bech32m) string in lower case, else null. */
export function decodeBech32(value: string): { prefix: string; data: Uint8Array } | null {
  const v = value.trim();
  if (v !== v.toLowerCase()) return null;
  try {
    const d = bech32.decode(v as `${string}1${string}`, 90);
    return { prefix: d.prefix, data: bech32.fromWords(d.words) };
  } catch {
    return null;
  }
}

/** Account (20 bytes) or contract/module (32 bytes) address with one of `prefixes`. */
export function isAccountAddress(value: string, prefixes: readonly string[]): boolean {
  const d = decodeBech32(value);
  return !!d && prefixes.includes(d.prefix) && (d.data.length === 20 || d.data.length === 32);
}
