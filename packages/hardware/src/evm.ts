import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { toHex } from "./bytes.js";

/** EIP-55 checksummed address of a secp256k1 public key (compressed or not). */
export function evmAddress(publicKey: Uint8Array): string {
  const unc = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  const addr = toHex(keccak_256(unc.subarray(1)).subarray(12));
  const h = toHex(keccak_256(new TextEncoder().encode(addr)));
  return `0x${[...addr].map((c, i) => (parseInt(h[i]!, 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}

export const compressPublicKey = (publicKey: Uint8Array): Uint8Array => secp256k1.Point.fromBytes(publicKey).toBytes(true);
