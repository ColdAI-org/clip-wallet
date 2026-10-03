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

export function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
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

/** Accepts Uint8Array, number[], a Node Buffer JSON ({type:"Buffer",data}) or base64. */
export function toBytes(x: unknown, what = "data"): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (Array.isArray(x) && x.every((n) => Number.isInteger(n) && n >= 0 && n < 256)) return Uint8Array.from(x as number[]);
  if (x && typeof x === "object" && (x as { type?: unknown }).type === "Buffer" && Array.isArray((x as { data?: unknown }).data)) {
    return Uint8Array.from((x as { data: number[] }).data);
  }
  if (typeof x === "string") return b64decode(x);
  throw new Error(`bad ${what}`);
}
