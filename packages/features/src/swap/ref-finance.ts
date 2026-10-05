import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN, msg, titled } from "@clip-wallet/core";
import {
  NEAR_METHODS,
  NearRpc,
  REF_CONTRACTS,
  WRAP_CONTRACTS,
  checkRefRoute,
  createNearModule,
  networkName,
  parseRefSwapMsg,
  refSwapTransactions,
  type NearModule,
  type RefSwapAction,
} from "@clip-wallet/chains-near";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Ref Finance (Rhea) v2 exchange on NEAR. The wallet builds the transactions itself (chains-near ref.ts):
 * NEP-145 registration with the output token if needed, then one transaction to the input token
 * ([register with wrap.near, near_deposit] when selling NEAR, then ft_transfer_call to the exchange with the swap
 * message). Every route ends with a `min_amount_out` the exchange enforces, or the whole swap is undone.
 *
 * Quotes:
 *  - mainnet: Ref's keyless smart router (ref-finance/ref-ui src/services/smartRouterFromServer.ts):
 *    GET https://smartrouter.ref.finance/findPath?amountIn&tokenIn&tokenOut&pathDeep=3&slippage=<fraction>
 *    → { result_code: 0, result_data: { routes: [{ pools: [{ pool_id, token_in, token_out, amount_in, min_amount_out }],
 *        amount_in, min_amount_out }], contract_in, contract_out, amount_in, amount_out } }.
 *    Only the pools come from the router; the route is checked (start, hops, end, total, minimums ≥ our slippage
 *    floor) and the exchange and wrap contracts are fixed per network.
 *  - testnet: the router's testnet host (smartroutertest.refburrow.top) answered 502 on 2026-10-03, so the wallet
 *    quotes known testnet pools on-chain with the exchange's `get_pool` + `get_return` views (pools 1845 and 2206
 *    hold wNEAR / Circle testnet USDC on ref-finance-101.testnet). Other testnet pairs aren't offered.
 */
export const REF_ROUTER = "https://smartrouter.ref.finance";
export const REF_TESTNET_POOLS: Record<string, number[]> = { "near:testnet": [1845, 2206] };
const NEAR_RESERVE = 50_000_000_000_000_000_000_000n;

interface RouterPool {
  pool_id: string | number;
  token_in: string;
  token_out: string;
  amount_in?: string;
  min_amount_out?: string;
}

interface RouterResponse {
  result_code: number;
  result_message?: string;
  result_data?: {
    routes?: { pools: RouterPool[] }[];
    contract_in?: string;
    contract_out?: string;
    amount_in?: string;
    amount_out?: string;
  };
}

interface QuoteData {
  tokenIn: string;
  tokenOut: string;
  actions: RefSwapAction[];
}

const unsupported = () => new ClipError("Swapping these tokens isn't available in this test version yet.", "swap/unsupported-pair");
const noRoute = () => new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");

export class RefFinanceSwap implements SwapProvider {
  readonly id = "ref-finance";
  readonly name = "Ref Finance";
  readonly family = "near" as const;
  private readonly module: NearModule;

