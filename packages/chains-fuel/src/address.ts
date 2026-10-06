import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, hex, utf8 } from "./util.js";

/**
 * Fuel addresses (fuels-ts @fuel-ts/address + Signer): the address of a secp256k1 key is SHA-256 of its 64-byte
 * uncompressed form without the 0x04 prefix, written as 0x-hex with fuels-ts' checksum (`Address.toChecksum`): a hex
 * letter is upper case where the matching nibble of SHA-256 of the lower-case hex TEXT (no "0x") is 8 or more. Same as
 * the vault's `fuelAddress` (packages/vault/src/encodings87.ts), recomputed here because chain modules never import
 * the vault.
 */
export function addressBytesFromPublicKey(publicKey: Uint8Array): Uint8Array {
  const uncompressed = publicKey.length === 65 ? publicKey : secp256k1.Point.fromBytes(publicKey).toBytes(false);
  if (uncompressed.length !== 65 || uncompressed[0] !== 4) throw new Error("secp256k1 public key expected");
  return sha256(uncompressed.subarray(1));
}

export function toChecksum(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(lower)) throw new Error("fuel addresses are 32 bytes");
  const h = sha256(utf8(lower));
  let out = "0x";
  for (let i = 0; i < 32; i++) {
    const byte = h[i]!;
    out += byte >> 4 >= 8 ? lower[i * 2]!.toUpperCase() : lower[i * 2]!;
    out += (byte & 0x0f) >= 8 ? lower[i * 2 + 1]!.toUpperCase() : lower[i * 2 + 1]!;
  }
  return out;
}

export function fuelAddressFromPublicKey(publicKey: Uint8Array): string {
  return toChecksum(hex(addressBytesFromPublicKey(publicKey)));
}

/**
 * A Fuel address: 0x + 64 hex digits. All-lower-case or all-upper-case is accepted (no checksum to check, as
 * EIP-55); mixed case must be the fuels-ts checksum exactly, so a typo in a copied address is caught. The old bech32
 * `fuel1…` form was removed from fuels-ts (v0.94) and isn't accepted.
 */
export function isFuelAddress(value: string): boolean {
  const v = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) return false;
  const body = v.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksum(v) === v;
}

/** Lower-case b256 for comparisons and the wire; throws for anything that isn't a Fuel address. */
export function b256(value: string): string {
  if (!isFuelAddress(value)) throw new Error("not a fuel address");
  return value.trim().toLowerCase();
}

export function b256Bytes(value: string): Uint8Array {
  return fromHex(b256(value));
}
