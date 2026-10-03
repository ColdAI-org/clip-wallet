/**
 * Raw signing primitives. Callers (ClipVault.sign) enforce approval and curve checks first.
 */
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as sr25519 from "@scure/sr25519";
import * as stark from "@scure/starknet";
import { bytesToBigInt } from "./address.js";
import { wipe } from "./bytes.js";

/** ECDSA over a 32-byte digest. RFC 6979 deterministic, low-S enforced. Returns r||s and recovery id (0/1). */
export function signEcdsa(digest: Uint8Array, privateKey: Uint8Array): { bytes: Uint8Array; recovery: number } {
  if (digest.length !== 32) throw new Error("ecdsa-secp256k1 signs a 32-byte digest");
  const rec = secp256k1.sign(digest, privateKey, { prehash: false, lowS: true, format: "recovered" });
  // noble "recovered" layout: recovery(1) || r(32) || s(32)
  const recovery = rec[0]!;
  const bytes = rec.slice(1);
  wipe(rec);
  return { bytes, recovery };
}

/**
 * BIP-340 Schnorr. With `taprootTweak` (merkle root, or an EMPTY array for BIP-86 key-path-only spends)
 * the key is tweaked per BIP-341: d' = (has_even_y(P) ? d : n-d) + H_TapTweak(P_x || merkleRoot).
 * Returns the signature and the x-only key that verifies it.
 */
export function signSchnorr(
  message: Uint8Array,
  privateKey: Uint8Array,
  taprootTweak?: Uint8Array,
): { bytes: Uint8Array; publicKey: Uint8Array } {
  if (taprootTweak === undefined) {
    return { bytes: schnorr.sign(message, privateKey), publicKey: schnorr.getPublicKey(privateKey) };
  }
  if (taprootTweak.length !== 0 && taprootTweak.length !== 32) throw new Error("taproot merkle root must be 0 or 32 bytes");
  const Fn = secp256k1.Point.Fn;
  const n = Fn.ORDER;
  let d = bytesToBigInt(privateKey);
  const P = secp256k1.Point.BASE.multiply(d);
  if (P.y % 2n !== 0n) d = n - d;
  const px = P.toBytes(true).subarray(1);
  const t = bytesToBigInt(schnorr.utils.taggedHash("TapTweak", px, taprootTweak));
  if (t >= n) throw new Error("taproot tweak out of range");
  const tweaked = (d + t) % n;
  if (tweaked === 0n) throw new Error("tweaked key is zero");
  const sk = Fn.toBytes(tweaked);
  try {
    return { bytes: schnorr.sign(message, sk), publicKey: schnorr.getPublicKey(sk) };
  } finally {
    wipe(sk);
  }
}

export function signEd25519(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/** Cardano: Ed25519 signature with the BIP32-Ed25519 extended key (kL ‖ kR). Verifies as plain Ed25519. */
export { signExtended as signBip32Ed25519 } from "./bip32ed25519.js";

/** sr25519 (Schnorrkel) with the "substrate" signing context, fresh nonce randomness. 64 bytes. */
export function signSr25519(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return sr25519.sign(secretKey, message);
}

/** Largest Stark message hash accepted: Starknet signs field elements below 2^251. */
const STARK_MAX_MESSAGE = 1n << 251n;

/**
 * Stark-curve ECDSA over a message hash the chain module computed (Pedersen/Poseidon transaction hash),
 * given as up to 32 big-endian bytes with value < 2^251. RFC 6979 deterministic. Returns r ‖ s (32 bytes each).
 */
export function signStark(messageHash: Uint8Array, privateKey: Uint8Array): { bytes: Uint8Array; recovery?: number } {
  if (messageHash.length === 0 || messageHash.length > 32) throw new Error("stark-ecdsa signs a hash of at most 32 bytes");
  if (bytesToBigInt(messageHash) >= STARK_MAX_MESSAGE) throw new Error("stark message hash must be below 2^251");
  const sig = stark.sign(messageHash, privateKey);
  const bytes = new Uint8Array(64);
  bytes.set(numTo32(sig.r), 0);
  bytes.set(numTo32(sig.s), 32);
  return { bytes, recovery: sig.recovery };
}

function numTo32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}
