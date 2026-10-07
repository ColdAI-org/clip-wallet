export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Standard or URL-safe base64, padding optional. Throws on anything else. */
export function b64decode(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("not base64");
  const s = atob(clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), "="));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Uint8Array {
  const clean = h.replace(/^0x/, "");
  if (clean.length % 2 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error("not hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
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

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
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

/** "0.025" → { num: 25n, den: 1000n } (gas prices are decimals). */
export function parseDecimal(s: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`bad decimal: ${s}`);
  const frac = m[2] ?? "";
  return { num: BigInt(m[1]! + frac), den: 10n ** BigInt(frac.length) };
}

/** ceil(a * num / den) */
export function mulCeil(a: bigint, num: bigint, den: bigint): bigint {
  return (a * num + den - 1n) / den;
}

export function short(address: string): string {
  return address.length > 14 ? `${address.slice(0, address.indexOf("1") + 5)}…${address.slice(-4)}` : address;
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

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
