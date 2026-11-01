import { type AssetRef, ClipError, type Network, type Warning, msg, type Msg, say } from "@clip-wallet/core";
import type { FeatureHost } from "../host.js";
import { queueSteps } from "../steps.js";
import { formatUnits, parseUnits, percent } from "../util.js";
import type { QueuedApprovals, SwapProviderStatus, SwapQuoteView } from "../views.js";
import { type RouteQuoter, crossNetworkQuote } from "./cross.js";
import { DEFAULT_SLIPPAGE_BPS, HIGH_SLIPPAGE_BPS, type SwapProvider, type SwapQuote, clampSlippage } from "./types.js";

const QUOTE_TTL_MS = 60_000;

/**
 * Swaps in assets, not networks: "Swap 100 USDC for ETH". The service picks the network where you hold the
 * asset you sell and where a provider can swap it; if no shared network works, a cross-network provider (SODAX,
 * docs/features/sodax-swaps.md) swaps it into another network, and failing that it asks CLPRouter for a
 * cross-network quote (quote only for now).
 */
export class SwapService {
  private quotes = new Map<string, { quote: SwapQuote; provider: SwapProvider; at: number }>();
  private seq = 0;

  constructor(
    private readonly host: FeatureHost,
    private readonly providers: SwapProvider[],
    private readonly opts: { route?: RouteQuoter; defaultSlippageBps?: number } = {},
  ) {}

  status(): SwapProviderStatus[] {
    const families = new Set(this.host.networks().map((n) => n.family));
    return this.providers
      .filter((p) => families.has(p.family))
      .map((p) => {
        const nets = this.host.networks().filter((n) => n.family === p.family);
        const avail = nets.map((n) => p.availability(n));
        const why = avail.includes(null) ? undefined : (avail.find((a) => a !== null) ?? undefined);
        const s: SwapProviderStatus = { id: p.id, name: p.name, family: p.family };
        if (why) s.unavailable = why;
        return s;
      });
  }

  private assetOn(key: string, networkId: string): AssetRef | undefined {
    return this.host.assets().find((a) => a.key === key && a.networkId === networkId);
  }

  async quote(p: { sell: string; buy: string; amount: string; slippageBps?: number }): Promise<SwapQuoteView> {
    if (p.sell === p.buy) throw new ClipError("Pick two different assets.", "swap/same-asset");
    const slippageBps = clampSlippage(p.slippageBps, this.opts.defaultSlippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const balances = await this.host.balances();
    const holding = (key: string) => (networkId: string) =>
      balances.filter((b) => b.asset.key === key && b.asset.networkId === networkId).reduce((t, b) => t + BigInt(b.amount), 0n);
    const held = holding(p.sell);
    const most = (amount: (networkId: string) => bigint) => (a: Network, b: Network) => (amount(b.id) > amount(a.id) ? 1 : amount(b.id) < amount(a.id) ? -1 : 0);

    // Networks carrying both assets, most of the sell asset first.
    const shared = this.host
      .networks()
      .filter((n) => this.assetOn(p.sell, n.id) && this.assetOn(p.buy, n.id))
      .sort(most(held));

    let lastUnavailable: string | undefined;
    let lastError: unknown;
    for (const n of shared) {
      const provider = this.providerFor(n);
      if (!provider) {
        lastUnavailable = this.providers.filter((x) => !x.crossNetwork && x.family === n.family).map((x) => x.availability(n)?.message).find(Boolean) ?? lastUnavailable;
        continue;
      }
      const sell = this.assetOn(p.sell, n.id)!;
      const buy = this.assetOn(p.buy, n.id)!;
      const amount = parseUnits(p.amount, sell.decimals);
      if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "swap/bad-amount");
      if (held(n.id) < amount) {
        lastError = new ClipError(msg("bg.err.notEnoughForSwap", { symbol: sell.symbol }), "swap/insufficient");
        continue;
      }
      try {
        const ctx = await this.host.ctx(n.id);
        const quote = await provider.quote({ sell, buy, amount: amount.toString(), slippageBps }, ctx);
        return this.remember(quote, provider);
      } catch (e) {
        lastError = e;
      }
    }

    // No shared network that works: a provider that swaps between networks (SODAX), paying where you hold the most
    // of what you sell, into the network where you hold the most of what you buy (else the first that carries it).
    for (const from of this.host.networks().filter((n) => this.assetOn(p.sell, n.id) && held(n.id) > 0n).sort(most(held))) {
      const provider = this.providers.find((x) => x.crossNetwork && x.family === from.family && x.availability(from) === null);
      const to = provider && this.host.networks().filter((n) => n.id !== from.id && this.assetOn(p.buy, n.id) && provider.availability(n) === null).sort(most(holding(p.buy)))[0];
      if (!provider || !to) continue;
      const sell = this.assetOn(p.sell, from.id)!;
      const amount = parseUnits(p.amount, sell.decimals);
      if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "swap/bad-amount");
      if (held(from.id) < amount) {
        lastError = new ClipError(msg("bg.err.notEnoughForSwap", { symbol: sell.symbol }), "swap/insufficient");
        continue;
      }
      try {
        const [ctx, there] = await Promise.all([this.host.ctx(from.id), this.host.ctx(to.id)]);
        const destination = { network: to, address: there.account.address };
        const quote = await provider.quote({ sell, buy: this.assetOn(p.buy, to.id)!, amount: amount.toString(), slippageBps, destination }, ctx);
        return this.remember(quote, provider);
      } catch (e) {
        lastError = e;
      }
    }

