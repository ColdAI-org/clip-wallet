import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { base58 } from "@scure/base";

/**
 * Antelope wire primitives (Spring/Leap fc + abieos; https://docs.eosnetwork.com/docs/latest/advanced-topics/
 * transactions-protocol): little-endian integers, LEB128 varuint32, 64-bit names, assets, K1 keys and signatures.
 * Cross-checked against @wharfkit/antelope in test/serializer.test.ts.
 */

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const clean = h.replace(/^0x/, "");
  if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error("bad hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ------------------------------------------------------------------ writer / reader */

export class Writer {
  private chunks: number[] = [];

  byte(b: number): this {
    this.chunks.push(b & 0xff);
    return this;
  }
  bytes(b: Uint8Array): this {
    for (const x of b) this.chunks.push(x);
    return this;
  }
  /** Unsigned little-endian integer of `size` bytes. */
  uint(v: bigint | number, size: number): this {
    let n = BigInt(v);
    if (n < 0n || n >= 1n << BigInt(size * 8)) throw new RangeError("integer out of range");
    for (let i = 0; i < size; i++, n >>= 8n) this.chunks.push(Number(n & 0xffn));
    return this;
  }
  /** Signed little-endian integer (two's complement). */
  int(v: bigint | number, size: number): this {
    const n = BigInt(v);
    const bits = BigInt(size * 8);
    if (n < -(1n << (bits - 1n)) || n >= 1n << (bits - 1n)) throw new RangeError("integer out of range");
    return this.uint(n < 0n ? (1n << bits) + n : n, size);
  }
  varuint32(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError("varuint32 out of range");
    let n = v >>> 0;
    for (;;) {
      if (n >>> 7) {
        this.chunks.push(0x80 | (n & 0x7f));
        n >>>= 7;
      } else {
        this.chunks.push(n);
        return this;
      }
    }
  }
  varint32(v: number): this {
    if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) throw new RangeError("varint32 out of range");
    return this.varuint32(((v << 1) ^ (v >> 31)) >>> 0);
  }
  blob(b: Uint8Array): this {
    return this.varuint32(b.length).bytes(b);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.buf.length) throw new RangeError("read past end");
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  byte(): number {
    return this.bytes(1)[0]!;
  }
  uint(size: number): bigint {
    const b = this.bytes(size);
    let n = 0n;
    for (let i = size - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
    return n;
  }
  int(size: number): bigint {
    const n = this.uint(size);
    const bits = BigInt(size * 8);
    return n >= 1n << (bits - 1n) ? n - (1n << bits) : n;
  }
  varuint32(): number {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (shift > 28) throw new RangeError("varuint32 too long");
      const b = this.byte();
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
      shift += 7;
    }
  }
  varint32(): number {
    const u = this.varuint32();
    return u & 1 ? ~(u >>> 1) : u >>> 1;
  }
  blob(): Uint8Array {
    return this.bytes(this.varuint32());
  }
}

/* ------------------------------------------------------------------ names */

const NAME_CHARS = ".12345abcdefghijklmnopqrstuvwxyz";

/** Account / action / table names (up to 12 chars of [.1-5a-z], a 13th of [.1-5a-j]) as uint64. */
export function nameToBigInt(name: string): bigint {
  if (!isName(name)) throw new Error(`invalid name: ${name}`);
  let v = 0n;
  for (let i = 0; i < 13; i++) {
    const c = i < name.length ? NAME_CHARS.indexOf(name[i]!) : 0;
    if (i < 12) v |= BigInt(c & 0x1f) << BigInt(64 - 5 * (i + 1));
    else v |= BigInt(c & 0x0f);
  }
  return v;
}

export function nameFromBigInt(v: bigint): string {
  let out = "";
  let tmp = v;
  for (let i = 0; i <= 12; i++) {
    const c = i === 0 ? Number(tmp & 0x0fn) : Number(tmp & 0x1fn);
    out = NAME_CHARS[c]! + out;
    tmp >>= i === 0 ? 4n : 5n;
  }
  return out.replace(/\.+$/, "");
}

/** A name the chain would store unchanged (no trailing dots, canonical round trip). */
export function isName(name: string): boolean {
  if (typeof name !== "string" || name.length > 13 || !/^[.1-5a-z]*$/.test(name)) return false;
  if (name.length === 13 && !/[.1-5a-j]$/.test(name)) return false;
  return !name.endsWith(".");
}

/** An account a person can be: 1–12 characters, [a-z1-5.], not ending with ".". */
export function isAccountName(name: string): boolean {
  return /^[a-z1-5.]{1,12}$/.test(name) && !name.endsWith(".") && !name.startsWith(".");
}

/* ------------------------------------------------------------------ symbols and assets */

export interface Sym {
  precision: number;
  code: string;
}

