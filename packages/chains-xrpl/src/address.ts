import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58xrp } from "@scure/base";
import { bytesEqual, concat } from "./util.js";

/**
 * XRPL addresses (https://xrpl.org/docs/concepts/accounts/addresses): base58 with the Ripple alphabet over
 * payload ‖ SHA-256(SHA-256(payload))[0..4]. Classic "r…" payload = 0x00 ‖ AccountID (RIPEMD-160(SHA-256(key))).
 * X-addresses (https://xrpaddress.info, ripple-address-codec `encodeXAddress`) = prefix ‖ AccountID ‖ flag ‖ tag:
 * prefix 0x05 0x44 ("X…", mainnet) or 0x04 0x93 ("T…", test networks), flag 0 (no tag) or 1 (32-bit tag, written
 * little-endian in 8 bytes).
 */

function checked(payload: Uint8Array): string {
  return base58xrp.encode(concat(payload, sha256(sha256(payload)).subarray(0, 4)));
}

function unchecked(text: string): Uint8Array | null {
  let raw: Uint8Array;
  try {
    raw = base58xrp.decode(text);
  } catch {
    return null;
  }
  if (raw.length < 5) return null;
  const payload = raw.subarray(0, raw.length - 4);
  return bytesEqual(sha256(sha256(payload)).subarray(0, 4), raw.subarray(raw.length - 4)) ? payload : null;
}

/** AccountID (20 bytes) of a secp256k1 public key. */
export function accountIdOf(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 33 && publicKey.length !== 65) throw new Error("XRPL needs a secp256k1 public key");
  return ripemd160(sha256(secp256k1.Point.fromBytes(publicKey).toBytes(true)));
}

export function encodeClassic(accountId: Uint8Array): string {
  if (accountId.length !== 20) throw new Error("AccountID is 20 bytes");
  return checked(concat(new Uint8Array([0x00]), accountId));
}

/** 20-byte AccountID of a classic address, or null when it isn't one (checksum included). */
export function decodeClassic(address: string): Uint8Array | null {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return null;
  const p = unchecked(address);
  return p && p.length === 21 && p[0] === 0x00 ? p.slice(1) : null;
}

export function isClassicAddress(value: string): boolean {
  return decodeClassic(value) !== null;
}

export interface XAddress {
  classic: string;
  tag: number | null;
  test: boolean;
}

export function decodeXAddress(value: string): XAddress | null {
  if (!/^[XT][1-9A-HJ-NP-Za-km-z]{45,47}$/.test(value)) return null;
  const p = unchecked(value);
  if (!p || p.length !== 31) return null;
  const test = p[0] === 0x04 && p[1] === 0x93;
  if (!test && !(p[0] === 0x05 && p[1] === 0x44)) return null;
  const flag = p[22];
  const t = p.subarray(23, 31);
  if (flag === 0) {
    if (t.some((b) => b !== 0)) return null;
    return { classic: encodeClassic(p.slice(2, 22)), tag: null, test };
  }
  if (flag !== 1 || t[4] || t[5] || t[6] || t[7]) return null; // 64-bit tags aren't valid on the XRPL
  const tag = (t[0]! | (t[1]! << 8) | (t[2]! << 16)) + t[3]! * 0x1000000;
  return { classic: encodeClassic(p.slice(2, 22)), tag, test };
}

export function encodeXAddress(classic: string, tag: number | null, test: boolean): string {
  const id = decodeClassic(classic);
  if (!id) throw new Error("not a classic address");
  const t = new Uint8Array(8);
  if (tag !== null) {
    if (!Number.isInteger(tag) || tag < 0 || tag > 0xffffffff) throw new Error("bad destination tag");
    t[0] = tag & 0xff;
    t[1] = (tag >>> 8) & 0xff;
    t[2] = (tag >>> 16) & 0xff;
    t[3] = (tag >>> 24) & 0xff;
  }
  return checked(concat(new Uint8Array(test ? [0x04, 0x93] : [0x05, 0x44]), id, new Uint8Array([tag === null ? 0 : 1]), t));
}

export function addressOfPublicKey(publicKey: Uint8Array): string {
  return encodeClassic(accountIdOf(publicKey));
}
