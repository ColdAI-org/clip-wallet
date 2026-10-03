/**
 * The injectable Argon2id seam (src/kdf.ts). A vault written with one implementation must open with any
 * other: every implementation is plain Argon2id over the NFKC-normalised password's UTF-8 bytes.
 */
import { describe, expect, it } from "vitest";
import { argon2id as nobleArgon2id } from "@noble/hashes/argon2.js";
import { ClipVault, MemoryStorage, hashWasmArgon2id, type Argon2idFn, type Argon2idInput } from "../src/index.js";
import { toHex } from "../src/bytes.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = `${"abandon ".repeat(11)}about`;
const PW = "correct horse battery staple";
const FAST = { memoryKiB: 256, iterations: 1, parallelism: 1 };
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);

/** Cross-implementation vectors (hash-wasm == @noble/hashes); native ports check themselves against these. */
export const ARGON2ID_VECTORS = [
  { password: PW, out: "7989cae79eab72e4e4f4124a6acde0796b3cb91920807721145cf29a5a1daaa6" },
  { password: "pässwörd", out: "fc4863b1f2f5e0bce74d6427612c6fcd2050998dfbca770d6912b086f582c7f2" },
];

const noble: Argon2idFn = async (i) =>
  nobleArgon2id(i.password, i.salt, { m: i.memoryKiB, t: i.iterations, p: i.parallelism, dkLen: i.hashLength });

describe("injectable argon2id", () => {
  it("default implementation matches the reference vectors", async () => {
    for (const v of ARGON2ID_VECTORS) {
      const out = await hashWasmArgon2id({ password: v.password.normalize("NFKC"), salt: SALT, memoryKiB: 256, iterations: 2, parallelism: 1, hashLength: 32 });
      expect(toHex(out)).toBe(v.out);
      expect(toHex(await noble({ password: v.password.normalize("NFKC"), salt: SALT, memoryKiB: 256, iterations: 2, parallelism: 1, hashLength: 32 }))).toBe(v.out);
    }
  });

  it("uses the injected implementation for create, unlock and changePassword", async () => {
    const calls: Argon2idInput[] = [];
    const spy: Argon2idFn = async (i) => {
      calls.push(i);
      return noble(i);
    };
    const storage = new MemoryStorage();
    const v = new ClipVault({ storage, argon2: FAST, argon2id: spy, autoLockMs: 0 });
    await v.importPhrase(ABANDON, PW);
    await v.lock();
    await v.unlock(PW);
    await v.changePassword(PW, `${PW}!`);
    expect(calls.length).toBe(4);
    expect(calls[0]!.memoryKiB).toBe(256);
    expect(calls[0]!.hashLength).toBe(32);
  });

  it("a vault sealed with one implementation opens with the other", async () => {
    const storage = new MemoryStorage();
    const a = new ClipVault({ storage, argon2: FAST, argon2id: noble, autoLockMs: 0 });
    await a.importPhrase(ABANDON, PW);
    const evmA = await a.deriveAccount("evm", 0);
    const b = new ClipVault({ storage, argon2: FAST, autoLockMs: 0 });
    await b.unlock(PW);
    expect((await b.deriveAccount("evm", 0)).address).toBe(evmA.address);
  });

  it("hash-wasm can't run without WebAssembly (React Native's Hermes), which is why the seam exists", async () => {
    const g = globalThis as { WebAssembly?: unknown };
    const saved = g.WebAssembly;
    delete g.WebAssembly;
    try {
      await expect(hashWasmArgon2id({ password: "x", salt: SALT, memoryKiB: 256, iterations: 1, parallelism: 1, hashLength: 32 })).rejects.toThrow(/WebAssembly is not supported/);
      // ...while an injected non-WASM implementation still opens a vault.
      const v = new ClipVault({ storage: new MemoryStorage(), argon2: FAST, argon2id: noble, autoLockMs: 0 });
      await v.importPhrase(ABANDON, PW);
      expect(await v.status()).toBe("unlocked");
    } finally {
      g.WebAssembly = saved;
    }
  });

  it("rejects an implementation that returns the wrong length", async () => {
    const short: Argon2idFn = async () => new Uint8Array(16);
    const v = new ClipVault({ storage: new MemoryStorage(), argon2: FAST, argon2id: short, autoLockMs: 0 });
    await expect(v.importPhrase(ABANDON, PW)).rejects.toThrow();
  });
});