    // Still nothing: CLPRouter, quote only.
    const route = this.opts.route;
    if (route) {
      const from = this.host.networks().filter((n) => this.assetOn(p.sell, n.id) && held(n.id) > 0n).sort((a, b) => (held(b.id) > held(a.id) ? 1 : -1))[0];
      const to = this.host.networks().find((n) => this.assetOn(p.buy, n.id) && n.id !== from?.id);
      if (from && to) {
        const sell = this.assetOn(p.sell, from.id)!;
        const buy = this.assetOn(p.buy, to.id)!;
        try {
          return await crossNetworkQuote({ sell, buy, amount: parseUnits(p.amount, sell.decimals).toString(), balances, usd: (k) => this.host.usd(k), route });
        } catch (e) {
          lastError ??= e;
        }
      }
    }
    if (lastError) throw lastError;
    throw new ClipError(lastUnavailable ?? "There's no way to swap these two right now.", "swap/no-route");
  }

  private providerFor(n: Network): SwapProvider | undefined {
    return this.providers.find((p) => !p.crossNetwork && p.family === n.family && p.availability(n) === null);
  }

  private remember(quote: SwapQuote, provider: SwapProvider): SwapQuoteView {
    const id = `q${++this.seq}-${Date.now().toString(36)}`;
    const now = Date.now();
    for (const [k, v] of this.quotes) if (now - v.at > QUOTE_TTL_MS) this.quotes.delete(k);
    this.quotes.set(id, { quote, provider, at: now });
    return this.view(id, quote);
  }

  view(id: string, q: SwapQuote): SwapQuoteView {
    const got = `${formatUnits(q.buyAmount, q.buy.decimals)} ${q.buy.symbol}`;
    const warnings: Warning[] = [];
    if (q.priceImpactPct !== undefined && q.priceImpactPct >= 1) {
      warnings.push({
        level: q.priceImpactPct >= 5 ? "danger" : "caution",
        code: "high-fee",
        message: say("bg.swap.priceImpact", { percent: percent(q.priceImpactPct) }),
      });
    }
    // Value check from prices (catches thin pools when the provider reports no price impact).
    const ps = this.host.usd(q.sell.key);
    const pb = this.host.usd(q.buy.key);
    if (ps !== undefined && pb !== undefined && ps > 0) {
      const inUsd = (Number(q.sellAmount) / 10 ** q.sell.decimals) * ps;
      const outUsd = (Number(q.buyAmount) / 10 ** q.buy.decimals) * pb;
      const loss = inUsd > 0 ? (1 - outUsd / inUsd) * 100 : 0;
      if (loss >= 5 && !warnings.length) {
        warnings.push({ level: loss >= 15 ? "danger" : "caution", code: "high-fee", message: say("bg.swap.valueLoss", { percent: percent(loss, 0) }) });
      }
    }
    if (q.slippageBps > HIGH_SLIPPAGE_BPS) {
      warnings.push({ level: "caution", code: "high-fee", message: say("bg.swap.highSlippage", { percent: percent(q.slippageBps / 100) }) });
    }
    const stepMsgs: Msg[] = [];
    if (q.association) stepMsgs.push(msg("bg.req.addToYourAccount", { symbol: q.association.symbol }));
    if (q.approval) stepMsgs.push(msg("bg.req.allowUseExactly", { spender: q.approval.spenderName, amount: `${formatUnits(q.approval.amount, q.sell.decimals)} ${q.sell.symbol}` }));
    stepMsgs.push(msg("bg.swap.swapStep"));
    const steps = stepMsgs.map((m) => m.fallback);
    const min = `${formatUnits(q.minBuyAmount, q.buy.decimals)} ${q.buy.symbol}`;
    const there = q.buy.networkId !== q.networkId ? this.host.networks().find((n) => n.id === q.buy.networkId) : undefined;
    const v: SwapQuoteView = {
      id,
      provider: q.provider,
      sell: { assetKey: q.sell.key, symbol: q.sell.symbol, amount: q.sellAmount, display: `${formatUnits(q.sellAmount, q.sell.decimals)} ${q.sell.symbol}` },
      buy: { assetKey: q.buy.key, symbol: q.buy.symbol, amount: q.buyAmount, display: got },
      youGet: `You get ~${got}`,
      // A cross-network order has left your account once it's sent: unfilled, it waits to be cancelled (docs/features/sodax-swaps.md).
      atLeast: there ? `At least ${min}, or the order isn't filled` : `At least ${min}, or nothing happens`,
      slippageBps: q.slippageBps,
      route: `Via ${q.route.join(" → ")}`,
      steps,
      stepMsgs,
      warnings,
      executable: true,
      expiresAt: q.expiresAt,
      networkId: q.networkId,
    };
    if (q.priceImpactPct !== undefined) v.priceImpactPct = q.priceImpactPct;
    if (q.clipFee) {
      v.clipFee = { pct: q.clipFee.pct, amount: q.clipFee.amount, display: `${formatUnits(q.clipFee.amount, q.sell.decimals)} ${q.sell.symbol}`, receivedBy: q.clipFee.receivedBy };
    }
    if (there) v.arrivesOn = { networkId: there.id, name: there.name };
    return v;
  }

  async execute(quoteId: string): Promise<QueuedApprovals> {
    const hit = this.quotes.get(quoteId);
    if (!hit) throw new ClipError("This price expired. Get a new one.", "swap/quote-expired");
    if (Date.now() > hit.quote.expiresAt + 30_000) {
      this.quotes.delete(quoteId);
      throw new ClipError("This price expired. Get a new one.", "swap/quote-expired");
    }
    this.quotes.delete(quoteId);
    const ctx = await this.host.ctx(hit.quote.networkId);
    const steps = await hit.provider.build(hit.quote, ctx);
    return queueSteps(this.host, steps, hit.provider.name);
  }
}
