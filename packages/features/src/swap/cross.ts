import { type AssetRef, ClipError, type TokenBalance } from "@clip-wallet/core";
import type { Quote, QuoteRequest } from "@clip-wallet/route";
import { formatUnits } from "../util.js";
import type { SwapQuoteView } from "../views.js";

/** The part of @clip-wallet/route's RouteClient used here. */
export interface RouteQuoter {
  quote(req: QuoteRequest): Promise<Quote[]>;
}

/**
 * Cross-network swaps go through CLPRouter (@clip-wallet/route). Quote only in this build: the route client
 * quotes "how much of X on network A to deliver Y on network B", so the target amount is estimated from
 * prices and the route's `youPay` is shown back. Executing (planPayOnHedera → Router.send) is not wired yet.
 */
export async function crossNetworkQuote(
  p: { sell: AssetRef; buy: AssetRef; amount: string; balances: TokenBalance[]; usd: (key: string) => number | undefined; route: RouteQuoter },
): Promise<SwapQuoteView> {
  const ps = p.usd(p.sell.key);
  const pb = p.usd(p.buy.key);
  if (ps === undefined || pb === undefined) {
    throw new ClipError("There's no way to swap these two right now.", "swap/no-route");
  }
  const sellWhole = Number(p.amount) / 10 ** p.sell.decimals;
  const buyWhole = (sellWhole * ps) / pb;
  const target = BigInt(Math.floor(buyWhole * 10 ** p.buy.decimals));
  if (target <= 0n) throw new ClipError("Enter a larger amount.", "swap/too-small");
  const [q] = await p.route.quote({ to: p.buy.networkId, asset: p.buy, amount: target.toString(), from: [p.sell.networkId], portfolio: p.balances });
  if (!q) throw new ClipError("There's no way to swap these two right now.", "swap/no-route");
  const display = `${formatUnits(target, p.buy.decimals)} ${p.buy.symbol}`;
  return {
    id: `route:${q.id}`,
    provider: "CLPRouter",
    sell: { assetKey: p.sell.key, symbol: p.sell.symbol, amount: q.youPay.amount, display: q.youPay.display },
    buy: { assetKey: p.buy.key, symbol: p.buy.symbol, amount: target.toString(), display },
    youGet: `You get ~${display}`,
    atLeast: `Arrives in about ${q.time.display}. If it doesn't arrive in time, the money comes back to you.`,
    slippageBps: 0,
    route: q.steps.map((s) => s.text).join(" → "),
    steps: [q.title],
    warnings: q.warnings.map((message) => ({ level: "caution" as const, code: "network-matters" as const, message })),
    executable: false,
    note: "Swapping between your balances in different places isn't switched on in this build yet. This is a preview of the price.",
    expiresAt: Date.now() + 30_000,
    networkId: p.buy.networkId,
  };
}
