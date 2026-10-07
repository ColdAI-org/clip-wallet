import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createBase58check } from "@scure/base";
import { bytesEqual, concat, fromHex, hex } from "./util.js";

/**
 * TRON addresses (https://developers.tron.network/docs/account): 21 bytes 0x41 ‖ keccak256(uncompressed key)[12..32],
 * shown as base58check ("T…", 34 characters; checksum = first 4 bytes of sha256(sha256(payload))) or as hex "41…".
 * Contract addresses use the same form.
 */
export const ADDRESS_PREFIX = 0x41;
const b58check = createBase58check(sha256);

/** 21-byte address (0x41 ‖ 20 bytes) for a secp256k1 public key (33-byte compressed or 65-byte uncompressed). */
export function addressBytesFromPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 33 && publicKey.length !== 65) throw new Error("secp256k1 public key must be 33 or 65 bytes");
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return concat(new Uint8Array([ADDRESS_PREFIX]), keccak_256(uncompressed.subarray(1)).subarray(12));
}

export function encodeAddress(bytes21: Uint8Array): string {
  if (bytes21.length !== 21 || bytes21[0] !== ADDRESS_PREFIX) throw new Error("not a TRON address");
  return b58check.encode(bytes21);
}

/** 21-byte address from base58check "T…" or hex "41…" (0x optional). Null for anything else, including a bad checksum. */
export function addressBytes(value: string): Uint8Array | null {
  const v = value.trim();
  if (/^(0x)?41[0-9a-fA-F]{40}$/.test(v)) return fromHex(v.replace(/^0x/, ""));
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return null;
  try {
    const b = b58check.decode(v);
    return b.length === 21 && b[0] === ADDRESS_PREFIX ? b : null;
  } catch {
    return null;
  }
}

/** Base58 "T…" for base58 or hex input; null if it isn't a TRON address. */
export function toBase58(value: string): string | null {
  const b = addressBytes(value);
  return b ? encodeAddress(b) : null;
}

/** "41…" hex for base58 or hex input. */
export function toHex41(value: string): string | null {
  const b = addressBytes(value);
  return b ? hex(b) : null;
}

export function isTronAddress(value: string): boolean {
  return /^T/.test(value.trim()) && addressBytes(value) !== null;
}

export function sameAddress(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = typeof a === "string" ? addressBytes(a) : a;
  const y = typeof b === "string" ? addressBytes(b) : b;
  return !!x && !!y && bytesEqual(x, y);
}

/** The 20-byte EVM-style form TRON contracts see (ABI `address`), from a 21-byte address. */
export function evmWord(bytes21: Uint8Array): Uint8Array {
  return bytes21.subarray(1);
}

/** A 21-byte TRON address from an ABI `address` word (last 20 bytes of 32). */
export function fromEvmWord(word: Uint8Array): Uint8Array {
  return concat(new Uint8Array([ADDRESS_PREFIX]), word.subarray(word.length - 20));
}
