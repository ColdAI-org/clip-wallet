import { MuxedAccount, StrKey } from "@stellar/stellar-base";

export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64decode(text: string): Uint8Array {
  const s = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
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

/** "10.5" (7-decimal Stellar amount string) → stroops. */
export function toStroops(amount: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{0,7}))?$/.exec(amount.trim());
  if (!m) throw new Error(`bad amount: ${amount}`);
  const v = BigInt(m[2]!) * 10_000_000n + BigInt((m[3] ?? "").padEnd(7, "0") || "0");
  return m[1] ? -v : v;
}

/** Stroops → the 7-decimal string stellar-base's Operation builders take. */
export function fromStroops(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / 10_000_000n}.${(a % 10_000_000n).toString().padStart(7, "0")}`;
}

export function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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

/** G… for a G… or M… (muxed) address; null for anything else. */
export function baseAccount(address: string): string | null {
  if (StrKey.isValidEd25519PublicKey(address)) return address;
  if (StrKey.isValidMed25519PublicKey(address)) {
    try {
      return MuxedAccount.fromAddress(address, "0").baseAccount().accountId();
    } catch {
      return null;
    }
  }
  return null;
}

export function isContract(address: string): boolean {
  return StrKey.isValidContract(address);
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function asBytes(b: Uint8Array | ArrayLike<number>): Uint8Array {
  return b instanceof Uint8Array && b.constructor === Uint8Array ? b : Uint8Array.from(b as ArrayLike<number>);
}
