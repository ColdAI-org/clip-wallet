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

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 || !/^[0-9a-f]*$/i.test(s)) throw new Error("bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
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
  if (address.length <= 14) return address;
  return `${address.slice(0, address.startsWith("0x") ? 6 : 4)}…${address.slice(-4)}`;
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

/** Small bounded cache for prepare→finalize state keyed by request id. */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly cap = 64) {
    super();
  }
  override set(key: K, value: V): this {
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    while (this.size > this.cap) this.delete(this.keys().next().value as K);
    return this;
  }
}
