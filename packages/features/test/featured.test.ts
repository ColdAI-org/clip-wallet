import { FAMILIES } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { FEATURED_DAPPS, featuredFor, hostOf, isFeaturedOrigin } from "../src/dapps/featured.js";

describe("featured apps", () => {
  it("every entry is https, its URL's host is its verified domain, and families are real", () => {
    for (const d of FEATURED_DAPPS) {
      expect(d.url.startsWith("https://")).toBe(true);
      expect(hostOf(d.url)).toBe(d.domain);
      expect(FAMILIES).toContain(d.family);
    }
    const domains = FEATURED_DAPPS.map((d) => `${d.family}|${d.domain}`);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("shows only families this build has switched on", () => {
    const list = featuredFor(["hedera", "solana"]);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((d) => d.family === "hedera" || d.family === "solana")).toBe(true);
    expect(list.map((d) => d.name)).toContain("SaucerSwap");
  });

  it("recognises featured origins exactly (no look-alikes)", () => {
    expect(isFeaturedOrigin("https://jup.ag")?.name).toBe("Jupiter");
    expect(isFeaturedOrigin("https://www.saucerswap.finance")?.name).toBe("SaucerSwap");
    expect(isFeaturedOrigin("https://jup.ag.evil.example")).toBeUndefined();
    expect(isFeaturedOrigin("https://app-uniswap.org")).toBeUndefined();
  });
});

describe("Trade & earn (regulated products, through the apps only)", () => {
  it("each entry is a verified https domain with a kind and a short plain note", async () => {
    const { tradeAndEarnFor, TRADE_DISCLAIMER } = await import("../src/dapps/featured.js");
    const list = tradeAndEarnFor(FAMILIES);
    expect(list.map((d) => d.name)).toEqual(["Hyperliquid", "dYdX", "GMX", "Polymarket", "Ondo", "Sky", "Ethena", "Pendle"]);
    for (const d of list) {
      expect(hostOf(d.url)).toBe(d.domain);
      expect(d.kind).toBeTruthy();
      expect(d.note && d.note.length > 10 && d.note.length <= 140).toBe(true);
    }
    for (const d of list.filter((x) => x.kind === "perps")) expect(d.note).toMatch(/Leveraged trading can lose/);
    expect(TRADE_DISCLAIMER).toMatch(/depends on where you live/);
    expect(TRADE_DISCLAIMER).toMatch(/only connects your wallet/);
  });

  it("is hidden when the build has no Ethereum-style networks, and look-alikes aren't verified", async () => {
    const { tradeAndEarnFor } = await import("../src/dapps/featured.js");
    expect(tradeAndEarnFor(["hedera", "solana"])).toEqual([]);
    expect(isFeaturedOrigin("https://app.hyperliquid.xyz")?.name).toBe("Hyperliquid");
    expect(isFeaturedOrigin("https://app-hyperliquid.xyz")).toBeUndefined();
    expect(isFeaturedOrigin("https://polymarket.com.claim.example")).toBeUndefined();
  });
});
