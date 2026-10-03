export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error("invalid hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Felt (or any non-negative integer) as 32 big-endian bytes. */
export function feltToBytes32(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 256n) throw new Error("value out of range");
  return fromHex(v.toString(16).padStart(64, "0"));
}

export function bytesToBigInt(b: Uint8Array): bigint {
  return b.length ? BigInt(`0x${hex(b)}`) : 0n;
}

export function toHexFelt(v: bigint | number | string): string {
  return `0x${BigInt(v).toString(16)}`;
}

/** 0x + 64 lowercase hex digits (Starknet's padded address form). */
export function padAddress(v: bigint | string): string {
  return `0x${BigInt(v).toString(16).padStart(64, "0")}`;
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
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
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

export function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
