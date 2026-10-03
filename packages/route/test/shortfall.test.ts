import type { DecodedRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { findShortfall, needsFromDecoded } from "../src/index.js";
import { ETH_SEPOLIA, HBAR, PORTFOLIO, USDC_BASE, USDC_HEDERA } from "./fixtures.js";

describe("findShortfall", () => {
  it("returns nothing when the user holds enough where it's needed", () => {
    expect(findShortfall([{ asset: HBAR, amount: "50000000" }], PORTFOLIO)).toEqual([]);
  });

  it("reports the missing amount and the same asset on other networks first", () => {
    const [s, ...rest] = findShortfall([{ asset: USDC_HEDERA, amount: "25000000" }], PORTFOLIO);
    expect(rest).toEqual([]);
    expect(s!.have).toBe("0");
    expect(s!.missing).toBe("25000000");
    // Native USDC on Base counts; the bridged copy (different key) does not.
    expect(s!.sameAssetElsewhere.map((b) => b.asset)).toEqual([USDC_BASE]);
    // Other balances exclude zero balances and are sorted by value.
    expect(s!.otherBalances.map((b) => b.asset.symbol)).toEqual(["ETH", "USDC"]);
  });

  it("subtracts what the user already has", () => {
    const [s] = findShortfall([{ asset: HBAR, amount: "300000000" }], PORTFOLIO);
    expect(s!.missing).toBe("200000000");
    expect(s!.have).toBe("100000000");
  });

  it("matches tokens by address case-insensitively", () => {
    const lower = { ...USDC_BASE, address: USDC_BASE.address!.toLowerCase() };
    expect(findShortfall([{ asset: lower, amount: "1" }], PORTFOLIO)).toEqual([]);
  });

  it("reads needs from a decoded request: outflows plus an unsponsored fee", () => {
    const decoded: DecodedRequest = {
      requestId: "r1",
      title: "Pay 3 HBAR",
      lines: [],
      balanceChanges: [
        { asset: HBAR, delta: "-300000000" },
        { asset: ETH_SEPOLIA, delta: "10" },
      ],
      fee: { asset: HBAR, amount: "1000000" },
      simulated: true,
      blind: false,
      warnings: [],
      networkId: "hedera:testnet",
    };
    expect(needsFromDecoded(decoded)).toEqual([{ asset: HBAR, amount: "301000000" }]);
    const [s] = findShortfall(decoded, PORTFOLIO);
    expect(s!.missing).toBe("201000000");
    expect(needsFromDecoded({ ...decoded, fee: { asset: HBAR, amount: "1000000", sponsored: true } })).toEqual([
      { asset: HBAR, amount: "300000000" },
    ]);
  });

  it("rejects amounts that aren't base units, in plain words", () => {
    expect(() => findShortfall([{ asset: HBAR, amount: "1.5" }], PORTFOLIO)).toThrow(/not a whole number/);
  });
});
