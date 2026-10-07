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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

/**
 * A decimal string as XRPL JSON writes it ("1.5", "-0.25", "1e-7", "1234567890123456e-3") → base units with
 * `decimals` places, truncated toward zero (never rounds up what someone holds).
 */
export function decimalToUnits(value: string, decimals: number): bigint {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!m || (!m[2] && !m[3])) throw new Error(`not a number: ${value}`);
  const neg = m[1] === "-";
  const digits = `${m[2] ?? ""}${m[3] ?? ""}`.replace(/^0+(?=\d)/, "") || "0";
  const exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0) + decimals;
  let n = BigInt(digits);
  if (exp >= 0) n *= 10n ** BigInt(exp);
  else n /= 10n ** BigInt(-exp);
  return neg ? -n : n;
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

/** Printable UTF-8 text of hex bytes, or null. */
export function textOfHex(h: string | undefined): string | null {
  if (!h || !/^([0-9a-f]{2})+$/i.test(h)) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(fromHex(h));
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
