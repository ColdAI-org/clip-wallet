/**
 * The install path on platforms without WebCrypto, DecompressionStream or a strict TextDecoder (React Native /
 * Hermes): hashes come from @noble/hashes, gunzip is injected (NpmOptions.gunzip), and UTF-8 is checked by
 * re-encoding when `fatal` isn't supported (the fast-text-encoding polyfill refuses it).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { decodeUtf8Strict, prepareInstallFromNpm, sha256Hex } from "../src/npm.js";
import { exampleManifest, exampleSource, fakeRegistry, sri, tgz } from "./helpers.js";

const NAME = "clip-plugin-address-label";
const pkg = () =>
  tgz({
    "package/package.json": JSON.stringify({ name: NAME, version: "1.0.0" }),
    "package/clip.plugin.json": JSON.stringify(exampleManifest()),
    "package/dist/bundle.js": exampleSource(),
  });

afterEach(() => vi.unstubAllGlobals());

describe("portable install", () => {
  it("sha256Hex matches Node's crypto without crypto.subtle", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(await sha256Hex("hello")).toBe(createHash("sha256").update("hello").digest("hex"));
  });

  it("installs with an injected gunzip when DecompressionStream is missing, and refuses without one", async () => {
    const tar = pkg();
    vi.stubGlobal("DecompressionStream", undefined);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const calls: number[] = [];
    const reg = fakeRegistry(NAME, "1.0.0", tar);
    const p = await prepareInstallFromNpm(NAME, { fetch: reg.f, gunzip: (b, max) => (calls.push(max), new Uint8Array(gunzipSync(b))) });
    expect(p).toMatchObject({ id: NAME, version: "1.0.0", integrity: sri(tar) });
    expect(calls).toEqual([20_000_000]);
    await expect(prepareInstallFromNpm(NAME, { fetch: fakeRegistry(NAME, "1.0.0", tar).f })).rejects.toMatchObject({ code: "bad-package" });
  });

  it("strict UTF-8 without TextDecoder's fatal option", () => {
    const Real = TextDecoder;
    vi.stubGlobal(
      "TextDecoder",
      class extends Real {
        constructor(label?: string, opts?: TextDecoderOptions) {
          if (opts?.fatal) throw new RangeError("Failed to construct 'TextDecoder': the 'fatal' option is unsupported.");
          super(label);
        }
      },
    );
    expect(decodeUtf8Strict(new TextEncoder().encode("héllo ✓"))).toBe("héllo ✓");
    expect(() => decodeUtf8Strict(new Uint8Array([0x68, 0xff, 0x69]))).toThrow();
    // A real U+FFFD in the input is fine.
    expect(decodeUtf8Strict(new TextEncoder().encode("a�b"))).toBe("a�b");
  });
});
