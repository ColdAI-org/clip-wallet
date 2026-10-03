import { describe, expect, it } from "vitest";
import type { DiscoverToken } from "@clip-wallet/social/views";
import { SOL_MINT, UNISWAP_CHAINS, externalSwapUrl } from "../src/lib/swap-links";

const tok = (p: Partial<DiscoverToken>): DiscoverToken => ({ id: "x", name: "Token", symbol: "TKN", swap: { buy: "x", symbol: "TKN" }, source: "dexscreener", ...p });

describe("externalSwapUrl", () => {
  it("opens Jupiter selling SOL for a Solana mint", () => {
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    expect(externalSwapUrl(tok({ chain: "solana", address: mint }))).toBe(`https://jup.ag/swap?sell=${SOL_MINT}&buy=${mint}`);
  });

  it("opens Uniswap with outputCurrency on every EVM chain it trades", () => {
    const a = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";
    for (const chain of ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "linea", "scroll"]) {
      expect(UNISWAP_CHAINS.has(chain)).toBe(true);
      expect(externalSwapUrl(tok({ chain, address: a }))).toBe(`https://app.uniswap.org/swap?outputCurrency=${a}`);
    }
  });

  it("opens SaucerSwap for Hedera", () => {
    expect(externalSwapUrl(tok({ chain: "hedera", address: "0.0.731861" }))).toBe("https://www.saucerswap.finance/swap");
  });

  it("returns null for unknown chains and for wallet-known assets with no address", () => {
    expect(externalSwapUrl(tok({ chain: "tron", address: "TXYZ" }))).toBeNull();
    expect(externalSwapUrl(tok({ swap: { buy: "eth", symbol: "ETH", assetKey: "eth" } }))).toBeNull();
    expect(externalSwapUrl(tok({ chain: "base" }))).toBeNull();
  });
});
