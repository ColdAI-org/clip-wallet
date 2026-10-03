import type { ReactElement } from "react";
import { Buy } from "./Buy";
import { Explore } from "./Explore";
import { StakeAsset, StakeHome } from "./Stake";
import { Swap } from "./Swap";
import { TradeCreate, TradeDetail, TradeHome, TradeReview } from "./Trade";

/** Asset keys with a live staking provider (packages/features StakingService). Others show "coming soon". */
export const STAKEABLE_NOW: readonly string[] = ["hbar", "sol"];

/** Top-level paths the feature screens own. */
export const FEATURE_PATHS = ["stake", "swap", "buy", "trade", "explore"] as const;

/**
 * Feature screens for a path, or null when the path isn't a feature. App.tsx calls this before its own
 * switch (see docs/phase2/integration/features.md):
 *   /stake, /stake?asset=sol, /swap?sell=usdc&buy=eth, /buy?asset=sol,
 *   /trade, /trade/new, /trade/open?link=…, /trade/<id>, /explore
 */
export function featureRoute(seg: string[], query: URLSearchParams, hash = ""): ReactElement | null {
  switch (seg[0]) {
    case "stake": {
      const a = query.get("asset");
      return a ? <StakeAsset assetKey={a} /> : <StakeHome />;
    }
    case "swap":
      return <Swap sell={query.get("sell") ?? undefined} buy={query.get("buy") ?? undefined} />;
    case "buy":
      return <Buy assetKey={query.get("asset") ?? undefined} />;
    case "trade":
      if (!seg[1]) return <TradeHome />;
      if (seg[1] === "new") return <TradeCreate />;
      if (seg[1] === "open") return <TradeReview link={query.get("link") ?? (hash.includes("offer=") ? hash : undefined)} />;
      return <TradeDetail id={decodeURIComponent(seg[1])} />;
    case "explore":
      return <Explore />;
    default:
      return null;
  }
}
