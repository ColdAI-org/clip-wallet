import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

/**
 * Tezos base58check prefixes (octez `src/lib_crypto/base58.ml`, also Taquito `@taquito/utils` PrefixV2).
 * Payload lengths in comments.
 */
export const PREFIX = {
  tz1: [6, 161, 159], // 20, ed25519 public key hash
  tz2: [6, 161, 161], // 20, secp256k1
  tz3: [6, 161, 164], // 20, p256
  tz4: [6, 161, 166], // 20, bls12-381
  KT1: [2, 90, 121], // 20, originated contract
  edpk: [13, 15, 37, 217], // 32, ed25519 public key
  edsig: [9, 245, 205, 134, 18], // 64, ed25519 signature
  sig: [4, 130, 43], // 64, generic signature
  o: [5, 116], // 32, operation hash
  B: [1, 52], // 32, block hash
  Net: [87, 82, 0], // 4, chain id
} as const satisfies Record<string, readonly number[]>;

export type PrefixName = keyof typeof PREFIX;

const PAYLOAD_LEN: Record<PrefixName, number> = { tz1: 20, tz2: 20, tz3: 20, tz4: 20, KT1: 20, edpk: 32, edsig: 64, sig: 64, o: 32, B: 32, Net: 4 };

export function b58cEncode(prefix: PrefixName, payload: Uint8Array): string {
  const p = PREFIX[prefix];
  const body = new Uint8Array(p.length + payload.length);
  body.set(p);
  body.set(payload, p.length);
  const check = sha256(sha256(body)).subarray(0, 4);
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  out.set(check, body.length);
  return base58.encode(out);
}

/** Decodes and checks prefix, length and checksum. Returns null if anything is off. */
export function b58cDecode(value: string, prefix: PrefixName): Uint8Array | null {
  let raw: Uint8Array;
  try {
    raw = base58.decode(value);
  } catch {
    return null;
  }
  const p = PREFIX[prefix];
  if (raw.length !== p.length + PAYLOAD_LEN[prefix] + 4) return null;
  for (let i = 0; i < p.length; i++) if (raw[i] !== p[i]) return null;
  const body = raw.subarray(0, raw.length - 4);
  const check = sha256(sha256(body)).subarray(0, 4);
  for (let i = 0; i < 4; i++) if (raw[body.length + i] !== check[i]) return null;
  return body.slice(p.length);
}

export const blake2b256 = (b: Uint8Array) => blake2b(b, { dkLen: 32 });

/** tz1 = b58check(tz1 prefix ‖ blake2b-160(ed25519 public key)). */
export function tz1FromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return b58cEncode("tz1", blake2b(publicKey, { dkLen: 20 }));
}

/** edpk… form of an ed25519 public key. */
export function encodePublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return b58cEncode("edpk", publicKey);
}

export function decodePublicKey(edpk: string): Uint8Array | null {
  return b58cDecode(edpk, "edpk");
}

export const ADDRESS_PREFIXES = ["tz1", "tz2", "tz3", "tz4", "KT1"] as const;

/** tz1/tz2/tz3/tz4/KT1 with a valid checksum. */
export function isTezosAddress(value: string): boolean {
  const v = value.trim();
  const p = ADDRESS_PREFIXES.find((x) => v.startsWith(x));
  return !!p && b58cDecode(v, p) !== null;
}

export const isImplicit = (a: string) => /^tz[1-4]/.test(a);
export const isContract = (a: string) => a.startsWith("KT1");

/** Michelson `address` in binary form (22 bytes, optionally followed by an entrypoint) → base58. */
export function addressFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 22) return null;
  if (bytes[0] === 0x00) {
    const curve = (["tz1", "tz2", "tz3", "tz4"] as const)[bytes[1]!];
    return curve ? b58cEncode(curve, bytes.subarray(2, 22)) : null;
  }
  if (bytes[0] === 0x01 && bytes[21] === 0x00) return b58cEncode("KT1", bytes.subarray(1, 21));
  return null;
}

export const signatureToEdsig = (sig: Uint8Array) => b58cEncode("edsig", sig);
export const operationHash = (signedOperation: Uint8Array) => b58cEncode("o", blake2b256(signedOperation));
export const ZERO_SIGNATURE = b58cEncode("sig", new Uint8Array(64));

/* ------------------------------------------------------------------ small helpers */

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function isHex(s: string): boolean {
  return s.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(s);
}

export function fromHex(s: string): Uint8Array {
  const h = s.startsWith("0x") ? s.slice(2) : s;
  if (!isHex(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  let v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  v %= base;
  const frac = decimals > 0 ? v.toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${out}` : out;
}

export function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return hex(b);
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** Printable UTF-8 text, or null. */
export function textOf(bytes: Uint8Array): string | null {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

export const isUint = (s: unknown): s is string => typeof s === "string" && /^\d+$/.test(s);
