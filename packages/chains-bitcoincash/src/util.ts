import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const clean = h.trim().replace(/^0x/i, "");
  if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error("bad hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const isHex = (s: unknown): s is string => typeof s === "string" && /^(0x)?([0-9a-f]{2})*$/i.test(s.trim()) && s.trim().replace(/^0x/i, "").length > 0;

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));
export const sha256d = (b: Uint8Array): Uint8Array => sha256(sha256(b));

/** Little-endian unsigned integer of `size` bytes. */
export function uintLE(value: bigint | number, size: number): Uint8Array {
  let v = BigInt(value);
  if (v < 0n || v >= 1n << BigInt(size * 8)) throw new Error("integer out of range");
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Bitcoin CompactSize. */
export function compactSize(n: number | bigint): Uint8Array {
  const v = BigInt(n);
  if (v < 0xfdn) return new Uint8Array([Number(v)]);
  if (v <= 0xffffn) return concat(new Uint8Array([0xfd]), uintLE(v, 2));
  if (v <= 0xffffffffn) return concat(new Uint8Array([0xfe]), uintLE(v, 4));
  return concat(new Uint8Array([0xff]), uintLE(v, 8));
}

/** Sequential little-endian reader; reading past the end throws. */
export class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  get done(): boolean {
    return this.at >= this.bytes.length;
  }
  read(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.bytes.length) throw new Error("unexpected end of data");
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  u8(): number {
    return this.read(1)[0]!;
  }
  uintLE(n: number): bigint {
    const b = this.read(n);
    let v = 0n;
    for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
    return v;
  }
  u32(): number {
    return Number(this.uintLE(4));
  }
  u64(): bigint {
    return this.uintLE(8);
  }
  compact(): bigint {
    const f = this.u8();
    if (f < 0xfd) return BigInt(f);
    const v = this.uintLE(f === 0xfd ? 2 : f === 0xfe ? 4 : 8);
    // minimal encoding only
    if ((f === 0xfd && v < 0xfdn) || (f === 0xfe && v <= 0xffffn) || (f === 0xff && v <= 0xffffffffn)) throw new Error("non-minimal CompactSize");
    return v;
  }
}

export const reversed = (b: Uint8Array): Uint8Array => b.slice().reverse();

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

/** "bitcoincash:qpm2…4uvf" → "qpm2qs…uvf"-style short form (no prefix). */
export function short(address: string): string {
  const a = address.includes(":") ? address.slice(address.indexOf(":") + 1) : address;
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

export function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return hex(b);
}

/** Printable text, or null when the bytes aren't readable UTF-8. */
export function textOf(bytes: Uint8Array): string | null {
  if (!bytes.length) return "";
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

/** A BigInt from a number, decimal string or bigint. */
export function toBig(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
