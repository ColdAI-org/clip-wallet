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

/** Big-endian unsigned integer of `size` bytes. */
export function uintBE(value: bigint, size: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(size * 8)) throw new Error("integer out of range");
  const out = new Uint8Array(size);
  let v = value;
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function readUintBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** Sequential reader; every read past the end throws (the caller turns that into "can't read this"). */
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
  u16(): number {
    return Number(readUintBE(this.read(2)));
  }
  u32(): number {
    return Number(readUintBE(this.read(4)));
  }
  u64(): bigint {
    return readUintBE(this.read(8));
  }
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
  return address.length > 14 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
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

/** A BigInt from what SIP-030 allows for integers (number, decimal string, bigint). */
export function toBig(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
