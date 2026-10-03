/**
 * JSON-safe forms for handing signing data between an extension's background and the page that drives
 * the device (chrome.runtime messages are JSON: a Uint8Array would arrive as a plain object).
 * Public data only: payloads, accounts, signatures.
 */
import type { Signature, SignatureScheme } from "@clip-wallet/core";
import { fromHex, toHex } from "./bytes.js";

const U8 = "$u8";
const BIG = "$big";

/** Uint8Array → { $u8: hex }, bigint → { $big: decimal }, recursively. */
export function toWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return { [U8]: toHex(v) };
  if (typeof v === "bigint") return { [BIG]: v.toString() };
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = toWire(x);
    return out;
  }
  return v;
}

/** Inverse of toWire. */
export function fromWire<T>(v: unknown): T {
  return revive(v) as T;
}

function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && typeof o[U8] === "string") return fromHex(o[U8] as string);
    if (keys.length === 1 && typeof o[BIG] === "string") return BigInt(o[BIG] as string);
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = revive(o[k]);
    return out;
  }
  return v;
}

export interface SignatureWire {
  scheme: SignatureScheme;
  /** hex */
  bytes: string;
  recovery?: number;
  publicKey: string;
}

export const signatureToWire = (s: Signature): SignatureWire => ({
  scheme: s.scheme,
  bytes: toHex(s.bytes),
  ...(s.recovery === undefined ? {} : { recovery: s.recovery }),
  publicKey: s.publicKey,
});

export const signatureFromWire = (w: SignatureWire): Signature => ({
  scheme: w.scheme,
  bytes: fromHex(w.bytes),
  ...(w.recovery === undefined ? {} : { recovery: w.recovery }),
  publicKey: w.publicKey,
});