export function symbolToBigInt(s: Sym): bigint {
  if (!/^[A-Z]{1,7}$/.test(s.code) || s.precision < 0 || s.precision > 18) throw new Error(`invalid symbol ${s.precision},${s.code}`);
  let v = BigInt(s.precision);
  for (let i = 0; i < s.code.length; i++) v |= BigInt(s.code.charCodeAt(i)) << BigInt(8 * (i + 1));
  return v;
}

export function symbolFromBigInt(v: bigint): Sym {
  const precision = Number(v & 0xffn);
  let code = "";
  for (let i = 1; i < 8; i++) {
    const c = Number((v >> BigInt(8 * i)) & 0xffn);
    if (!c) break;
    code += String.fromCharCode(c);
  }
  return { precision, code };
}

export interface Asset {
  amount: bigint;
  symbol: Sym;
}

/** "1.2345 EOS" (the precision is the number of decimals written). */
export function parseAsset(text: string): Asset {
  const m = /^(-?)(\d+)(?:\.(\d+))? ([A-Z]{1,7})$/.exec(text.trim());
  if (!m) throw new Error(`invalid asset: ${text}`);
  const frac = m[3] ?? "";
  const amount = BigInt(`${m[2]}${frac}`) * (m[1] ? -1n : 1n);
  return { amount, symbol: { precision: frac.length, code: m[4]! } };
}

export function formatAsset(a: Asset): string {
  const neg = a.amount < 0n;
  const v = neg ? -a.amount : a.amount;
  const p = a.symbol.precision;
  const s = v.toString().padStart(p + 1, "0");
  const num = p ? `${s.slice(0, -p)}.${s.slice(-p)}` : s;
  return `${neg ? "-" : ""}${num} ${a.symbol.code}`;
}

/* ------------------------------------------------------------------ keys and signatures */

const keyCheck = (data: Uint8Array, suffix: string) => ripemd160(concat(data, utf8(suffix))).subarray(0, 4);

/** "PUB_K1_…" or legacy "EOS…"/"PUB…" prefixed K1 key → 33 compressed bytes, checksums verified. */
export function parsePublicKey(text: string): Uint8Array {
  let raw: Uint8Array;
  if (text.startsWith("PUB_K1_")) {
    raw = base58.decode(text.slice(7));
    if (raw.length !== 37 || !bytesEqual(keyCheck(raw.subarray(0, 33), "K1"), raw.subarray(33))) throw new Error("bad PUB_K1 checksum");
  } else {
    const m = /^([A-Z]{2,5})([1-9A-HJ-NP-Za-km-z]{50})$/.exec(text);
    if (!m) throw new Error("not an Antelope public key");
    raw = base58.decode(m[2]!);
    if (raw.length !== 37 || !bytesEqual(ripemd160(raw.subarray(0, 33)).subarray(0, 4), raw.subarray(33))) throw new Error("bad legacy key checksum");
  }
  const key = raw.slice(0, 33);
  secp256k1.Point.fromBytes(key); // must be on the curve
  return key;
}

export function publicKeyString(compressed: Uint8Array): string {
  const key = secp256k1.Point.fromBytes(compressed).toBytes(true);
  return `PUB_K1_${base58.encode(concat(key, keyCheck(key, "K1")))}`;
}

export function isPublicKey(text: string): boolean {
  try {
    parsePublicKey(text);
    return true;
  } catch {
    return false;
  }
}

/** Packed public_key: type byte (0 = K1) ‖ 33 bytes. */
export function packPublicKey(text: string): Uint8Array {
  return concat(new Uint8Array([0]), parsePublicKey(text));
}

/** r ‖ s + recovery id (0/1) → "SIG_K1_…": base58(i ‖ r ‖ s ‖ RIPEMD-160(i ‖ r ‖ s ‖ "K1")[0..4]), i = recid + 31. */
export function signatureString(rs: Uint8Array, recovery: number): string {
  if (rs.length !== 64 || (recovery !== 0 && recovery !== 1)) throw new Error("expected r||s and a recovery id");
  const data = concat(new Uint8Array([recovery + 31]), rs);
  return `SIG_K1_${base58.encode(concat(data, keyCheck(data, "K1")))}`;
}

/** Packed signature: type byte (0 = K1) ‖ 65 bytes. */
export function packSignature(text: string): Uint8Array {
  if (!text.startsWith("SIG_K1_")) throw new Error("only K1 signatures");
  const raw = base58.decode(text.slice(7));
  if (raw.length !== 69 || !bytesEqual(keyCheck(raw.subarray(0, 65), "K1"), raw.subarray(65))) throw new Error("bad SIG_K1 checksum");
  return concat(new Uint8Array([0]), raw.subarray(0, 65));
}

/** Canonical K1 (Spring/Leap fc is_canonical): neither r nor s has its top bit set or a needless zero byte. */
export function isCanonical(rs: Uint8Array): boolean {
  const r = rs.subarray(0, 32);
  const s = rs.subarray(32, 64);
  return !(r[0]! & 0x80) && !(r[0] === 0 && !(r[1]! & 0x80)) && !(s[0]! & 0x80) && !(s[0] === 0 && !(s[1]! & 0x80));
}
