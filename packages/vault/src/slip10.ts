/**
 * SLIP-10 for ed25519 (https://github.com/satoshilabs/slips/blob/master/slip-0010.md).
 * ed25519 supports hardened derivation only; any non-hardened segment is rejected.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { concat, utf8, wipe } from "./bytes.js";

export const HARDENED = 0x80000000;

export interface Slip10Node {
  /** 32-byte ed25519 private key (the RFC 8032 seed). */
  privateKey: Uint8Array;
  chainCode: Uint8Array;
}

export function slip10Master(seed: Uint8Array): Slip10Node {
  if (seed.length < 16 || seed.length > 64) throw new Error("seed must be 16..64 bytes");
  const I = hmac(sha512, utf8("ed25519 seed"), seed);
  const node = { privateKey: I.slice(0, 32), chainCode: I.slice(32) };
  wipe(I);
  return node;
}

export function slip10Child(parent: Slip10Node, index: number): Slip10Node {
  if (!Number.isInteger(index) || index < HARDENED || index > 0xffffffff)
    throw new Error("ed25519 SLIP-10 supports hardened indices only");
  const data = concat(new Uint8Array([0]), parent.privateKey, ser32(index));
  const I = hmac(sha512, parent.chainCode, data);
  const node = { privateKey: I.slice(0, 32), chainCode: I.slice(32) };
  wipe(I, data);
  return node;
}

/** Parses "m/44'/501'/0'/0'" (also accepts "h"/"H"). Every segment must be hardened. */
export function parseHardenedPath(path: string): number[] {
  const parts = path.split("/");
  if (parts[0] !== "m") throw new Error(`bad path: ${path}`);
  return parts.slice(1).map((p) => {
    const m = /^(\d+)['hH]$/.exec(p);
    if (!m) throw new Error(`ed25519 path segments must be hardened: ${path}`);
    const n = Number(m[1]);
    if (n >= HARDENED) throw new Error(`index out of range: ${p}`);
    return n + HARDENED;
  });
}

export function slip10Derive(seed: Uint8Array, path: string): Slip10Node {
  let node = slip10Master(seed);
  for (const i of parseHardenedPath(path)) {
    const next = slip10Child(node, i);
    wipe(node.privateKey, node.chainCode);
    node = next;
  }
  return node;
}

/** SLIP-10 serialises ed25519 public keys as 0x00 || 32-byte key. */
export function slip10PublicKey(privateKey: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0]), ed25519.getPublicKey(privateKey));
}

function ser32(i: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, i >>> 0, false);
  return b;
}
