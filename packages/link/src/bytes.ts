/**
 * Byte helpers and symmetric crypto over DERIVED keys only (link secrets, sync data keys). Nothing here creates,
 * holds or uses a private key: X25519 and Ed25519 run in @clip-wallet/vault (harness rule).
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes as nobleRandom } from "@noble/hashes/utils.js";

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function b64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  if (i < bytes.length) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]!;
  }
  return out;
}

export function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("invalid base64url");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of s) {
    acc = (acc << 6) | B64URL.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
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

/** Constant-time (length-public) equality. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

export function wipe(...bufs: (Uint8Array | undefined | null)[]) {
  for (const b of bufs) b?.fill(0);
}

export const randomBytes = (n: number): Uint8Array => nobleRandom(n);
export { sha256 };

export function hkdf32(ikm: Uint8Array, salt: Uint8Array, info: string, length = 32): Uint8Array {
  return hkdf(sha256, ikm, salt, utf8(info), length);
}

export function hmac256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  return hmac(sha256, key, msg);
}

/** Length-prefixed concatenation for transcripts (no ambiguity between fields). */
export function transcript(...parts: (Uint8Array | string)[]): Uint8Array {
  const bufs = parts.map((p) => (typeof p === "string" ? utf8(p) : p));
  const out: Uint8Array[] = [];
  for (const b of bufs) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, b.length, false);
    out.push(len, b);
  }
  return sha256(concat(...out));
}

/** XChaCha20-Poly1305 with a random 24-byte nonce: nonce ‖ ciphertext. Throws on a wrong key, AAD or tampering. */
export function sealBytes(key: Uint8Array, plaintext: Uint8Array, aad: string): Uint8Array {
  const nonce = randomBytes(24);
  return concat(nonce, xchacha20poly1305(key, nonce, utf8(aad)).encrypt(plaintext));
}

export function openBytes(key: Uint8Array, box: Uint8Array, aad: string): Uint8Array {
  if (box.length < 24 + 16) throw new Error("ciphertext too short");
  return xchacha20poly1305(key, box.subarray(0, 24), utf8(aad)).decrypt(box.subarray(24));
}

export function sealJson(key: Uint8Array, value: unknown, aad: string): string {
  return b64url(sealBytes(key, utf8(JSON.stringify(value)), aad));
}

export function openJson<T = unknown>(key: Uint8Array, box: string, aad: string): T {
  return JSON.parse(fromUtf8(openBytes(key, fromB64url(box), aad))) as T;
}
