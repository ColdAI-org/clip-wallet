import { type AssetRef, type ChainContext, ClipError, type DappRequest, type Network } from "@clip-wallet/core";
import {
  type CpmmState,
  LIQUIDITY_BAKING,
  cpmmTokenToXtz,
  cpmmTokenToXtzOp,
  cpmmXtzToToken,
  cpmmXtzToTokenOp,
  readCpmm,
  rpcFor,
  spendPermissionOps,
  tezosSendRequest,
  tokenRef,
} from "@clip-wallet/chains-tezos";
import type { Step } from "../steps.js";
import { formatUnits } from "../util.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Sirius DEX on Tezos: the protocol's own Liquidity Baking CPMM (XTZ ↔ tzBTC). Keyless and on-chain:
 *  - the contract address comes from the node (GET …/context/liquidity_baking/cpmm_address) and must equal the
 *    allow-listed one in chains-tezos LIQUIDITY_BAKING; its token must be the allow-listed tzBTC (FA1.2);
 *  - the quote is the contract's own integer maths on its current storage (cpmm.mligo in tezos/tezos);
 *  - the wallet builds the operations itself (chains-tezos builders), one atomic tezos_send batch:
 *      XTZ → tzBTC: xtzToToken(to = you, minTokensBought, deadline) with the XTZ attached;
 *      tzBTC → XTZ: approve(cpmm, 0), approve(cpmm, exact amount), tokenToXtz(to = you, tokensSold, minXtzBought, deadline).
 *    The minimum is enforced by the contract (it fails with "TOKENS_BOUGHT_MUST_BE_GREATER…" otherwise), the deadline
 *    is 10 minutes, and the allowance ends at 0 because the swap uses exactly the approved amount.
 *
 * Why not an aggregator: 3Route's API (api.3route.io, OpenAPI 2026-09-25) now serves EVM chains only (incl. Etherlink)
 * and is pay-per-call (x402/MPP); Plenty's API hosts don't resolve. Shadownet's CPMM pool is empty (1 token unit), so
 * this is mainnet-only.
 */
const DEADLINE_S = 600;
const QUOTE_TTL_MS = 30_000;

interface SiriusData {
  cpmm: string;
  token: string;
  direction: "xtz-to-token" | "token-to-xtz";
}

const isXtz = (a: AssetRef) => a.key === "xtz" && !a.address;

export class SiriusSwap implements SwapProvider {
  readonly id = "sirius";
  readonly name = "Sirius";
  readonly family = "tezos" as const;

