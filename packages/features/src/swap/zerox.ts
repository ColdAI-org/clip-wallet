import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import { encodeFunctionData, erc20Abi, getAddress, isAddressEqual, toHex } from "viem";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * 0x Swap API v2, AllowanceHolder flow (https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getquote.md):
 *   GET https://api.0x.org/swap/allowance-holder/quote?chainId&sellToken&buyToken&sellAmount&taker&slippageBps
 *   headers: 0x-api-key, 0x-version: v2
 *   → liquidityAvailable, buyAmount, minBuyAmount, issues.allowance{actual,spender}, issues.balance, route.fills[].source,
 *     transaction{to,data,value,gas,gasPrice}
 * Needs an API key (no documented free plan): read from config, never committed. Without it, 0x is off with a
 * plain message. Supported chains are mainnets only (https://docs.0x.org/docs/introduction/supported-chains.md).
 * Native coin placeholder 0xEeee…EEeE. AllowanceHolder addresses: https://docs.0x.org/docs/core-concepts/contracts.md.
 */
export const ZEROX_BASE = "https://api.0x.org";
export const NATIVE_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const ALLOWANCE_HOLDER_CANCUN = "0x0000000000001fF3684f28c67538d4D072C22734";
export const ALLOWANCE_HOLDER_SHANGHAI = "0x0000000000005E88410CcDFaDe4a5EfaE4b49562";

/** Chain ids 0x v2 lists (subset this wallet can carry) → AllowanceHolder. Mantle (5000) is Shanghai. */
export const ZEROX_CHAINS: Record<number, string> = {
  1: ALLOWANCE_HOLDER_CANCUN,
  10: ALLOWANCE_HOLDER_CANCUN,
  56: ALLOWANCE_HOLDER_CANCUN,
  130: ALLOWANCE_HOLDER_CANCUN,
  137: ALLOWANCE_HOLDER_CANCUN,
  146: ALLOWANCE_HOLDER_CANCUN,
  480: ALLOWANCE_HOLDER_CANCUN,
  5000: ALLOWANCE_HOLDER_SHANGHAI,
  8453: ALLOWANCE_HOLDER_CANCUN,
  42161: ALLOWANCE_HOLDER_CANCUN,
  43114: ALLOWANCE_HOLDER_CANCUN,
  59144: ALLOWANCE_HOLDER_CANCUN,
  534352: ALLOWANCE_HOLDER_CANCUN,
};

interface ZeroExQuote {
  liquidityAvailable: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  sellAmount?: string;
  issues?: {
    allowance?: { actual: string; spender: string } | null;
    balance?: { token: string; actual: string; expected: string } | null;
  };
  route?: { fills?: { source: string; proportionBps?: string }[] };
  transaction?: { to: string; data: string; value: string; gas?: string | null; gasPrice?: string };
}

export class ZeroExSwap implements SwapProvider {
  readonly id = "0x";
  readonly name = "0x";
  readonly family = "evm" as const;

  constructor(private readonly opts: { apiKey?: string; base?: string } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "evm") return { code: "swap/wrong-family", message: "0x only swaps on EVM networks." };
    if (!this.opts.apiKey) return { code: "swap/not-configured", message: "Swapping these tokens isn't switched on in this build." };
    if (!network.chainId || !ZEROX_CHAINS[network.chainId]) return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    const chainId = ctx.network.chainId!;
    const u = new URL(`${this.opts.base ?? ZEROX_BASE}/swap/allowance-holder/quote`);
    u.searchParams.set("chainId", String(chainId));
    u.searchParams.set("sellToken", req.sell.address ?? NATIVE_PLACEHOLDER);
    u.searchParams.set("buyToken", req.buy.address ?? NATIVE_PLACEHOLDER);
    u.searchParams.set("sellAmount", req.amount);
    u.searchParams.set("taker", ctx.account.address);
    u.searchParams.set("slippageBps", String(req.slippageBps));
    const q = await fetchJson<ZeroExQuote>(ctx.fetch, u.toString(), "0x", { headers: { "0x-api-key": this.opts.apiKey!, "0x-version": "v2" } });
    if (!q.liquidityAvailable || !q.buyAmount || !q.transaction) {
      throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
    }
    if (q.issues?.balance) throw new ClipError(`You don't have enough ${req.sell.symbol} for this swap.`, "swap/insufficient");
    const holder = ZEROX_CHAINS[chainId]!;
    // Safety: the swap must go to 0x's AllowanceHolder, and any permission must be for it.
    if (!isAddressEqual(getAddress(q.transaction.to), getAddress(holder))) {
      throw new ClipError("This swap quote looks wrong, so Clip Wallet stopped it.", "swap/unexpected-target");
    }
    const sources = [...new Set((q.route?.fills ?? []).map((f) => f.source.replace(/_/g, " ")))];
    const quote: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: q.sellAmount ?? req.amount,
      buyAmount: q.buyAmount,
      minBuyAmount: q.minBuyAmount ?? q.buyAmount,
      slippageBps: req.slippageBps,
      route: sources.length ? sources : ["0x"],
      expiresAt: Date.now() + 30_000,
      data: { transaction: q.transaction },
    };
    const allowance = q.issues?.allowance;
    if (allowance && req.sell.address) {
      if (!isAddressEqual(getAddress(allowance.spender), getAddress(holder))) {
        throw new ClipError("This swap asks for a permission Clip Wallet doesn't expect, so it was stopped.", "swap/unexpected-spender");
      }
      if (BigInt(allowance.actual) < BigInt(quote.sellAmount)) quote.approval = { spender: holder, spenderName: "0x", amount: quote.sellAmount };
    }
    return quote;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const from = getAddress(ctx.account.address);
    const tx = (quote.data as { transaction: NonNullable<ZeroExQuote["transaction"]> }).transaction;
    const holder = ZEROX_CHAINS[ctx.network.chainId!]!;
    const mk = (params: Record<string, string>): DappRequest => ({
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "evm",
      networkId: ctx.network.id,
      method: "eth_sendTransaction",
      params: [params],
    });
    const steps: Step[] = [];
    if (quote.approval && quote.sell.address) {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(quote.approval.spender), BigInt(quote.approval.amount)] });
      steps.push({
        title: `Allow 0x to use exactly ${formatUnits(quote.approval.amount, quote.sell.decimals)} ${quote.sell.symbol}`,
        lines: [{ label: "Limit", value: "Only this amount, for this swap" }],
        request: mk({ from, to: getAddress(quote.sell.address), value: "0x0", data }),
      });
    }
    const swap: Record<string, string> = { from, to: getAddress(tx.to), data: tx.data, value: toHex(BigInt(tx.value || "0")) };
    if (tx.gas) swap.gas = toHex(BigInt(tx.gas));
    steps.push({
      title: `Swap ${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol} for ~${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}`,
      lines: [{ label: "You get at least", value: `${formatUnits(quote.minBuyAmount, quote.buy.decimals)} ${quote.buy.symbol}` }],
      request: mk(swap),
      verify: (r) => {
        const p = (r.params as { to?: string }[] | undefined)?.[0];
        return !!p?.to && isAddressEqual(getAddress(p.to), getAddress(holder));
      },
    });
    return steps;
  }
}
