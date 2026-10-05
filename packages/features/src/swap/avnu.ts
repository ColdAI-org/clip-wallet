import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN, msg, titled } from "@clip-wallet/core";
import {
  AVNU_EXCHANGE,
  STARKNET_METHODS,
  STRK_ADDRESS,
  approveCall,
  chainOf,
  parseApprove,
  parseMultiRouteSwap,
  sameStarknetAddress,
} from "@clip-wallet/chains-starknet";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * AVNU on Starknet (keyless public API; the official avnu-sdk `src/constants.ts` uses SWAP_API_VERSION "v3"):
 *   GET  https://starknet.api.avnu.fi/swap/v3/quotes?sellTokenAddress&buyTokenAddress&sellAmount(hex)&takerAddress&size=1
 *        → [{ quoteId, sellAmount, buyAmount, routes[].name, fee, … }] (best first)
 *   POST https://starknet.api.avnu.fi/swap/v3/build { quoteId, takerAddress, slippage (0..1), includeApprove: false }
 *        → { chainId, calls: [{ contractAddress, entrypoint: "multi_route_swap", calldata }] }
 * Sepolia host: https://sepolia.api.avnu.fi (same paths). On 2026-10-03 it answered `[]` for every pair (no
 * liquidity sources), so Sepolia is off unless `sepolia: true` is passed.
 *
 * The wallet doesn't take AVNU's calls on trust: it parses the returned calldata (chains-starknet `parseMultiRouteSwap`)
 * and refuses unless it's exactly one `multi_route_swap` on the allow-listed AVNU Exchange for this network
 * (avnu-contracts-v2 README), selling exactly the quoted token and amount, buying the quoted token, with
 * beneficiary = you, no integrator fee, and an on-chain minimum output at least quote × (1 − slippage). The wallet
 * adds its own ERC-20 approve for exactly the sell amount (spender = the Exchange) in the same multicall, so the
 * permission and the swap land together or not at all.
 */
export const AVNU_API = { SN_MAIN: "https://starknet.api.avnu.fi", SN_SEPOLIA: "https://sepolia.api.avnu.fi" } as const;

interface AvnuQuote {
  quoteId: string;
  sellTokenAddress: string;
  sellAmount: string;
  buyTokenAddress: string;
  buyAmount: string;
  chainId?: string;
  routes?: { name: string; percent?: number }[];
}

interface AvnuBuild {
  chainId?: string;
  calls: { contractAddress: string; entrypoint: string; calldata: string[] }[];
}

interface AvnuData {
  quoteId: string;
  sellToken: string;
  buyToken: string;
}

const hexAmount = (v: string | bigint) => `0x${BigInt(v).toString(16)}`;
const stopped = () => new ClipError("This swap quote looks wrong, so Clip Wallet stopped it.", "swap/unexpected-target");
const noRoute = () => new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");

export interface AvnuExpect {
  me: string;
  exchange: string;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  minOut: bigint;
}

/** Checks a built AVNU multicall field by field: exact approve to the Exchange, then the allow-listed swap. */
export function checkAvnuRequest(request: DappRequest, e: AvnuExpect): boolean {
  try {
    const calls = (request.params as { calls?: { contract_address: string; entry_point: string; calldata: string[] }[] }).calls;
    if (!calls || calls.length !== 2) return false;
    const [ap, sw] = calls as [(typeof calls)[0], (typeof calls)[0]];
    if (ap.entry_point !== "approve" || !sameStarknetAddress(ap.contract_address, e.sellToken)) return false;
    const a = parseApprove(ap.calldata);
    if (!sameStarknetAddress(a.spender, e.exchange) || a.amount !== e.sellAmount) return false;
    if (sw.entry_point !== "multi_route_swap" || !sameStarknetAddress(sw.contract_address, e.exchange)) return false;
    const s = parseMultiRouteSwap(sw.calldata);
    return (
      sameStarknetAddress(s.sellToken, e.sellToken) &&
      s.sellAmount === e.sellAmount &&
      sameStarknetAddress(s.buyToken, e.buyToken) &&
      sameStarknetAddress(s.beneficiary, e.me) &&
      s.buyMinAmount >= e.minOut &&
      s.buyMinAmount > 0n &&
      s.integratorFeeBps === 0n &&
      s.routesLen > 0
    );
  } catch {
    return false;
  }
}

export class AvnuSwap implements SwapProvider {
  readonly id = "avnu";
  readonly name = "AVNU";
  readonly family = "starknet" as const;

