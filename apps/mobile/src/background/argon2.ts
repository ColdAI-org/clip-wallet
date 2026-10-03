/**
 * Argon2id for the vault on React Native (injected through ClipVaultOptions.argon2id, see packages/vault/src/kdf.ts).
 *
 * Hermes has no WebAssembly, so the vault's default (hash-wasm) can't run here. Order of preference:
 *   1. react-native-argon2 (Argon2Swift on iOS, argon2kt on Android): native, fast, same parameters.
 *   2. @noble/hashes argon2idAsync: audited pure JS. Correct but slow on Hermes (seconds at 64 MiB); used
 *      only when the native module is missing (e.g. Expo Go) and reported in Settings → About.
 * Both compute plain Argon2id v1.3, so a vault sealed on any platform opens on every other; selfTest()
 * checks the chosen implementation against vectors that hash-wasm and @noble agree on (vault test kdf.test.ts).
 */
import { NativeModules } from "react-native";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import type { Argon2idFn } from "@clip-wallet/vault";

function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

type NativeArgon2 = (
  password: string,
  salt: string,
  options: { iterations: number; memory: number; parallelism: number; hashLength: number; mode: "argon2id"; saltEncoding: "hex" },
) => Promise<{ rawHash: string; encodedHash: string }>;

export function nativeArgon2Available(): boolean {
  return typeof (NativeModules as { RNArgon2?: { argon2?: unknown } }).RNArgon2?.argon2 === "function";
}

/** react-native-argon2: salt passed as hex (v4 `saltEncoding: "hex"`), raw hash returned as hex. */
export const nativeArgon2id: Argon2idFn = async (i) => {
  const native = (NativeModules as { RNArgon2: { argon2: NativeArgon2 } }).RNArgon2.argon2;
  const { rawHash } = await native(i.password, toHex(i.salt), {
    iterations: i.iterations,
    memory: i.memoryKiB,
    parallelism: i.parallelism,
    hashLength: i.hashLength,
    mode: "argon2id",
    saltEncoding: "hex",
  });
  return fromHex(rawHash);
};

/** Pure-JS fallback. asyncTick keeps the UI thread responsive while it grinds. */
export const jsArgon2id: Argon2idFn = (i) =>
  argon2idAsync(i.password, i.salt, { m: i.memoryKiB, t: i.iterations, p: i.parallelism, dkLen: i.hashLength, asyncTick: 10 });

export interface Argon2Choice {
  fn: Argon2idFn;
  kind: "native" | "js";
}

export function pickArgon2id(): Argon2Choice {
  return nativeArgon2Available() ? { fn: nativeArgon2id, kind: "native" } : { fn: jsArgon2id, kind: "js" };
}

/** Cross-implementation vectors (see packages/vault/test/kdf.test.ts): m=256 KiB, t=2, p=1, salt 00..0f. */
const VECTORS = [
  { password: "correct horse battery staple", out: "7989cae79eab72e4e4f4124a6acde0796b3cb91920807721145cf29a5a1daaa6" },
  { password: "pässwörd", out: "fc4863b1f2f5e0bce74d6427612c6fcd2050998dfbca770d6912b086f582c7f2" },
];

/** True when `fn` reproduces the reference outputs (run once at startup; refuse to seal a vault otherwise). */
export async function selfTest(fn: Argon2idFn): Promise<boolean> {
  const salt = Uint8Array.from({ length: 16 }, (_, k) => k);
  for (const v of VECTORS) {
    const out = await fn({ password: v.password.normalize("NFKC"), salt, memoryKiB: 256, iterations: 2, parallelism: 1, hashLength: 32 });
    if (toHex(out) !== v.out) return false;
  }
  return true;
}
