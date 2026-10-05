import { z } from "zod";
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
} from "./views.js";

/**
 * Bus messages for the feature screens, zod-validated in the background like every other page message.
 * The integration step spreads FEATURE_REQUESTS into packages/extension-kit/src/shared/messages.ts `Request` and
 * merges FeatureResponseMap into `ResponseMap` (see docs/phase2/integration/features.md).
 */
const assetKey = z.string().min(1).max(100);
const humanAmount = z.string().regex(/^\d+(\.\d+)?$/).max(80);
const id = z.string().min(1).max(200);
const leg = z.union([
  z.object({ assetKey, amount: humanAmount }).strict(),
  z.object({ nft: z.object({ tokenId: z.string().regex(/^0\.0\.\d+$/), serial: z.string().regex(/^\d+$/).max(20) }).strict() }).strict(),
]);
const link = z.string().min(1).max(16_000);

export const FEATURE_REQUESTS = [
  z.object({ type: z.literal("featStakingOverview") }),
  z.object({ type: z.literal("featStakingOptions"), assetKey }),
  z.object({ type: z.literal("featStake"), assetKey, amount: humanAmount.optional(), optionId: id.optional() }),
  z.object({ type: z.literal("featStakeAction"), assetKey, positionId: id, action: z.enum(["unstake", "withdraw", "claim"]), amount: humanAmount.optional(), choice: id.optional() }),
  z.object({ type: z.literal("featSwapStatus") }),
  z.object({ type: z.literal("featSwapQuote"), sell: assetKey, buy: assetKey, amount: humanAmount, slippageBps: z.number().int().min(1).max(1000).optional() }),
  z.object({ type: z.literal("featSwapExecute"), quoteId: id }),
  z.object({ type: z.literal("featBuyAssets") }),
  z.object({ type: z.literal("featBuyOptions"), assetKey, fiatAmount: z.number().positive().max(50_000), fiatCurrency: z.string().regex(/^[A-Z]{3}$/) }),
  z.object({ type: z.literal("featTradeList") }),
  z.object({
    type: z.literal("featTradeCreate"),
    give: leg,
    get: leg,
    counterparty: z.string().min(1).max(64),
    mode: z.enum(["direct", "scheduled"]),
    expiresInHours: z.number().int().min(1).max(1440).optional(),
  }),
  z.object({ type: z.literal("featTradeReview"), link }),
  z.object({ type: z.literal("featTradeAccept"), link }),
  z.object({ type: z.literal("featFeatured") }),
  z.object({ type: z.literal("featLpPositions") }),
] as const;

export const FeatureRequest = z.discriminatedUnion("type", FEATURE_REQUESTS);
export type FeatureRequest = z.infer<typeof FeatureRequest>;
export type FeatureRequestType = FeatureRequest["type"];

export function isFeatureRequest(m: { type: string }): m is FeatureRequest {
  return m.type.startsWith("feat");
}

export interface FeatureResponseMap {
  featStakingOverview: StakeAssetView[];
  featStakingOptions: StakeOptionView[];
  featStake: QueuedApprovals;
  featStakeAction: QueuedApprovals;
  featSwapStatus: SwapProviderStatus[];
  featSwapQuote: SwapQuoteView;
  featSwapExecute: QueuedApprovals;
  featBuyAssets: { assetKey: string; symbol: string; name: string }[];
  featBuyOptions: OnRampView;
  featTradeList: TradeOfferView[];
  featTradeCreate: { offerId: string; queued: QueuedApprovals };
  featTradeReview: TradeReviewView;
  featTradeAccept: QueuedApprovals;
  featFeatured: FeaturedDappView[];
  featLpPositions: LpPositionView[];
}
