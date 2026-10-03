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
  if (h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function formatUnits(value: bigint, decimals: number, maxFraction?: number): string {
  const neg = value < 0n;
  let v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  v %= base;
  let frac = decimals > 0 ? v.toString().padStart(decimals, "0") : "";
  if (maxFraction !== undefined && frac.length > maxFraction) {
    const cut = frac.slice(0, maxFraction).replace(/0+$/, "");
    // Never round a non-zero amount down to "0".
    if (!cut && whole === 0n && v > 0n) return `${neg ? "-" : ""}<0.${"0".repeat(Math.max(0, maxFraction - 1))}1`;
    frac = cut;
  }
  frac = frac.replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${out}` : out;
}

export function short(address: string): string {
  return address.length > 20 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
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

/** Integer from a JSON value: decimal string ("5", "5n"), safe integer number or bigint. */
export function toBigInt(x: unknown, what: string): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  if (typeof x === "string" && /^\d+n?$/.test(x.trim())) return BigInt(x.trim().replace(/n$/, ""));
  throw new Error(`bad ${what}`);
}

/**
 * Bytes from the shapes JSON gives them: Uint8Array, number[], a Node Buffer JSON ({type:"Buffer",data}),
 * a JSON-serialised Uint8Array ({"0":1,"1":2,...}) or base64.
 */
export function toBytes(x: unknown, what = "data"): Uint8Array {
  if (x instanceof Uint8Array) return x;
  const isByte = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 256;
  if (Array.isArray(x) && x.every(isByte)) return Uint8Array.from(x as number[]);
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (o.type === "Buffer" && Array.isArray(o.data) && o.data.every(isByte)) return Uint8Array.from(o.data as number[]);
    const keys = Object.keys(o);
    if (keys.length && keys.every((k, i) => k === String(i)) && keys.every((k) => isByte(o[k]))) return Uint8Array.from(keys.map((k) => o[k] as number));
  }
  if (typeof x === "string") {
    if (!/^[A-Za-z0-9+/=_-\s]*$/.test(x)) throw new Error(`bad ${what}`);
    return b64decode(x.replace(/-/g, "+").replace(/_/g, "/"));
  }
  throw new Error(`bad ${what}`);
}

/** How the bytes came in, so a result can go back in the same shape (WalletConnect). */
export function bytesShape(x: unknown): "buffer" | "array" {
  return x && typeof x === "object" && (x as { type?: unknown }).type === "Buffer" ? "buffer" : "array";
}

export function shapeBytes(bytes: Uint8Array, shape: "buffer" | "array"): unknown {
  return shape === "buffer" ? { type: "Buffer", data: [...bytes] } : [...bytes];
}
