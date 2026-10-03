import type { AssetRef, ChainContext, Family, Network, NetworkId } from "@clip-wallet/core";
import type { Step } from "../steps.js";
import type { Unavailable } from "../views.js";

export interface SwapQuoteRequest {
  sell: AssetRef;
  buy: AssetRef;
  /** Base units of `sell`. */
  amount: string;
  slippageBps: number;
}

/** A same-network quote. `data` is provider-private (order ids, transactions) and never leaves the background. */
export interface SwapQuote {
  providerId: string;
  provider: string;
  networkId: NetworkId;
  sell: AssetRef;
  buy: AssetRef;
  sellAmount: string;
  /** Expected output before slippage. */
  buyAmount: string;
  /** Output floor the transaction enforces (or nothing happens). */
  minBuyAmount: string;
  slippageBps: number;
  /** Percent, when the provider reports it. */
  priceImpactPct?: number;
  /** Venue labels, in order. */
  route: string[];
  /** Exact-amount spending permission needed first (EVM ERC-20, Hedera HTS allowance). Never unlimited. */
  approval?: { spender: string; spenderName: string; amount: string };
  /** Hedera: the bought token must be added to the account first. */
  association?: { tokenId: string; symbol: string };
  expiresAt: number;
  data?: unknown;
}

export interface SwapProvider {
  id: string;
  name: string;
  family: Family;
  /** Null when usable on this network; otherwise why not, in plain words. */
  availability(network: Network): Unavailable | null;
  quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote>;
  /** Approval steps in order (permission, association, then the swap). */
  build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]>;
}

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 1000;
/** Above this the quote carries a caution. */
export const HIGH_SLIPPAGE_BPS = 300;

export function minOut(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function clampSlippage(bps: number | undefined, fallback = DEFAULT_SLIPPAGE_BPS): number {
  const v = Math.round(bps ?? fallback);
  if (!Number.isFinite(v) || v < 1) return fallback;
  return Math.min(v, MAX_SLIPPAGE_BPS);
}
