/**
 * The feature screens' door to the background (staking, swaps, buy, Secure Trade, explore). Implemented over
 * the extension's message bus (docs/phase2/integration/features.md); a plain fake in tests. Nothing here
 * carries key material: every action returns the approval it queued on the normal approval path.
 *
 * View types come from @clip-wallet/features/views (type-only, no runtime import).
 */
import type {
  FeaturedDappView,
  LpPositionView,
  OnRampView,
  QueuedApprovals,
  StakeAssetView,
  StakeOptionView,
  SwapProviderStatus,
  SwapQuoteView,
  TradeOfferView,
  TradeReviewView,
} from "@clip-wallet/features/views";

export type {
  FeaturedDappView,
  LpPositionView,
  OnRampOptionView,
  OnRampView,
  QueuedApprovals,
  StakeAssetView,
  StakeOptionView,
  StakePositionView,
  SwapProviderStatus,
  SwapQuoteView,
  TradeLegView,
  TradeOfferView,
  TradeReviewView,
} from "@clip-wallet/features/views";

export type TradeLegInput = { assetKey: string; amount: string } | { nft: { tokenId: string; serial: string } };

export interface FeaturesClient {
  stakingOverview(): Promise<StakeAssetView[]>;
  stakingOptions(p: { assetKey: string }): Promise<StakeOptionView[]>;
  stake(p: { assetKey: string; amount?: string; optionId?: string }): Promise<QueuedApprovals>;
  stakeAction(p: { assetKey: string; positionId: string; action: "unstake" | "withdraw" | "claim" }): Promise<QueuedApprovals>;

  swapStatus(): Promise<SwapProviderStatus[]>;
  swapQuote(p: { sell: string; buy: string; amount: string; slippageBps?: number }): Promise<SwapQuoteView>;
  swapExecute(p: { quoteId: string }): Promise<QueuedApprovals>;

  buyAssets(): Promise<{ assetKey: string; symbol: string; name: string }[]>;
  buyOptions(p: { assetKey: string; fiatAmount: number; fiatCurrency: string }): Promise<OnRampView>;

  tradeList(): Promise<TradeOfferView[]>;
  tradeCreate(p: { give: TradeLegInput; get: TradeLegInput; counterparty: string; mode: "direct" | "scheduled"; expiresInHours?: number }): Promise<{ offerId: string; queued: QueuedApprovals }>;
  tradeReview(p: { link: string }): Promise<TradeReviewView>;
  tradeAccept(p: { link: string }): Promise<QueuedApprovals>;

  featured(): Promise<FeaturedDappView[]>;
  lpPositions(): Promise<LpPositionView[]>;

  /** Opens a URL in a new tab (on-ramp widgets, featured apps). */
  openExternal(url: string): Promise<void>;
}
