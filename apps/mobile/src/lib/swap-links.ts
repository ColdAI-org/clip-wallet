/**
 * Where Discover's "Swap" goes on the phone. There is no native Swap screen on mobile, so we open a DEX in the
 * in-app browser with the token prefilled:
 *   Solana   Jupiter, ?sell=<mint>&buy=<mint> (https://dev.jup.ag/docs/misc/integrate-jupiter-ui — swap links)
 *   EVM      Uniswap, ?outputCurrency=<address> (https://docs.uniswap.org/contracts/v2/guides/interface-integration/custom-interface-linking)
 *   Hedera   SaucerSwap's swap page (no documented token prefill)
 * Pure: no React Native imports, so it runs under vitest.
 */
import type { DiscoverToken } from "@clip-wallet/social/views";

/** Wrapped SOL: what Jupiter sells by default (the user's SOL). */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** DEX Screener chain ids Uniswap's web app can trade on. */
export const UNISWAP_CHAINS: ReadonlySet<string> = new Set(["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "linea", "scroll"]);

export function externalSwapUrl(token: Pick<DiscoverToken, "chain" | "address">): string | null {
  const chain = token.chain?.toLowerCase();
  if (chain === "hedera") return "https://www.saucerswap.finance/swap";
  const address = token.address?.trim();
  if (!chain || !address) return null;
  if (chain === "solana") return `https://jup.ag/swap?sell=${SOL_MINT}&buy=${encodeURIComponent(address)}`;
  if (UNISWAP_CHAINS.has(chain)) return `https://app.uniswap.org/swap?outputCurrency=${encodeURIComponent(address)}`;
  return null;
}