  constructor(private readonly opts: { routerBase?: string; testnetPools?: Record<string, number[]>; module?: NearModule } = {}) {
    this.module = opts.module ?? createNearModule();
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "near" || !networkName(network.id)) return { code: "swap/wrong-family", message: "Ref Finance only swaps NEAR tokens." };
    if (!network.rpcUrls.length) return { code: "swap/no-rpc", message: "Swapping isn't available right now." };
    return null;
  }

  private rpc(ctx: ChainContext): NearRpc {
    return new NearRpc(ctx.network.rpcUrls[0]!, ctx.fetch);
  }

  private tokens(req: SwapQuoteRequest, ctx: ChainContext): { tokenIn: string; tokenOut: string } {
    const n = networkName(ctx.network.id);
    if (!n) throw unsupported();
    const tokenIn = req.sell.address ?? WRAP_CONTRACTS[n];
    const tokenOut = req.buy.address ?? WRAP_CONTRACTS[n];
    if (tokenIn === tokenOut) throw new ClipError("Pick two different tokens to swap.", "swap/same-token");
    return { tokenIn, tokenOut };
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const { tokenIn, tokenOut } = this.tokens(req, ctx);
    const amount = BigInt(req.amount);
    if (amount <= 0n) throw new ClipError("Enter an amount to swap.", "swap/bad-amount");
    const found = networkName(ctx.network.id) === "testnet" ? await this.onChainQuote(ctx, tokenIn, tokenOut, amount, req.slippageBps) : await this.routerQuote(ctx, tokenIn, tokenOut, amount, req.slippageBps);
    const checked = checkRefRoute(found.actions, tokenIn, tokenOut, amount);
    if ("error" in checked) throw new ClipError("Ref Finance's route didn't check out, so Clip Wallet won't use it. Try again.", "swap/bad-route", checked.error);
    if (checked.minOut < minOut(found.amountOut, req.slippageBps) - BigInt(found.actions.length)) {
      throw new ClipError("Ref Finance's route didn't check out, so Clip Wallet won't use it. Try again.", "swap/bad-route", "minimum below slippage floor");
    }
    const data: QuoteData = { tokenIn, tokenOut, actions: found.actions };
    return {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: amount.toString(),
      buyAmount: found.amountOut.toString(),
      minBuyAmount: checked.minOut.toString(),
      slippageBps: req.slippageBps,
      route: ["Ref Finance"],
      expiresAt: Date.now() + 30_000,
      data,
    };
  }

  private async routerQuote(ctx: ChainContext, tokenIn: string, tokenOut: string, amount: bigint, bps: number): Promise<{ actions: RefSwapAction[]; amountOut: bigint }> {
    const u = new URL(`${this.opts.routerBase ?? REF_ROUTER}/findPath`);
    u.searchParams.set("amountIn", amount.toString());
    u.searchParams.set("tokenIn", tokenIn);
    u.searchParams.set("tokenOut", tokenOut);
    u.searchParams.set("pathDeep", "3");
    u.searchParams.set("slippage", String(bps / 10_000));
    const r = await fetchJson<RouterResponse>(ctx.fetch, u.toString(), "Ref Finance");
    const d = r.result_data;
    if (r.result_code !== 0 || !d?.routes?.length || !d.amount_out || !/^\d+$/.test(d.amount_out) || BigInt(d.amount_out) <= 0n) throw noRoute();
    if (d.contract_in !== tokenIn || d.contract_out !== tokenOut || d.amount_in !== amount.toString()) {
      throw new ClipError("Ref Finance's route didn't check out, so Clip Wallet won't use it. Try again.", "swap/bad-route", "contracts or amount differ");
    }
    const actions: RefSwapAction[] = [];
    for (const route of d.routes) {
      for (const p of route.pools) {
        const a: Record<string, unknown> = { pool_id: Number(p.pool_id), token_in: p.token_in, token_out: p.token_out, min_amount_out: p.min_amount_out ?? "0" };
        if (p.amount_in && /^\d+$/.test(p.amount_in) && BigInt(p.amount_in) > 0n) a.amount_in = p.amount_in;
        actions.push(a as unknown as RefSwapAction);
      }
    }
    // Same shape checks the approval screen uses (pool ids, account ids, integer strings).
    const parsed = parseRefSwapMsg(JSON.stringify({ actions }));
    if (!parsed) throw new ClipError("Ref Finance's route didn't check out, so Clip Wallet won't use it. Try again.", "swap/bad-route", "malformed actions");
    return { actions: parsed.actions, amountOut: BigInt(d.amount_out) };
  }

  private async onChainQuote(ctx: ChainContext, tokenIn: string, tokenOut: string, amount: bigint, bps: number): Promise<{ actions: RefSwapAction[]; amountOut: bigint }> {
    const n = networkName(ctx.network.id)!;
    const ref = REF_CONTRACTS[n];
    const ids = (this.opts.testnetPools ?? REF_TESTNET_POOLS)[ctx.network.id] ?? [];
    const rpc = this.rpc(ctx);
    let best: { pool: number; out: bigint } | undefined;
    for (const pool of ids) {
      try {
        const info = await rpc.view<{ pool_kind: string; token_account_ids: string[] }>(ref, "get_pool", { pool_id: pool });
        if (info.pool_kind !== "SIMPLE_POOL" || !info.token_account_ids.includes(tokenIn) || !info.token_account_ids.includes(tokenOut)) continue;
        const out = BigInt(await rpc.view<string>(ref, "get_return", { pool_id: pool, token_in: tokenIn, amount_in: amount.toString(), token_out: tokenOut }));
        if (out > 0n && (!best || out > best.out)) best = { pool, out };
      } catch {
        // A pool that can't be read (or can't take this amount) is skipped.
      }
    }
    if (!best) {
      if (!ids.length) throw unsupported();
      throw new ClipError("Swapping these tokens isn't available in this test version yet, or not for this amount.", "swap/unsupported-pair");
    }
    return {
      actions: [{ pool_id: best.pool, token_in: tokenIn, token_out: tokenOut, amount_in: amount.toString(), min_amount_out: minOut(best.out, bps).toString() }],
      amountOut: best.out,
    };
  }

  /** NEP-145: null when the account isn't registered with `contract` yet, else nothing to do. */
  private async registration(rpc: NearRpc, contract: string, me: string): Promise<{ contract: string; deposit: string } | null> {
    const bal = await rpc.view<unknown>(contract, "storage_balance_of", { account_id: me });
    if (bal !== null) return null;
    const bounds = await rpc.view<{ min: string }>(contract, "storage_balance_bounds", {});
    return { contract, deposit: BigInt(bounds.min).toString() };
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const { tokenIn, tokenOut, actions } = quote.data as QuoteData;
    const n = networkName(ctx.network.id);
    if (!n) throw unsupported();
    const wrap = WRAP_CONTRACTS[n];
    const me = ctx.account.address;
    const rpc = this.rpc(ctx);
    const amount = BigInt(quote.sellAmount);
    const sellNative = !quote.sell.address;
    let register: { contract: string; deposit: string }[];
    try {
      const regs = await Promise.all([this.registration(rpc, tokenOut, me), sellNative ? this.registration(rpc, wrap, me) : Promise.resolve(null)]);
      register = regs.filter((r): r is { contract: string; deposit: string } => !!r);
      if (sellNative) {
        const bal = await this.module.getNearBalance(ctx);
        const deposits = register.reduce((t, r) => t + BigInt(r.deposit), 0n);
        if (amount + deposits + NEAR_RESERVE > bal.available) throw new ClipError("You don't have enough NEAR for this swap, including network fees.", "swap/insufficient");
      } else {
        const have = BigInt(await rpc.view<string>(tokenIn, "ft_balance_of", { account_id: me }));
        if (have < amount) throw new ClipError(msg("bg.err.notEnoughForSwap", { symbol: quote.sell.symbol }), "swap/insufficient");
      }
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("Couldn't reach NEAR right now. Check your connection and try again.", "swap/unreachable", e);
    }
    let txs;
    try {
      txs = refSwapTransactions({ networkId: ctx.network.id, sell: quote.sell.address ?? null, buy: quote.buy.address ?? null, amountIn: amount.toString(), actions, register }, me);
    } catch (e) {
      throw new ClipError("Ref Finance's route didn't check out, so Clip Wallet won't use it. Try again.", "swap/bad-route", e);
    }
    const base = { id: randomId(), origin: WALLET_ORIGIN, via: "injected" as const, family: "near" as const, networkId: ctx.network.id };
    const request: DappRequest =
      txs.length === 1
        ? { ...base, method: NEAR_METHODS.signAndSendTransaction, params: { signerId: me, receiverId: txs[0]!.receiverId, actions: txs[0]!.actions } }
        : { ...base, method: NEAR_METHODS.signAndSendTransactions, params: { transactions: txs.map((t) => ({ signerId: me, receiverId: t.receiverId, actions: t.actions })) } };
    const lines = [{ label: "Exchange", value: "Ref Finance" }];
    const outReg = register.find((r) => r.contract === tokenOut);
    if (outReg) lines.push({ label: "First", value: `Sets up ${quote.buy.symbol === "NEAR" ? "wNEAR" : quote.buy.symbol} on your account (${formatUnits(BigInt(outReg.deposit), 24)} NEAR storage deposit)` });
    return [
      {
        ...titled(msg("bg.req.swap", { pay: `${formatUnits(amount, quote.sell.decimals)} ${quote.sell.symbol}`, get: `${quote.buy.symbol}` })),
        request,
        lines,
        verify: (r) => verifyRefRequest(r, ctx.network.id, me, tokenIn, tokenOut),
      },
    ];
  }
}

