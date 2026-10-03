/**
 * Page-side FeaturesClient over the same message bus as the wallet (messages are FEATURE_REQUESTS from
 * @clip-wallet/features, merged into shared/messages.ts at integration). New file from the "features" stream.
 */
import type { FeatureRequest, FeatureRequestType, FeatureResponseMap } from "@clip-wallet/features";
import type { FeaturesClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { Envelope } from "./messages";

export type FeatureTransport = (msg: FeatureRequest) => Promise<unknown>;

class FeatureBusError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

const runtimeTransport: FeatureTransport = (msg) => browser.runtime.sendMessage(msg);

/** Only https URLs leave the wallet, and only into a new tab. */
async function openExternal(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new FeatureBusError("That link can't be opened.", "features/bad-url");
  await browser.tabs.create({ url: u.toString() });
}

export function createFeaturesBusClient(transport: FeatureTransport = runtimeTransport): FeaturesClient {
  async function call<T extends FeatureRequestType>(msg: Extract<FeatureRequest, { type: T }>): Promise<FeatureResponseMap[T]> {
    let raw: unknown;
    try {
      raw = await transport(msg);
    } catch {
      throw new FeatureBusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
    }
    const env = Envelope.safeParse(raw);
    if (!env.success) throw new FeatureBusError("Something went wrong. Please try again.", "bus/bad-reply");
    if (!env.data.ok) throw new FeatureBusError(env.data.error.userMessage, env.data.error.code);
    return env.data.data as FeatureResponseMap[T];
  }
  return {
    stakingOverview: () => call({ type: "featStakingOverview" }),
    stakingOptions: (p) => call({ type: "featStakingOptions", ...p }),
    stake: (p) => call({ type: "featStake", ...p }),
    stakeAction: (p) => call({ type: "featStakeAction", ...p }),
    swapStatus: () => call({ type: "featSwapStatus" }),
    swapQuote: (p) => call({ type: "featSwapQuote", ...p }),
    swapExecute: (p) => call({ type: "featSwapExecute", ...p }),
    buyAssets: () => call({ type: "featBuyAssets" }),
    buyOptions: (p) => call({ type: "featBuyOptions", ...p }),
    tradeList: () => call({ type: "featTradeList" }),
    tradeCreate: (p) => call({ type: "featTradeCreate", ...p }),
    tradeReview: (p) => call({ type: "featTradeReview", ...p }),
    tradeAccept: (p) => call({ type: "featTradeAccept", ...p }),
    featured: () => call({ type: "featFeatured" }),
    lpPositions: () => call({ type: "featLpPositions" }),
    openExternal,
  };
}
