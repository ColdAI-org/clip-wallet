import { bech32 } from "@scure/base";

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const clean = h.replace(/^0x/i, "");
  if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error("bad hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Strict standard base64 (what sdk-core's toPlainObject writes for `data` and usernames). */
export function b64decode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) throw new Error("bad base64");
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The 32-byte public key behind an "erd1…" address (bech32 checksum checked), or null. */
export function decodeAddress(value: string): Uint8Array | null {
  try {
    const { prefix, words } = bech32.decode(value as `${string}1${string}`);
    if (prefix !== "erd") return null;
    const bytes = bech32.fromWords(words);
    return bytes.length === 32 ? Uint8Array.from(bytes) : null;
  } catch {
    return null;
  }
}

export function encodeAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("MultiversX addresses are 32 bytes");
  return bech32.encode("erd", bech32.toWords(publicKey));
}

/** Smart contracts (user-deployed "erd1qqqqqqqqqqqqqpgq…" and system ones) start with 8 zero bytes. */
export function isContractKey(key: Uint8Array): boolean {
  return key.length === 32 && key.subarray(0, 8).every((b) => b === 0);
}

/** System smart contracts (staking, ESDT, governance, delegation manager, staking providers): 00×9 ‖ 01 ‖ … */
export function isSystemContractKey(key: Uint8Array): boolean {
  return isContractKey(key) && key[8] === 0 && key[9] === 1;
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
  return address.length > 14 ? `${address.slice(0, 7)}…${address.slice(-4)}` : address;
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

/** Big-endian unsigned bytes → bigint (empty = 0). */
export function bigFromBytes(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

/** sdk-core's argument encoding of an unsigned number: minimal big-endian hex, even length ("" for 0 is never used: "00"). */
export function numberArg(n: bigint): string {
  if (n < 0n) throw new Error("negative");
  const h = n.toString(16);
  return h.length % 2 ? `0${h}` : h;
}

/** Printable text (no control characters except line breaks/tabs), or null. */
export function textOf(bytes: Uint8Array): string | null {
  if (!bytes.length) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
