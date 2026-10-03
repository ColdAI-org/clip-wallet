import { ClipError } from "@clip-wallet/core";

/** Base units → "1,234.5" (no grouping beyond what toLocaleString gives, max `maxFraction` decimals). */
export function formatUnits(amount: string | bigint, decimals: number, maxFraction = 6): string {
  let v = BigInt(amount);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (!frac && whole === 0n && v > 0n) {
    // Tiny amounts: show the first significant digits instead of "0".
    const full = (v % base).toString().padStart(decimals, "0");
    const firstNonZero = full.search(/[1-9]/);
    frac = full.slice(0, Math.min(decimals, firstNonZero + 2)).replace(/0+$/, "");
  }
  const w = whole.toLocaleString("en-US");
  return `${neg ? "-" : ""}${w}${frac ? `.${frac}` : ""}`;
}

/** "25.5" → base units. Throws a plain error on bad input. */
export function parseUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new ClipError("Enter an amount like 25 or 0.5.", "features/bad-amount");
  const [w = "0", f = ""] = v.split(".");
  if (f.length > decimals) throw new ClipError("That amount has too many decimal places.", "features/precision");
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function shortAddress(a: string): string {
  return a.length > 14 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

export function percent(n: number, digits = 2): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: digits })}%`;
}

export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function bytesToB64(b: Uint8Array): string {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

export function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 0.0.N → long-zero EVM address (lowercase, 0x + 40 hex). */
export function longZero(entityId: string): `0x${string}` {
  const m = /^0\.0\.(\d+)$/.exec(entityId.trim());
  if (!m) throw new Error(`not an entity id: ${entityId}`);
  return `0x${BigInt(m[1]!).toString(16).padStart(40, "0")}`;
}

/** Long-zero EVM address → 0.0.N, or null for a non-long-zero address. */
export function fromLongZero(addr: string): string | null {
  const h = addr.toLowerCase().replace(/^0x/, "");
  if (h.length !== 40 || !/^0{24}/.test(h)) return null;
  return `0.0.${BigInt(`0x${h}`).toString()}`;
}
