import { sha256 } from "@noble/hashes/sha2.js";
import { concat, fromHex, utf8 } from "./util.js";

/**
 * Message signing, as fuels-ts `hashMessage` (@fuel-ts/hasher hasher.ts, v0.103):
 *  - a plain string: SHA-256 of its UTF-8 bytes (no prefix);
 *  - `{ personalSign }`: SHA-256 of "\x19Fuel Signed Message:\n" + decimal length + the message bytes (EIP-191 style);
 *    a string `personalSign` is UTF-8 text, bytes are taken as they are.
 * The signature is fuels-ts `Signer.sign`'s: r ‖ s (64 bytes) with the recovery id in the top bit of s.
 *
 * On the wire (1Mask and DappRequest params), the message is one of:
 *   { text: string }                 a HashableMessage string
 *   { personalSign: string }         { personalSign: string }
 *   { personalSignHex: "0x…" }       { personalSign: Uint8Array } (JSON can't carry bytes)
 */
export type FuelMessage = { text: string } | { personalSign: string } | { personalSignHex: string };

export const MESSAGE_PREFIX = "\x19Fuel Signed Message:\n";

export function messageBytes(m: FuelMessage): Uint8Array {
  if ("text" in m) return utf8(m.text);
  if ("personalSign" in m) return utf8(m.personalSign);
  return fromHex(m.personalSignHex);
}

export function hashMessage(m: FuelMessage): Uint8Array {
  const bytes = messageBytes(m);
  if ("text" in m) return sha256(bytes);
  return sha256(concat(utf8(MESSAGE_PREFIX), utf8(String(bytes.length)), bytes));
}

/** Reads the wire form, or a fuels-ts HashableMessage passed straight through (a string or `{ personalSign }`). */
export function fuelMessageOf(v: unknown): FuelMessage | null {
  if (typeof v === "string") return { text: v };
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text === "string") return { text: o.text };
  if (typeof o.personalSign === "string") return { personalSign: o.personalSign };
  if (typeof o.personalSignHex === "string" && /^0x([0-9a-fA-F]{2})*$/.test(o.personalSignHex)) return { personalSignHex: o.personalSignHex };
  return null;
}
