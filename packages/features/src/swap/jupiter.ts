import { type ChainContext, ClipError, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import { clusterOf } from "@clip-wallet/chains-solana";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * Jupiter Swap API V2, Meta-Aggregator path (https://developers.jup.ag/docs/swap/order-and-execute.md):
 *   GET  https://api.jup.ag/swap/v2/order?inputMint&outputMint&amount&taker&slippageBps → { transaction (b64), requestId, outAmount, otherAmountThreshold, priceImpactPct, routePlan[].swapInfo.label, router }
 *   POST https://api.jup.ag/swap/v2/execute { signedTransaction, requestId } → { status, signature, code, error, totalOutputAmount }
 * Keyless on api.jup.ag at 0.5 RPS; a free portal key (x-api-key) gets 1 RPS (developers.jup.ag/docs/portal/rate-limits.md).
 * The V1 /swap/v1/quote + /swap/v1/swap ("Metis") API is superseded; lite-api.jup.ag is being retired.
 * Mainnet only: Jupiter documents no devnet swap programs.
 *
 * Flow: the wallet signs only (`solana:signTransaction`, so RFQ routes that need the market maker's co-signature
 * work), then `finish` hands the signed bytes to /execute, which lands it.
 */
export const JUPITER_BASE = "https://api.jup.ag/swap/v2";
export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

interface OrderResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct?: string | number;
  routePlan?: { swapInfo?: { label?: string }; percent?: number }[];
  router?: string;
  transaction: string | null;
  requestId: string;
  lastValidBlockHeight?: number | string;
  errorCode?: number;
  errorMessage?: string;
}

interface ExecuteResponse {
  status: "Success" | "Failed";
  signature?: string;
  code?: number;
  error?: string;
}

/** Programs a Jupiter-built transaction may call for the wallet to describe it (after a successful dry run). */

function plainOrderError(o: OrderResponse): ClipError {
  const m = (o.errorMessage ?? "").toLowerCase();
  if (m.includes("insufficient")) return new ClipError("You don't have enough for this swap, including the network fee.", "swap/insufficient");
  if (m.includes("route") || m.includes("liquidity")) return new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
  return new ClipError("Jupiter couldn't prepare this swap. Try again in a moment.", "swap/jupiter-order");
}

export class JupiterSwap implements SwapProvider {
  readonly id = "jupiter";
  readonly name = "Jupiter";
  readonly family = "solana" as const;

  constructor(private readonly opts: { apiKey?: string; base?: string } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "solana") return { code: "swap/wrong-family", message: "Jupiter only swaps Solana tokens." };
    if (clusterOf(network.id) !== "mainnet") return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  private headers(): Record<string, string> {
    return this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {};
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const u = new URL(`${this.opts.base ?? JUPITER_BASE}/order`);
    u.searchParams.set("inputMint", req.sell.address ?? NATIVE_SOL_MINT);
    u.searchParams.set("outputMint", req.buy.address ?? NATIVE_SOL_MINT);
    u.searchParams.set("amount", req.amount);
    u.searchParams.set("taker", ctx.account.address);
    u.searchParams.set("slippageBps", String(req.slippageBps));
    const o = await fetchJson<OrderResponse>(ctx.fetch, u.toString(), "Jupiter", { headers: this.headers() });
    if (!o.transaction) throw plainOrderError(o);
    const labels = (o.routePlan ?? []).map((r) => r.swapInfo?.label).filter((l): l is string => !!l);
    const q: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: o.inAmount,
      buyAmount: o.outAmount,
      minBuyAmount: o.otherAmountThreshold,
      slippageBps: o.slippageBps ?? req.slippageBps,
      route: [...new Set(labels.length ? labels : [o.router ?? "Jupiter"])],
      expiresAt: Date.now() + 30_000,
      data: { transaction: o.transaction, requestId: o.requestId },
    };
    const impact = Number(o.priceImpactPct);
    // Jupiter reports priceImpactPct as a fraction string ("0.0012" = 0.12 %).
    if (o.priceImpactPct !== undefined && Number.isFinite(impact)) q.priceImpactPct = Math.abs(impact) * 100;
    return q;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const { transaction, requestId } = quote.data as { transaction: string; requestId: string };
    const cluster = clusterOf(ctx.network.id);
    const request = {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected" as const,
      family: "solana" as const,
      networkId: ctx.network.id,
      method: "solana:signTransaction",
      params: { inputs: [{ account: ctx.account.address, transaction, chain: cluster ? `solana:${cluster}` : ctx.network.id }] },
    };
    return [
      {
        title: `Swap ${quote.sell.symbol} for ${quote.buy.symbol}`,
        request,
        finish: async (result) => {
          const signed = Array.isArray(result) ? (result[0] as { signedTransaction?: string } | undefined)?.signedTransaction : undefined;
          if (!signed) throw new ClipError("The swap wasn't signed. Nothing was sent.", "swap/not-signed");
          const r = await fetchJson<ExecuteResponse>(ctx.fetch, `${this.opts.base ?? JUPITER_BASE}/execute`, "Jupiter", {
            body: { signedTransaction: signed, requestId },
            headers: this.headers(),
            timeoutMs: 60_000,
          });
          if (r.status !== "Success") {
            throw new ClipError("The swap didn't go through, so nothing left your balance except possibly the network fee. Try again.", `swap/jupiter-${r.code ?? "failed"}`);
          }
          return { signature: r.signature };
        },
      },
    ];
  }
}
