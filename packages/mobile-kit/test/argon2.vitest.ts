/**
 * Argon2id on React Native. Hermes has no global WebAssembly (facebook/hermes#429), so the vault's default
 * (hash-wasm) throws there; the app injects react-native-argon2 (native) or @noble's pure-JS Argon2id.
 * This runs in Node with WebAssembly removed to reproduce Hermes, and with a stand-in for the native module
 * that checks the exact arguments the app passes (hex salt, KiB memory, argon2id mode).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { argon2id as nobleArgon2id } from "@noble/hashes/argon2.js";

const native = { RNArgon2: undefined as undefined | { argon2: (...a: unknown[]) => Promise<{ rawHash: string; encodedHash: string }> } };
vi.mock("react-native", () => ({ NativeModules: native }));

const { jsArgon2id, nativeArgon2id, pickArgon2id, selfTest } = await import("../src/background/argon2");

describe("Argon2id without WebAssembly (as on Hermes)", () => {
  let saved: unknown;
  beforeEach(() => {
    saved = (globalThis as { WebAssembly?: unknown }).WebAssembly;
    delete (globalThis as { WebAssembly?: unknown }).WebAssembly;
  });
  afterEach(() => {
    (globalThis as { WebAssembly?: unknown }).WebAssembly = saved;
    native.RNArgon2 = undefined;
  });

  it("the pure-JS fallback matches the reference vectors", async () => {
    expect(await selfTest(jsArgon2id)).toBe(true);
  });

  it("the native module is called with a hex salt and KiB memory, and matches the vectors", async () => {
    const calls: unknown[][] = [];
    native.RNArgon2 = {
      argon2: async (...args: unknown[]) => {
        calls.push(args);
        const [password, saltHex, o] = args as [string, string, { iterations: number; memory: number; parallelism: number; hashLength: number; mode: string; saltEncoding: string }];
        expect(o.mode).toBe("argon2id");
        expect(o.saltEncoding).toBe("hex");
        const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
        const out = nobleArgon2id(password, salt, { m: o.memory, t: o.iterations, p: o.parallelism, dkLen: o.hashLength });
        return { rawHash: Buffer.from(out).toString("hex"), encodedHash: "" };
      },
    };
    expect(pickArgon2id().kind).toBe("native");
    expect(await selfTest(nativeArgon2id)).toBe(true);
    expect(calls[0]![1]).toBe("000102030405060708090a0b0c0d0e0f");
    expect((calls[0]![2] as { memory: number }).memory).toBe(256);
  });

  it("falls back to JS when the native module is missing (Expo Go)", () => {
    expect(pickArgon2id().kind).toBe("js");
  });

  it("a broken implementation fails the self-test", async () => {
    expect(await selfTest(async () => new Uint8Array(32))).toBe(false);
  });
});