  constructor(private readonly opts: { now?: () => number } = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "tezos") return { code: "swap/wrong-family", message: "Sirius only swaps XTZ and tzBTC." };
    if (network.testnet) return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    if (!LIQUIDITY_BAKING[network.id] || !network.rpcUrls.length) return { code: "swap/unsupported-network", message: "Swapping these tokens isn't available here yet." };
    return null;
  }

  private pair(req: Pick<SwapQuoteRequest, "sell" | "buy">, token: string): SiriusData["direction"] {
    const isToken = (a: AssetRef) => {
      const r = tokenRef(a);
      return !!r && r.contract === token && r.tokenId === "0";
    };
    if (isXtz(req.sell) && isToken(req.buy)) return "xtz-to-token";
    if (isToken(req.sell) && isXtz(req.buy)) return "token-to-xtz";
    throw new ClipError("Sirius only swaps XTZ and tzBTC.", "swap/no-route");
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    const lb = LIQUIDITY_BAKING[ctx.network.id]!;
    const direction = this.pair(req, lb.token);
    if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "swap/bad-amount");
    const amount = BigInt(req.amount);
    const state = await readCpmm(rpcFor(ctx));
    this.check(state, lb);
    const out = direction === "xtz-to-token" ? cpmmXtzToToken(amount, state) : cpmmTokenToXtz(amount, state);
    if (out <= 0n) throw new ClipError("That amount is too small to swap. Try a bigger amount.", "swap/too-small");
    const [poolIn, poolOut] = direction === "xtz-to-token" ? [state.xtzPool, state.tokenPool] : [state.tokenPool, state.xtzPool];
    if (amount * 10n > poolIn) throw new ClipError("That's too large for this exchange right now. Try a smaller amount.", "swap/too-large");
    const spot = Number(amount) * (Number(poolOut) / Number(poolIn));
    const quote: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: amount.toString(),
      buyAmount: out.toString(),
      minBuyAmount: minOut(out, req.slippageBps).toString(),
      slippageBps: req.slippageBps,
      route: ["Sirius"],
      expiresAt: this.now() + QUOTE_TTL_MS,
      data: { cpmm: state.address, token: lb.token, direction } satisfies SiriusData,
    };
    if (spot > 0) quote.priceImpactPct = Math.max(0, (1 - Number(out) / spot) * 100);
    if (direction === "token-to-xtz") quote.approval = { spender: state.address, spenderName: "Sirius", amount: amount.toString() };
    return quote;
  }

  private check(state: CpmmState, lb: { cpmm: string; token: string }): void {
    if (state.address !== lb.cpmm || state.tokenAddress !== lb.token) {
      throw new ClipError("This exchange doesn't look like the one Clip Wallet expects, so it stopped.", "swap/unexpected-target");
    }
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const lb = LIQUIDITY_BAKING[ctx.network.id];
    const d = quote.data as SiriusData | undefined;
    if (!lb || !d || quote.networkId !== ctx.network.id || d.cpmm !== lb.cpmm || d.token !== lb.token || this.pair(quote, lb.token) !== d.direction) {
      throw new ClipError("This swap quote looks wrong, so Clip Wallet stopped it.", "swap/unexpected-target");
    }
    const me = ctx.account.address;
    const sell = BigInt(quote.sellAmount);
    const min = BigInt(quote.minBuyAmount);
    const deadline = Math.floor(this.now() / 1000) + DEADLINE_S;
    const ops =
      d.direction === "xtz-to-token"
        ? [cpmmXtzToTokenOp({ cpmm: lb.cpmm, to: me, mutez: sell, minTokens: min, deadline })]
        : (() => {
            const perm = spendPermissionOps({ standard: lb.tokenStandard, token: lb.token, owner: me, spender: lb.cpmm, amount: sell });
            return [...perm.before, cpmmTokenToXtzOp({ cpmm: lb.cpmm, to: me, tokens: sell, minMutez: min, deadline }), ...perm.after];
          })();
    const request = tezosSendRequest(ctx, ops);
    const amt = (v: string | bigint, a: AssetRef) => `${formatUnits(v, a.decimals, a.decimals)} ${a.symbol}`;
    const lines = [{ label: "You get at least", value: amt(min, quote.buy) }];
    if (d.direction === "token-to-xtz") lines.push({ label: "Permission", value: `Sirius may use exactly ${amt(sell, quote.sell)}, only in this swap` });
    return [
      {
        title: `Swap ${amt(sell, quote.sell)} for ~${amt(quote.buyAmount, quote.buy)}`,
        lines,
        request,
        verify: (r) => verifySiriusRequest(r, { me, cpmm: lb.cpmm, token: lb.token }),
      },
    ];
  }
}

/** Only the allow-listed CPMM and token, only the swap/approve entrypoints, proceeds to you, nothing else in the batch. */
export function verifySiriusRequest(r: DappRequest, a: { me: string; cpmm: string; token: string }): boolean {
  const ops = (r.params as { operations?: { kind: string; destination?: string; parameters?: { entrypoint?: string; value?: unknown } }[] } | undefined)?.operations;
  if (!Array.isArray(ops) || !ops.length) return false;
  return ops.every((o) => {
    if (o.kind !== "transaction") return false;
    const ep = o.parameters?.entrypoint;
    if (o.destination === a.token) {
      const v = o.parameters?.value as { prim?: string; args?: { string?: string }[] } | undefined;
      return ep === "approve" && v?.args?.[0]?.string === a.cpmm;
    }
    if (o.destination !== a.cpmm) return false;
    const to = (o.parameters?.value as { args?: { string?: string }[] } | undefined)?.args?.[0]?.string;
    return (ep === "xtzToToken" || ep === "tokenToXtz") && to === a.me;
  });
}
