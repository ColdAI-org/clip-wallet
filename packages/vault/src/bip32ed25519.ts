/**
 * BIP32-Ed25519 (Khovratovich & Law) for two families:
 *
 * Cardano — CIP-3 "Icarus" master key + derivation scheme V2 (g = 32), as used by Daedalus/Yoroi/Eternl/Lace
 * and cardano-serialization-lib `Bip32PrivateKey.from_bip39_entropy`.
 *
 *   master = PBKDF2-HMAC-SHA512(password = passphrase (""), salt = BIP-39 entropy, 4096 iterations, 96 bytes)
 *            kL = master[0..32] clamped (kL[0] &= 0xf8; kL[31] &= 0x1f; kL[31] |= 0x40), kR = master[32..64],
 *            chain code = master[64..96]
 *   hardened i:  Z = HMAC512(c, 0x00 ‖ kL ‖ kR ‖ LE32(i)),  c' = HMAC512(c, 0x01 ‖ kL ‖ kR ‖ LE32(i))[32..]
 *   soft i:      Z = HMAC512(c, 0x02 ‖ A ‖ LE32(i)),        c' = HMAC512(c, 0x03 ‖ A ‖ LE32(i))[32..]
 *   kL' = kL + 8·Z[0..28]   (little-endian, 256-bit)      kR' = kR + Z[32..64] mod 2^256
 *
 * Sources: https://github.com/cardano-foundation/CIPs/blob/master/CIP-0003/Icarus.md,
 * https://input-output-hk.github.io/adrestia/static/Ed25519_BIP.pdf (BIP32-Ed25519 paper),
 * https://github.com/input-output-hk/cardano-crypto (cbits/encrypted_sign.c, derivation V2).
 *
 * Algorand — ARC-52 (algorandfoundation/ARCs PR #239, xHD-Wallet-API), as Pera's Universal Wallet uses:
 * root from the BIP-39 seed (k = SHA-512(seed), re-hashed with HMAC-SHA512(kL, kR) while kL[31] & 0x20,
 * kL[0] &= 0xf8, kL[31] &= 0x7f, kL[31] |= 0x40; chain code = SHA-256(0x01 ‖ seed)) and Peikert's amendment
 * g = 9: kL' = kL + 8·trunc_{256-9}(Z[0..32]), which must stay below 2^255.
 * https://github.com/algorandfoundation/xHD-Wallet-API-ts/blob/main/src/bip32-ed25519.ts
 *
 * Signing with an extended key (kL, kR) is plain RFC 8032 Ed25519 except that the scalar is kL (already
 * clamped, not SHA-512(seed)) and the nonce prefix is kR. The result verifies as an ordinary Ed25519 signature.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { concat, wipe } from "./bytes.js";

const HARDENED = 0x80000000;
const L = ed25519.Point.Fn.ORDER;
const TWO_256 = 1n << 256n;

export interface XPrv {
  /** 64 bytes: kL ‖ kR. Wipe after use. */
  key: Uint8Array;
  chainCode: Uint8Array;
}

export function leToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n;
}

export function bigIntToLe(n: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

const le32 = (i: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, i >>> 0, true);
  return b;
};

/** CIP-3 Icarus master key from BIP-39 entropy (not the BIP-39 seed). */
export function icarusMaster(entropy: Uint8Array, passphrase = ""): XPrv {
  const data = pbkdf2(sha512, new TextEncoder().encode(passphrase), entropy, { c: 4096, dkLen: 96 });
  data[0]! &= 0b1111_1000;
  data[31]! &= 0b0001_1111;
  data[31]! |= 0b0100_0000;
  const node = { key: data.slice(0, 64), chainCode: data.slice(64, 96) };
  wipe(data);
  return node;
}

/** ARC-52 root from the 64-byte BIP-39 seed (see header). */
export function arc52Master(seed: Uint8Array): XPrv {
  let k = sha512(seed);
  while ((k[31]! & 0b0010_0000) !== 0) {
    const next = hmac(sha512, k.subarray(0, 32), k.subarray(32, 64));
    wipe(k);
    k = next;
  }
  k[0]! &= 0b1111_1000;
  k[31]! &= 0b0111_1111;
  k[31]! |= 0b0100_0000;
  const node = { key: k.slice(0, 64), chainCode: sha256(concat(new Uint8Array([0x01]), seed)) };
  wipe(k);
  return node;
}

