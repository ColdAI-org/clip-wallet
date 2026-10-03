import type { Family } from "@clip-wallet/core";
import type { FeaturedDappView } from "../views.js";
export { TRADE_DISCLAIMER } from "../views.js";
import data from "./featured.json" with { type: "json" };

export const FEATURED_DAPPS: readonly FeaturedDappView[] = (data.dapps as FeaturedDappView[]).map((d) => Object.freeze({ ...d }));

/** Host of a URL without "www.". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Featured apps for the families this build has switched on, in list order. */
export function featuredFor(families: Iterable<Family>): FeaturedDappView[] {
  const on = new Set(families);
  return FEATURED_DAPPS.filter((d) => on.has(d.family));
}

/** True when `origin` is exactly a featured domain (or its www.). Used to mark apps verified. */
export function isFeaturedOrigin(origin: string): FeaturedDappView | undefined {
  const h = hostOf(origin);
  return FEATURED_DAPPS.find((d) => d.domain === h);
}

/** The curated "Trade & earn" apps for the families this build has switched on. */
export function tradeAndEarnFor(families: Iterable<Family>): FeaturedDappView[] {
  return featuredFor(families).filter((d) => d.category === "trade");
}
