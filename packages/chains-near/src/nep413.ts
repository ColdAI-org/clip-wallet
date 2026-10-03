/**
 * NEP-413 signMessage (github.com/near/NEPs/blob/master/neps/nep-0413.md, Final):
 *
 *   hash = sha256( borsh(u32 2^31 + 413) || borsh(Payload { message: string, nonce: [u8; 32], recipient: string,
 *                                                         callbackUrl: Option<string> }) )
 *
 * and the ed25519 signature covers that 32-byte hash. Field order matches near-api-js `Nep413MessageSchema` and
 * wallet-selector `payloadSchema` (which prefix the tag the same way). The tag makes the bytes an impossible
 * transaction (a signer id length of over 2 GB).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concat } from "./util.js";

export const NEP413_TAG = 2 ** 31 + 413; // 2147484061

export interface Nep413Params {
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callbackUrl?: string | null;
}

function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function str(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  return concat(u32(b.length), b);
}

/** The borsh bytes that get hashed (tag included). */
export function nep413Payload(p: Nep413Params): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const cb = p.callbackUrl ? concat(Uint8Array.of(1), str(p.callbackUrl)) : Uint8Array.of(0);
  return concat(u32(NEP413_TAG), str(p.message), p.nonce, str(p.recipient), cb);
}

/** What the vault signs. */
export function nep413Hash(p: Nep413Params): Uint8Array {
  return sha256(nep413Payload(p));
}
