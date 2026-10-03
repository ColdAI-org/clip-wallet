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
