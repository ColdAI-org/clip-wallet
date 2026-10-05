/**
 * What the feature screens see. Plain data only (no classes, no bigint), so it crosses the extension's
 * message bus as JSON. Speaks in assets and apps: `networkId` is carried for the network chip and
 * Advanced mode only, never as the main way to tell things apart.
 *
 * Type-only module with no runtime imports, so `packages/ui` can import it (`@clip-wallet/features/views`)
 * without pulling in chain SDKs.
 */
import type { BalanceChange, Family, Msg, NetworkId, Warning } from "@clip-wallet/core";

/** "Not available" in plain words. `code` is stable for tests and analytics. */
export interface Unavailable {
  code: string;
  message: string;
}

/* ------------------------------------------------------------------ staking */

export interface StakeOptionView {
  id: string;
  /** "Validator Everstake", "Node 3 · Hosted by LG, Seoul". */
  title: string;
  /** "Earns about 6.8% a year · keeps 5% of rewards". */
  detail: string;
  /** Additive: translatable `title` / `detail`, when they are a known pattern. */
  titleMsg?: Msg;
  detailMsg?: Msg;
  /** Yearly reward rate as a percentage (6.8 = 6.8 %), when the network exposes enough to estimate it. */
  apy?: number;
  /** The option the wallet picks for you. */
  recommended?: boolean;
}

export type StakeStatus = "active" | "activating" | "deactivating" | "withdrawable" | "rewards-off";

export interface StakePositionView {
  id: string;
  assetKey: string;
  symbol: string;
  decimals: number;
  /** Base units, decimal string. */
  amount: string;
  /** "120 HBAR". */
  amountDisplay: string;
  /** Who it's staked with, in plain words. */
  with: string;
  status: StakeStatus;
  /** "Earning rewards", "Unlocks in about 2 days", "Ready to move back to your balance". */
  statusText: string;
  pendingReward?: { amount: string; display: string };
  actions: ("unstake" | "withdraw" | "claim" | "change")[];
  /**
   * Choices the user must make before `claim` (Cardano: withdrawing rewards needs a vote delegation; the
   * wallet offers "abstain" and "no confidence" in plain words). Pass the picked `id` as `choice`.
   */
  claimChoices?: { id: string; title: string; detail: string }[];
  /** True when `unstake` can take a partial amount (Polkadot pools, NEAR). */
  partialUnstake?: boolean;
  networkId: NetworkId;
}

export interface StakeAssetView {
  assetKey: string;
  symbol: string;
  name: string;
  /** Hedera stakes the whole balance in place (nothing moves); Solana stakes a chosen amount. */
  wholeBalance: boolean;
  /** The amount may be left empty (Tezos: delegate only, nothing locked). */
  amountOptional?: boolean;
  /** Plain explanation shown above the options. */
  howItWorks: string;
  /** "About 2.4% a year" when known. */
  rewardRate?: string;
  positions: StakePositionView[];
  unavailable?: Unavailable;
  networkId?: NetworkId;
}

/* ------------------------------------------------------------------ swaps */

export interface SwapQuoteView {
  id: string;
  /** "Jupiter", "SaucerSwap", "0x". */
  provider: string;
  sell: { assetKey: string; symbol: string; amount: string; display: string };
  buy: { assetKey: string; symbol: string; amount: string; display: string };
  /** "You get ~0.03 ETH". */
  youGet: string;
  /** "At least 0.0297 ETH, or nothing happens". */
  atLeast: string;
  slippageBps: number;
  /** Percent (0.12 = 0.12 %), when the provider reports it. */
  priceImpactPct?: number;
  /** "Via Orca → Raydium". */
  route: string;
  /** Steps you'll approve, in order: "Allow 0x to use exactly 100 USDC", "Swap". */
  steps: string[];
  /** Additive: `steps` as translatable Msgs (same order; undefined where a step has none). */
  stepMsgs?: (Msg | undefined)[];
  warnings: Warning[];
  /** False for cross-network quotes in this build (quote only). */
  executable: boolean;
  /** Plain reason when not executable. */
  note?: string;
  expiresAt: number;
  /** Advanced mode only. */
  networkId: NetworkId;
}

export interface SwapProviderStatus {
  id: string;
  name: string;
  family: Family;
  unavailable?: Unavailable;
}

/* ------------------------------------------------------------------ on-ramp */

