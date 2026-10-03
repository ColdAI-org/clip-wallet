/**
 * A device's answer is only used if it verifies over exactly the bytes the user approved
 * (`SignablePayload.bytes`) with the account's public key. Whatever a device was shown (`raw`), this
 * keeps a hardware signature as tightly bound as a vault signature. Verification only: no private keys.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { Signature, SignablePayload } from "@clip-wallet/core";
import { HardwareErrors } from "./errors.js";
import { equal, fromHex, toHex } from "./bytes.js";

const N = secp256k1.Point.CURVE().n;

/**
 * Normalises an ECDSA r||s to low-S and finds the recovery bit for `digest` and `publicKey`.
 * Throws a plain-words error when the signature is not by this key over this digest.
 */
export function ecdsaSignature(rs: Uint8Array, digest: Uint8Array, publicKeyHex: string): Signature {
  if (rs.length !== 64 || digest.length !== 32) throw HardwareErrors.badSignature("ecdsa shape");
  let s = secp256k1.Signature.fromBytes(rs, "compact");
  if (s.hasHighS()) s = new secp256k1.Signature(s.r, N - s.s);
  const pub = fromHex(publicKeyHex);
  const compact = s.toBytes("compact");
  if (!secp256k1.verify(compact, digest, pub, { prehash: false, lowS: true })) throw HardwareErrors.badSignature("ecdsa verify");
  const compressed = pub.length === 33 ? pub : secp256k1.Point.fromBytes(pub).toBytes(true);
  for (const rec of [0, 1]) {
    try {
      if (equal(s.addRecoveryBit(rec).recoverPublicKey(digest).toBytes(true), compressed)) {
        return { scheme: "ecdsa-secp256k1", bytes: compact, recovery: rec, publicKey: toHex(compressed) };
      }
    } catch {
      /* try the other bit */
    }
  }
  throw HardwareErrors.badSignature("ecdsa recovery");
}

export function ed25519Signature(sig: Uint8Array, message: Uint8Array, publicKeyHex: string): Signature {
  const pub = fromHex(publicKeyHex);
  if (sig.length !== 64 || pub.length !== 32 || !ed25519.verify(sig, message, pub)) throw HardwareErrors.badSignature("ed25519 verify");
  return { scheme: "ed25519", bytes: sig, publicKey: publicKeyHex.toLowerCase() };
}

/** Final gate used by the keyring for every hardware signature, whatever the device. */
export function assertVerifies(sig: Signature, payload: SignablePayload, publicKeyHex: string): void {
  if (sig.scheme !== payload.scheme) throw HardwareErrors.badSignature("scheme");
  if (sig.scheme === "ecdsa-secp256k1") {
    const again = ecdsaSignature(sig.bytes, payload.bytes, publicKeyHex);
    if (again.recovery !== sig.recovery) throw HardwareErrors.badSignature("recovery");
    return;
  }
  if (sig.scheme === "ed25519") {
    ed25519Signature(sig.bytes, payload.bytes, publicKeyHex);
    return;
  }
  throw HardwareErrors.unsupported("this kind of signature");
}
