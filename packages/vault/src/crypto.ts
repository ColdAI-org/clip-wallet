/**
 * Encryption at rest: Argon2id (hash-wasm) -> KEK; XChaCha20-Poly1305 (@noble/ciphers) for every sealed box.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromB64, randomBytes, toB64, utf8 } from "./bytes.js";
import { hashWasmArgon2id, type Argon2idFn } from "./kdf.js";

export interface Argon2Params {
  /** Memory in KiB. */
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/**
 * Defaults for a browser extension (see README "Encryption at rest"): 64 MiB, t=3, p=1.
 * RFC 9106 §4 "second recommended option" uses 64 MiB / t=3 / p=4; hash-wasm is single-threaded,
 * so p=1 costs the same wall-clock while giving an attacker no parallelism discount. ~0.5-1.5 s on laptops.
 */
export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 };

/** Refuse absurd stored parameters (a tampered blob must not be able to hang or OOM the extension). */
const MAX_MEMORY_KiB = 1024 * 1024;
const MAX_ITERATIONS = 64;

export interface KdfRecord extends Argon2Params {
  alg: "argon2id";
  salt: string;
}

export function newKdfRecord(params: Argon2Params): KdfRecord {
  return { alg: "argon2id", salt: toB64(randomBytes(16)), ...params };
}

/** `impl` defaults to hash-wasm; see kdf.ts for injecting a native Argon2id. */
export async function deriveKek(password: string, kdf: KdfRecord, impl: Argon2idFn = hashWasmArgon2id): Promise<Uint8Array> {
  if (kdf.alg !== "argon2id") throw new Error("unsupported kdf");
  if (
    kdf.memoryKiB < 8 * kdf.parallelism ||
    kdf.memoryKiB > MAX_MEMORY_KiB ||
    kdf.iterations < 1 ||
    kdf.iterations > MAX_ITERATIONS ||
    kdf.parallelism < 1 ||
    kdf.parallelism > 4
  )
    throw new Error("argon2 parameters out of range");
  const out = await impl({
    password: password.normalize("NFKC"),
    salt: fromB64(kdf.salt),
    memoryKiB: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
  });
  if (!(out instanceof Uint8Array) || out.length !== 32) throw new Error("argon2id returned the wrong length");
  return out;
}

export interface SealedBox {
  nonce: string;
  ct: string;
}

export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): SealedBox {
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce, utf8(aad)).encrypt(plaintext);
  return { nonce: toB64(nonce), ct: toB64(ct) };
}

/** Throws on authentication failure (wrong key, tampered data, or wrong AAD). */
export function open(key: Uint8Array, box: SealedBox, aad: string): Uint8Array {
  return xchacha20poly1305(key, fromB64(box.nonce), utf8(aad)).decrypt(fromB64(box.ct));
}

/** HKDF-SHA256 with explicit domain separation. */
export function hkdf32(ikm: Uint8Array, salt: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, ikm, salt, utf8(info), 32);
}
