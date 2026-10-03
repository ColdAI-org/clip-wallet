/**
 * Injectable Argon2id (additive, Phase 2 mobile). The vault's default stays hash-wasm (WebAssembly),
 * which browsers and Node run. Environments without WebAssembly (React Native's Hermes engine) pass a
 * native implementation through `ClipVaultOptions.argon2id`. Every implementation MUST compute plain
 * Argon2id v1.3 (RFC 9106) over the UTF-8 bytes of `password` with the given salt and costs, returning
 * exactly `hashLength` raw bytes, so a vault written on one platform opens on every other.
 *
 * The record format, parameters and defaults (DEFAULT_ARGON2) do not change.
 */
import { argon2id } from "hash-wasm";
import { utf8 } from "./bytes.js";

export interface Argon2idInput {
  /** Already NFKC-normalised by the vault. Implementations hash its UTF-8 bytes. */
  password: string;
  salt: Uint8Array;
  /** Memory in KiB. */
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  /** Output length in bytes (the vault asks for 32). */
  hashLength: number;
}

export type Argon2idFn = (input: Argon2idInput) => Promise<Uint8Array>;

/** Default: hash-wasm (WebAssembly). */
export const hashWasmArgon2id: Argon2idFn = (i) =>
  argon2id({
    password: utf8(i.password),
    salt: i.salt,
    memorySize: i.memoryKiB,
    iterations: i.iterations,
    parallelism: i.parallelism,
    hashLength: i.hashLength,
    outputType: "binary",
  });