/**
 * Re-checks the bytes the approval screen will show: only the input/output token contracts are called, only with
 * storage_deposit / near_deposit / ft_transfer_call, the transfer goes to this network's exchange, and its
 * message is a route from the input to the output token.
 */
export function verifyRefRequest(r: DappRequest, networkId: string, me: string, tokenIn: string, tokenOut: string): boolean {
  const n = networkName(networkId);
  if (!n || r.family !== "near") return false;
  const p = r.params as { transactions?: unknown[]; receiverId?: unknown; actions?: unknown; signerId?: unknown };
  const txs = (r.method === NEAR_METHODS.signAndSendTransactions ? p.transactions : r.method === NEAR_METHODS.signAndSendTransaction ? [p] : null) as
    | { signerId?: unknown; receiverId?: unknown; actions?: unknown }[]
    | null;
  if (!txs?.length) return false;
  let swaps = 0;
  for (const t of txs) {
    if (t.signerId !== me || (t.receiverId !== tokenIn && t.receiverId !== tokenOut) || !Array.isArray(t.actions)) return false;
    for (const a of t.actions as { type?: unknown; params?: { methodName?: unknown; args?: Record<string, unknown>; deposit?: unknown } }[]) {
      if (a.type !== "FunctionCall" || !a.params) return false;
      const m = a.params.methodName;
      if (m === "storage_deposit") {
        if (a.params.args?.account_id !== me) return false;
      } else if (m === "near_deposit") {
        if (t.receiverId !== WRAP_CONTRACTS[n]) return false;
      } else if (m === "ft_transfer_call") {
        const args = a.params.args ?? {};
        if (t.receiverId !== tokenIn || args.receiver_id !== REF_CONTRACTS[n] || a.params.deposit !== "1" || typeof args.amount !== "string") return false;
        const msg = parseRefSwapMsg(args.msg);
        if (!msg || "error" in checkRefRoute(msg.actions, tokenIn, tokenOut, BigInt(args.amount))) return false;
        swaps++;
      } else return false;
    }
  }
  return swaps === 1;
}
