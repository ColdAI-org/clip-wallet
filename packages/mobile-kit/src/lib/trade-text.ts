/**
 * Trade & earn entries come from packages/features/src/dapps/featured.json in English. The curated ones have
 * translated copies here, keyed by domain; an entry added later falls back to its English text until translated.
 */
import type { FeaturedDappView } from "@clip-wallet/ui";
import type { MobileMessageId } from "../i18n";

const SLUG: Record<string, string> = {
  "app.hyperliquid.xyz": "hyperliquid",
  "dydx.trade": "dydx",
  "app.gmx.io": "gmx",
  "polymarket.com": "polymarket",
  "app.ondo.finance": "ondo",
  "app.sky.money": "sky",
  "app.ethena.fi": "ethena",
  "app.pendle.finance": "pendle",
};

export function tradeText(d: FeaturedDappView, t: (id: MobileMessageId) => string): { description: string; note?: string } {
  const slug = SLUG[d.domain];
  if (!slug) return { description: d.description, note: d.note };
  return {
    description: t(`m.explore.trade.${slug}.description` as MobileMessageId),
    note: d.note ? t(`m.explore.trade.${slug}.note` as MobileMessageId) : undefined,
  };
}