  constructor(private readonly opts: { base?: string; sepolia?: boolean; now?: () => number } = {}) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "starknet") return { code: "swap/wrong-family", message: "AVNU only swaps Starknet tokens." };
    const c = chainOf(network.id);
    if (!c) return { code: "swap/wrong-family", message: "AVNU only swaps Starknet tokens." };
    if (c === "SN_SEPOLIA" && !this.opts.sepolia) return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  private ctxInfo(ctx: ChainContext) {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    const chain = chainOf(ctx.network.id)!;
    return { chain, base: this.opts.base ?? AVNU_API[chain], exchange: AVNU_EXCHANGE[chain] };
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const { base } = this.ctxInfo(ctx);
    if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "swap/bad-amount");
    const sellToken = req.sell.address ?? STRK_ADDRESS;
    const buyToken = req.buy.address ?? STRK_ADDRESS;
    if (sameStarknetAddress(sellToken, buyToken)) throw new ClipError("Pick two different tokens to swap.", "swap/same-token");
    const u = new URL(`${base}/swap/v3/quotes`);
    u.searchParams.set("sellTokenAddress", sellToken);
    u.searchParams.set("buyTokenAddress", buyToken);
    u.searchParams.set("sellAmount", hexAmount(req.amount));
    u.searchParams.set("takerAddress", ctx.account.address);
    u.searchParams.set("size", "1");
    const list = await fetchJson<AvnuQuote[]>(ctx.fetch, u.toString(), "AVNU");
    const q = Array.isArray(list) ? list[0] : undefined;
    if (!q || !q.buyAmount || BigInt(q.buyAmount) <= 0n) throw noRoute();
    if (!sameStarknetAddress(q.sellTokenAddress, sellToken) || !sameStarknetAddress(q.buyTokenAddress, buyToken) || BigInt(q.sellAmount) !== BigInt(req.amount)) throw stopped();
    const buyAmount = BigInt(q.buyAmount);
    const minBuy = (buyAmount * BigInt(10_000 - req.slippageBps)) / 10_000n;
    const route = [...new Set((q.routes ?? []).map((r) => r.name).filter(Boolean))];
    const { exchange } = this.ctxInfo(ctx);
    return {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: buyAmount.toString(),
      minBuyAmount: minBuy.toString(),
      slippageBps: req.slippageBps,
      route: route.length ? route : ["AVNU"],
      approval: { spender: exchange, spenderName: "AVNU", amount: req.amount },
      expiresAt: this.now() + 30_000,
      data: { quoteId: q.quoteId, sellToken, buyToken } satisfies AvnuData,
    };
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const { base, exchange } = this.ctxInfo(ctx);
    const d = quote.data as AvnuData;
    const me = ctx.account.address;
    const sellAmount = BigInt(quote.sellAmount);
    const minOut = BigInt(quote.minBuyAmount);
    const b = await fetchJson<AvnuBuild>(ctx.fetch, `${base}/swap/v3/build`, "AVNU", {
      body: { quoteId: d.quoteId, takerAddress: me, slippage: quote.slippageBps / 10_000, includeApprove: false },
    });
    // Parse AVNU's answer back; keep only the swap call, and only if it's exactly what was quoted.
    if (!Array.isArray(b.calls) || b.calls.length !== 1) throw stopped();
    const c = b.calls[0]!;
    if (c.entrypoint !== "multi_route_swap" || !sameStarknetAddress(c.contractAddress, exchange)) throw stopped();
    const expect: AvnuExpect = { me, exchange, sellToken: d.sellToken, buyToken: d.buyToken, sellAmount, minOut };
    const approve = approveCall(d.sellToken, exchange, sellAmount);
    const request: DappRequest = {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "starknet",
      networkId: ctx.network.id,
      method: STARKNET_METHODS.addInvokeTransaction,
      params: {
        calls: [
          { contract_address: approve.contractAddress, entry_point: approve.entrypoint, calldata: approve.calldata },
          { contract_address: c.contractAddress, entry_point: c.entrypoint, calldata: c.calldata.map((x) => hexAmount(x)) },
        ],
      },
    };
    if (!checkAvnuRequest(request, expect)) throw stopped();
    const amt = `${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol}`;
    return [
      {
        ...titled(msg("bg.req.swap", { pay: `${amt}`, get: `~${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}` })),
        lines: [
          { label: "You get at least", value: `${formatUnits(quote.minBuyAmount, quote.buy.decimals)} ${quote.buy.symbol}` },
          { label: "Through", value: quote.route.join(" + ") },
          { label: "Allows AVNU to use", value: `Exactly ${amt}, for this swap only` },
        ],
        request,
        verify: (r) => checkAvnuRequest(r, expect),
      },
    ];
  }
}
