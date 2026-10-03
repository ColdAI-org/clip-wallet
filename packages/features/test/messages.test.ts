import { describe, expect, it } from "vitest";
import { FeatureRequest, isFeatureRequest } from "../src/messages.js";

describe("feature bus messages", () => {
  it("accepts well-formed requests", () => {
    expect(FeatureRequest.parse({ type: "featSwapQuote", sell: "usdc", buy: "eth", amount: "100.5", slippageBps: 50 }).type).toBe("featSwapQuote");
    expect(FeatureRequest.parse({ type: "featTradeCreate", give: { assetKey: "hbar", amount: "10" }, get: { nft: { tokenId: "0.0.5", serial: "3" } }, counterparty: "0.0.1234", mode: "direct" }).type).toBe("featTradeCreate");
    expect(isFeatureRequest({ type: "featLpPositions" })).toBe(true);
    expect(isFeatureRequest({ type: "getPortfolio" })).toBe(false);
  });

  it("rejects bad amounts, unlimited slippage and extra leg fields", () => {
    expect(() => FeatureRequest.parse({ type: "featSwapQuote", sell: "usdc", buy: "eth", amount: "-1" })).toThrow();
    expect(() => FeatureRequest.parse({ type: "featSwapQuote", sell: "usdc", buy: "eth", amount: "1", slippageBps: 5000 })).toThrow();
    expect(() => FeatureRequest.parse({ type: "featTradeCreate", give: { assetKey: "hbar", amount: "1", extra: 1 }, get: { assetKey: "usdc", amount: "1" }, counterparty: "0.0.1", mode: "direct" })).toThrow();
    expect(() => FeatureRequest.parse({ type: "featBuyOptions", assetKey: "sol", fiatAmount: 0, fiatCurrency: "USD" })).toThrow();
  });
});
