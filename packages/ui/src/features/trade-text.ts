/**
 * Trade & earn entries come from packages/features/src/dapps/featured.json in English. The curated ones have
 * translated copies in the "explore" namespace, keyed by domain; an entry added later shows its English text
 * until it is translated.
 */
import type { FeaturedDappView } from "./client";
import type { UiMessageId } from "../i18n";

export const TRADE_SLUGS: Record<string, string> = {
  "app.hyperliquid.xyz": "hyperliquid",
  "dydx.trade": "dydx",
  "app.gmx.io": "gmx",
  "polymarket.com": "polymarket",
  "app.ondo.finance": "ondo",
  "app.sky.money": "sky",
  "app.ethena.fi": "ethena",
  "app.pendle.finance": "pendle",
};

export function tradeText(d: FeaturedDappView, t: (id: UiMessageId) => string): { description: string; note?: string } {
  const slug = TRADE_SLUGS[d.domain];
  if (!slug) return { description: d.description, note: d.note };
  return {
    description: t(`explore.trade.${slug}.description` as UiMessageId),
    note: d.note ? t(`explore.trade.${slug}.note` as UiMessageId) : undefined,
  };
}
