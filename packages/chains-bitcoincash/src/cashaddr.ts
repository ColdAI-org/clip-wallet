import { concat, hash160 } from "./util.js";

/**
 * CashAddr (https://reference.cash/protocol/blockchain/encoding/cashaddr): prefix ":" base32(version ‖ hash ‖
 * 40-bit BCH checksum). Version byte = type << 3 | size: type 0 P2PKH, 1 P2SH, 2 token-aware P2PKH, 3 token-aware
 * P2SH (CHIP-2022-02-CashTokens); size 0 = 160-bit hash, 3 = 256-bit (P2SH32). Same encoding as the vault's
 * `cashAddress` (packages/vault/src/encodings87.ts); checked against libauth in the tests.
 */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const SIZE_BITS: Record<number, number> = { 0: 20, 1: 24, 2: 28, 3: 32, 4: 40, 5: 48, 6: 56, 7: 64 };

export type CashKind = "p2pkh" | "p2sh";
export const PREFIXES = ["bitcoincash", "bchtest", "bchreg"] as const;
export type CashPrefix = (typeof PREFIXES)[number];

function polymod(values: number[]): bigint {
  const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i]!;
  }
  return c ^ 1n;
}

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v < 0 || v >> from) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max)) return null;
  return out;
}

const prefixWords = (prefix: string) => [...prefix].map((ch) => ch.charCodeAt(0) & 31);

export function encodeCashAddress(prefix: string, type: number, hash: Uint8Array): string {
  const size = Object.entries(SIZE_BITS).find(([, n]) => n === hash.length)?.[0];
  if (size === undefined || type < 0 || type > 15) throw new Error("bad cashaddr input");
  const payload = convertBits(concat(new Uint8Array([(type << 3) | Number(size)]), hash), 8, 5, true)!;
  const mod = polymod([...prefixWords(prefix), 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const check: number[] = [];
  for (let i = 0; i < 8; i++) check.push(Number((mod >> BigInt(5 * (7 - i))) & 31n));
  return `${prefix}:${[...payload, ...check].map((w) => CHARSET[w]).join("")}`;
}

export interface DecodedCashAddress {
  prefix: CashPrefix;
  /** 0 P2PKH, 1 P2SH, 2 token-aware P2PKH, 3 token-aware P2SH. */
  type: number;
  kind: CashKind;
  tokenAware: boolean;
  hash: Uint8Array;
}

/**
 * Parses a CashAddr with its prefix, or without one when `defaultPrefix` is given (the checksum decides). Mixed
 * case is refused, as the spec says. Null for anything that isn't a valid P2PKH/P2SH CashAddr.
 */
export function decodeCashAddress(value: string, defaultPrefix?: CashPrefix): DecodedCashAddress | null {
  const v = value.trim();
  if (v !== v.toLowerCase() && v !== v.toUpperCase()) return null;
  const lower = v.toLowerCase();
  const i = lower.indexOf(":");
  const candidates: string[] = i >= 0 ? [lower.slice(0, i)] : defaultPrefix ? [defaultPrefix] : [...PREFIXES];
  const body = i >= 0 ? lower.slice(i + 1) : lower;
  if (!body || body.length < 42 || body.length > 112) return null;
  const words: number[] = [];
  for (const ch of body) {
    const w = CHARSET.indexOf(ch);
    if (w < 0) return null;
    words.push(w);
  }
  for (const prefix of candidates) {
    if (!(PREFIXES as readonly string[]).includes(prefix)) continue;
    if (polymod([...prefixWords(prefix), 0, ...words]) !== 0n) continue;
    const data = convertBits(words.slice(0, -8), 5, 8, false);
    if (!data || !data.length) return null;
    const version = data[0]!;
    if (version & 0x80) return null;
    const type = version >> 3;
    const size = SIZE_BITS[version & 7];
    const hash = Uint8Array.from(data.slice(1));
    if (size === undefined || hash.length !== size) return null;
    if (type > 3) return null;
    const kind: CashKind = type === 0 || type === 2 ? "p2pkh" : "p2sh";
    if (kind === "p2pkh" && hash.length !== 20) return null;
    if (kind === "p2sh" && hash.length !== 20 && hash.length !== 32) return null;
    return { prefix: prefix as CashPrefix, type, kind, tokenAware: type >= 2, hash };
  }
  return null;
}

/** P2PKH CashAddr of a compressed key. */
export function p2pkhAddress(compressedKey: Uint8Array, prefix: CashPrefix): string {
  if (compressedKey.length !== 33) throw new Error("Bitcoin Cash needs a compressed secp256k1 public key");
  return encodeCashAddress(prefix, 0, hash160(compressedKey));
}

/* ------------------------------------------------------------------ locking bytecode */

const OP_DUP = 0x76;
const OP_HASH160 = 0xa9;
const OP_HASH256 = 0xaa;
const OP_EQUALVERIFY = 0x88;
const OP_EQUAL = 0x87;
const OP_CHECKSIG = 0xac;

export function p2pkhScript(h: Uint8Array): Uint8Array {
  return concat(new Uint8Array([OP_DUP, OP_HASH160, 20]), h, new Uint8Array([OP_EQUALVERIFY, OP_CHECKSIG]));
}

export function lockingBytecodeOf(a: DecodedCashAddress): Uint8Array {
  if (a.kind === "p2pkh") return p2pkhScript(a.hash);
  if (a.hash.length === 32) return concat(new Uint8Array([OP_HASH256, 32]), a.hash, new Uint8Array([OP_EQUAL]));
  return concat(new Uint8Array([OP_HASH160, 20]), a.hash, new Uint8Array([OP_EQUAL]));
}

/** The CashAddr a locking bytecode pays to (P2PKH, P2SH20, P2SH32), else null. */
export function addressOfScript(script: Uint8Array, prefix: CashPrefix, tokenAware = false): string | null {
  if (script.length === 25 && script[0] === OP_DUP && script[1] === OP_HASH160 && script[2] === 20 && script[23] === OP_EQUALVERIFY && script[24] === OP_CHECKSIG) {
    return encodeCashAddress(prefix, tokenAware ? 2 : 0, script.subarray(3, 23));
  }
  if (script.length === 23 && script[0] === OP_HASH160 && script[1] === 20 && script[22] === OP_EQUAL) return encodeCashAddress(prefix, tokenAware ? 3 : 1, script.subarray(2, 22));
  if (script.length === 35 && script[0] === OP_HASH256 && script[1] === 32 && script[34] === OP_EQUAL) return encodeCashAddress(prefix, tokenAware ? 3 : 1, script.subarray(2, 34));
  return null;
}