/** g: how many top bits of Z[0..32] are dropped. 32 = Khovratovich/Cardano (28 bytes), 9 = Peikert (ARC-52). */
export type TruncBits = 32 | 9;

/** 32-byte Ed25519 public key A = kL·G. */
export function xprvPublicKey(key: Uint8Array): Uint8Array {
  const kL = leToBigInt(key.subarray(0, 32)) % L;
  if (kL === 0n) throw new Error("bip32-ed25519: zero scalar");
  return ed25519.Point.BASE.multiply(kL).toBytes();
}

export function deriveChild(parent: XPrv, index: number, g: TruncBits = 32): XPrv {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw new Error("bad index");
  const hardened = index >= HARDENED;
  const kL = parent.key.subarray(0, 32);
  const kR = parent.key.subarray(32, 64);
  const body = hardened ? parent.key : xprvPublicKey(parent.key);
  const zData = concat(new Uint8Array([hardened ? 0x00 : 0x02]), body, le32(index));
  const cData = concat(new Uint8Array([hardened ? 0x01 : 0x03]), body, le32(index));
  const Z = hmac(sha512, parent.chainCode, zData);
  const I = hmac(sha512, parent.chainCode, cData);
  const zL = leToBigInt(Z.subarray(0, 32)) & ((1n << BigInt(256 - g)) - 1n);
  const zR = leToBigInt(Z.subarray(32, 64));
  const childL = leToBigInt(kL) + 8n * zL;
  if (childL >= (g === 9 ? 1n << 255n : TWO_256)) throw new Error("bip32-ed25519: kL overflow");
  const childR = (leToBigInt(kR) + zR) % TWO_256;
  const key = concat(bigIntToLe(childL, 32), bigIntToLe(childR, 32));
  const chainCode = I.slice(32, 64);
  wipe(Z, I, zData, cData);
  return { key, chainCode };
}

/** Parses "m/1852'/1815'/0'/0/0" (hardened and soft segments allowed). */
export function parsePath(path: string): number[] {
  const parts = path.split("/");
  if (parts[0] !== "m") throw new Error(`bad path: ${path}`);
  return parts.slice(1).map((p) => {
    const m = /^(\d+)(['hH]?)$/.exec(p);
    if (!m) throw new Error(`bad path segment: ${p}`);
    const n = Number(m[1]);
    if (n >= HARDENED) throw new Error(`index out of range: ${p}`);
    return m[2] ? n + HARDENED : n;
  });
}

function deriveFrom(root: XPrv, path: string, g: TruncBits): XPrv {
  let node = root;
  for (const i of parsePath(path)) {
    const next = deriveChild(node, i, g);
    wipe(node.key, node.chainCode);
    node = next;
  }
  return node;
}

/** Cardano: Icarus master from the BIP-39 entropy, derivation V2 (g = 32). */
export const deriveXPrv = (entropy: Uint8Array, path: string): XPrv => deriveFrom(icarusMaster(entropy), path, 32);

/** Algorand ARC-52: root from the BIP-39 seed, Peikert (g = 9). */
export const deriveArc52 = (seed: Uint8Array, path: string): XPrv => deriveFrom(arc52Master(seed), path, 9);

/** Ed25519 signature with an extended key (kL ‖ kR). Verifies with any RFC 8032 verifier against xprvPublicKey(key). */
export function signExtended(message: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 64) throw new Error("extended key must be 64 bytes");
  const kL = leToBigInt(key.subarray(0, 32)) % L;
  const A = xprvPublicKey(key);
  const r = leToBigInt(sha512(concat(key.subarray(32, 64), message))) % L;
  const R = (r === 0n ? ed25519.Point.ZERO : ed25519.Point.BASE.multiply(r)).toBytes();
  const h = leToBigInt(sha512(concat(R, A, message))) % L;
  const S = (r + h * kL) % L;
  return concat(R, bigIntToLe(S, 32));
}
