import { type AssetRef, type ChainContext, ClipError, type Network, say } from "@clip-wallet/core";
import { type ClassicAsset, MAX_PATH_LENGTH, STELLAR_HORIZON, buildPathSwap, checkPathSwap, netOf, swapAsset } from "@clip-wallet/chains-stellar";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Stellar's built-in exchange (order books + AMM pools) through a path payment. No third party:
 *   quote: Horizon `GET /paths/strict-send?source_asset_type&source_asset_code&source_asset_issuer&source_amount&destination_assets`
 *          (https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-strict-send-payment-paths);
 *          the record with the largest `destination_amount` wins, its `path` is used as is.
 *   build: chains-stellar `buildPathSwap` → [changeTrust(buy)] + pathPaymentStrictSend(destination = you, destMin), one
 *          transaction. destMin is enforced on-chain (op_under_dest_min: nothing happens).
 * Works on testnet and pubnet (testnet only has paths where someone made offers or pools).
 */

interface PathRecord {
  source_amount: string;
  destination_asset_type: string;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  destination_amount: string;
  path: { asset_type: string; asset_code?: string; asset_issuer?: string }[];
}

/** 7-decimal Horizon amount → stroops (bigint). */
export function stroopsOf(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!m) throw new ClipError("The Stellar network sent a price we couldn't read. Try again.", "swap/stellar-bad-amount");
  return BigInt(m[1]!) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0"));
}

/** Stroops → "12.3400000". */
export function amountOf(stroops: bigint): string {
  return `${stroops / 10_000_000n}.${(stroops % 10_000_000n).toString().padStart(7, "0")}`;
}

/** SEP-11 form for `destination_assets`: "native" or "CODE:ISSUER". */
function sep11(a: AssetRef): string {
  const s = swapAsset(a);
  return s.isNative() ? "native" : `${s.getCode()}:${s.getIssuer()}`;
}

export class StellarPathSwap implements SwapProvider {
  readonly id = "stellar-dex";
  readonly name = "Stellar DEX";
  readonly family = "stellar" as const;

  constructor(private readonly opts: { horizonUrl?: string; quoteTtlMs?: number; now?: () => number } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "stellar" || !netOf(network.id)) return { code: "swap/wrong-family", message: "The Stellar DEX only swaps Stellar assets." };
    return null;
  }

  private horizon(ctx: ChainContext): string {
    const n = netOf(ctx.network.id);
    const url = this.opts.horizonUrl ?? ctx.network.rpcUrls[0] ?? (n ? STELLAR_HORIZON[n] : undefined);
    if (!url) throw new ClipError("Swapping isn't set up for this network.", "swap/stellar-no-horizon");
    return url.replace(/\/+$/, "");
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const sell = swapAsset(req.sell);
    const buyId = sep11(req.buy);
    const amount = BigInt(req.amount);
    if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "swap/bad-amount");

    const u = new URL(`${this.horizon(ctx)}/paths/strict-send`);
    if (sell.isNative()) u.searchParams.set("source_asset_type", "native");
    else {
      u.searchParams.set("source_asset_type", sell.getCode().length <= 4 ? "credit_alphanum4" : "credit_alphanum12");
      u.searchParams.set("source_asset_code", sell.getCode());
      u.searchParams.set("source_asset_issuer", sell.getIssuer());
    }
    u.searchParams.set("source_amount", amountOf(amount));
    u.searchParams.set("destination_assets", buyId);
    const body = await fetchJson<{ _embedded?: { records?: PathRecord[] } }>(ctx.fetch, u.toString(), "The Stellar network");

    const matches = (r: PathRecord) =>
      buyId === "native" ? r.destination_asset_type === "native" : `${r.destination_asset_code}:${r.destination_asset_issuer}` === buyId;
    let best: { out: bigint; rec: PathRecord } | undefined;
    for (const r of body._embedded?.records ?? []) {
      if (!matches(r) || r.path.length > MAX_PATH_LENGTH || stroopsOf(r.source_amount) !== amount) continue;
      const out = stroopsOf(r.destination_amount);
      if (!best || out > best.out) best = { out, rec: r };
    }
    if (!best || best.out <= 0n) throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another asset.", "swap/no-route");
    const minBuy = minOut(best.out, req.slippageBps);
    if (minBuy <= 0n) throw new ClipError("This amount is too small to swap. Try a larger amount.", "swap/too-small");

    const path: ClassicAsset[] = best.rec.path.map((p) => (p.asset_type === "native" || !p.asset_code ? { code: "native" } : { code: p.asset_code, issuer: p.asset_issuer! }));
    // Read-only checks now (balance, minimum balance, trustline) so the quote shows the extra step.
    const check = await checkPathSwap({ sell: req.sell, buy: req.buy, sendAmount: req.amount }, ctx);
    const via = path.map((p) => (p.code === "native" ? "XLM" : p.code));
    const now = (this.opts.now ?? Date.now)();
    const q: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: best.out.toString(),
      minBuyAmount: minBuy.toString(),
      slippageBps: req.slippageBps,
      route: [via.length ? `Stellar DEX (through ${via.join(", ")})` : "Stellar DEX"],
      expiresAt: now + (this.opts.quoteTtlMs ?? 30_000),
      data: { path } satisfies StellarQuoteData,
    };
    if (check.addsTrustline) q.association = { tokenId: buyId, symbol: req.buy.symbol };
    return q;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const { path } = quote.data as StellarQuoteData;
    const sell = quote.sell.symbol;
    const buy = quote.buy.symbol;
    const lines = [{ label: "Route", value: quote.route.join(" → ") }];
    if (quote.association) lines.push({ label: "Also", value: `Adds ${buy} to your account first. That sets aside 0.5 XLM of your balance while ${buy} is in your account.` });
    // One transaction: trustline (if needed) + swap go through together or not at all. Built lazily for a fresh sequence.
    return [
      {
        title: quote.association ? `Add ${buy} and swap ${sell} for ${buy}` : say("bg.req.swap", { pay: sell, get: buy }),
        lines,
        request: async () => (await buildPathSwap({ sell: quote.sell, buy: quote.buy, sendAmount: quote.sellAmount, destMin: quote.minBuyAmount, path }, ctx)).request,
      },
    ];
  }
}

interface StellarQuoteData {
  path: ClassicAsset[];
}
