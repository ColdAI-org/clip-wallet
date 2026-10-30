/** Core's text helpers (withoutTrailing, includesInOrder) and the features code that uses them. */
import { includesInOrder, withoutTrailing } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { encodeOffer, decodeOffer, type OfferPayload } from "../src/trade/offer.js";
import { b64urlDecode, b64urlEncode } from "../src/util.js";

const LONG = 100_000;
const LS = String.fromCharCode(0x2028);

/** Runs `f` and checks it took well under a second: these are linear scans, so even very long inputs are quick. */
function quick<T>(f: () => T): T {
  const t0 = performance.now();
  const out = f();
  expect(performance.now() - t0).toBeLessThan(1000);
  return out;
}

describe("withoutTrailing", () => {
  it("drops the run of the given characters at the end, and nothing else", () => {
    expect(withoutTrailing("https://a.example///", "/")).toBe("https://a.example");
    expect(withoutTrailing("https://a.example/x", "/")).toBe("https://a.example/x");
    expect(withoutTrailing("https://a.example/x/", "/")).toBe("https://a.example/x");
    expect(withoutTrailing("///", "/")).toBe("");
    expect(withoutTrailing("", "/")).toBe("");
    expect(withoutTrailing("YQ==", "=")).toBe("YQ");
    expect(withoutTrailing("https://a.example/trade?#?#", "#?")).toBe("https://a.example/trade");
    expect(withoutTrailing("name\0\0\0", "\0")).toBe("name");
  });

  it("is linear on a long run that stops short of the end", () => {
    const slashes = `${"/".repeat(LONG)}x`;
    expect(quick(() => withoutTrailing(slashes, "/"))).toBe(slashes);
    const pad = `${"=".repeat(LONG)}x`;
    expect(quick(() => withoutTrailing(pad, "="))).toBe(pad);
    expect(quick(() => withoutTrailing(`x${"/".repeat(LONG)}`, "/"))).toBe("x");
  });
});

describe("includesInOrder", () => {
  it("finds the parts in order on one line, ignoring case", () => {
    expect(includesInOrder("Access key ed25519:abc does not exist while viewing", "access key ", " does not exist")).toBe(true);
    expect(includesInOrder("access key  does not exist", "access key ", " does not exist")).toBe(true);
    expect(includesInOrder("does not exist: access key x", "access key ", " does not exist")).toBe(false);
    expect(includesInOrder("resource bounds exceed the balance", "resource bounds", "exceed", "balance")).toBe(true);
    expect(includesInOrder("resource bounds: balance exceeded", "resource bounds", "exceed", "balance")).toBe(false);
    expect(includesInOrder("group mismatch", "group ", " mismatch")).toBe(false);
  });

  it("never matches across a line break", () => {
    expect(includesInOrder("access key x\nwhich does not exist", "access key ", " does not exist")).toBe(false);
    expect(includesInOrder("access key x\r does not exist", "access key ", " does not exist")).toBe(false);
    expect(includesInOrder(`access key x${LS} does not exist`, "access key ", " does not exist")).toBe(false);
    expect(includesInOrder("first line\naccess key x does not exist", "access key ", " does not exist")).toBe(true);
  });

  it("is linear on long text that almost matches", () => {
    const s = "access key ".repeat(LONG / 10);
    expect(quick(() => includesInOrder(s, "access key ", " does not exist"))).toBe(false);
    expect(quick(() => includesInOrder(`${s} does not exist`, "access key ", " does not exist"))).toBe(true);
  });
});

describe("features encoders", () => {
  it("b64urlEncode matches unpadded base64url and round-trips", () => {
    for (const s of ["", "a", "ab", "abc", "???", "?>>", "wörld ✓"]) {
      expect(b64urlEncode(s)).toBe(Buffer.from(s, "utf8").toString("base64url"));
      expect(b64urlDecode(b64urlEncode(s))).toBe(s);
    }
  });

  it("encodeOffer drops trailing # and ? from the link base", () => {
    const p: OfferPayload = {
      v: 1, n: "hedera:testnet", mode: "scheduled", maker: "0.0.2002", taker: "0.0.1001",
      give: { kind: "asset", assetKey: "hbar", symbol: "HBAR", decimals: 8, amount: "100" },
      get: { kind: "asset", assetKey: "hbar", symbol: "HBAR", decimals: 8, amount: "200" },
      schedule: "0.0.7777", expiresAt: 2_000_000_000_000,
    };
    const link = encodeOffer("https://clipwallet.example/trade?#", p);
    expect(link.startsWith("https://clipwallet.example/trade#offer=")).toBe(true);
    expect(decodeOffer(link)).toEqual(p);
  });
});