export interface OnRampOptionView {
  provider: string;
  name: string;
  /** Opens in a new tab. Never contains secrets. */
  url?: string;
  unavailable?: Unavailable;
  /** "Card, bank transfer, Apple Pay". */
  methods?: string;
}

export interface OnRampView {
  assetKey: string;
  symbol: string;
  /** "Your SOL arrives in your wallet. Clip Wallet picked the cheapest way to receive it." */
  explainer: string;
  options: OnRampOptionView[];
  networkId?: NetworkId;
}

/* ------------------------------------------------------------------ Secure Trade */

export type TradeLegView =
  | { kind: "asset"; assetKey: string; symbol: string; amount: string; display: string; tokenId?: string }
  | { kind: "nft"; tokenId: string; serial: string; display: string };

export type TradeStatus = "draft" | "waiting" | "done" | "expired" | "cancelled" | "failed";

export interface TradeOfferView {
  id: string;
  role: "maker" | "taker";
  mode: "direct" | "scheduled";
  /** "Trade 5 SAUCE for 10 HBAR with 0.0.1001". */
  title: string;
  give: TradeLegView;
  get: TradeLegView;
  counterparty: string;
  status: TradeStatus;
  /** "Waiting for 0.0.1001 to accept", "Done", "Expired: nothing moved". */
  statusText: string;
  /** Share link (and QR payload). Present once the maker has signed. */
  link?: string;
  expiresAt?: number;
  createdAt: number;
  /** Things the other side must do first ("0.0.1001 must add SAUCE before accepting"). */
  notes: string[];
}

export interface TradeReviewView {
  offer: TradeOfferView;
  /** Decoded from the actual transaction, not from the link's claims. */
  title: string;
  titleMsg?: Msg;
  lines: { label: string; value: string; labelMsg?: Msg; valueMsg?: Msg }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  /** Plain steps the wallet will queue for approval: "Add SAUCE to your account", "Accept the trade". */
  steps: string[];
  /** Additive: `steps` as translatable Msgs (same order). */
  stepMsgs?: (Msg | undefined)[];
  /** Plain reason the offer can't be accepted (expired, not for you, mismatch). Blocks Accept. */
  problem?: string;
}

/* ------------------------------------------------------------------ explore */

export interface FeaturedDappView {
  name: string;
  url: string;
  domain: string;
  /** Phase 2.5 (additive): "trade" = "Trade & earn" (regulated products, only through the app itself). */
  category: "swap" | "lend" | "stake" | "nft" | "bridge" | "pay" | "tools" | "trade";
  description: string;
  family: Family;
  /** "Trade & earn" only: what kind of product it is. */
  kind?: "perps" | "predictions" | "stocks" | "funds" | "yield";
  /** "Trade & earn" only: a short plain risk / availability note shown with the app. */
  note?: string;
}

/**
 * Shown above "Trade & earn". These are regulated products (derivatives, prediction markets, securities-like
 * tokens, yield) that Clip Wallet never offers itself: it only connects the user's wallet to the app, through
 * 1Mask (injected) or WalletConnect, when the user approves.
 */
export const TRADE_DISCLAIMER =
  "These apps are run by other companies, not Clip Wallet. What's allowed depends on where you live, and some aren't available in your country: check before you use one. Clip Wallet only connects your wallet when you say yes. It doesn't offer, recommend or stand behind these products.";

export interface LpPositionView {
  id: string;
  /** "SaucerSwap", "Uniswap". */
  app: string;
  /** "HBAR / SAUCE". */
  pair: string;
  /** "12.3 HBAR + 45.6 SAUCE". */
  holdings: string;
  /** "Earning fees" | "Out of range: not earning fees". */
  status: string;
  inRange: boolean;
  /** "0.12 HBAR + 0.4 SAUCE waiting to be collected" (lower bound). */
  fees?: string;
  fiatValue?: number;
  url: string;
  networkId: NetworkId;
}

/* ------------------------------------------------------------------ results of actions */

/** What a feature action queued on the normal approval path. The UI navigates to the first approval. */
export interface QueuedApprovals {
  /** The approval waiting now. Later steps are queued after it succeeds. */
  approvalId: string;
  /** Plain names of every step, in order. */
  steps: string[];
  /** Additive: `steps` as translatable Msgs (same order). */
  stepMsgs?: (Msg | undefined)[];
}
