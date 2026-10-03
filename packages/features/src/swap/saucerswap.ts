import { type ChainContext, ClipError, type Network } from "@clip-wallet/core";
import { buildAssociate, freezeNew, ledgerOf, mirrorFor, mirrorUrl, requestFor, resolvePayer, type HederaLedger } from "@clip-wallet/chains-hedera";
import { AccountAllowanceApproveTransaction, AccountId, ContractExecuteTransaction, ContractId, Hbar } from "@hiero-ledger/sdk";
import { decodeFunctionResult, encodeFunctionData, encodePacked, parseAbi, type Hex } from "viem";
import { mirrorCall } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, longZero } from "../util.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * SaucerSwap V2 (Uniswap-v3 style) on Hedera. Contract ids from https://docs.saucerswap.finance/developers/contracts.md.
 *
 * Quoting: SaucerSwap's REST API (api.saucerswap.finance) needs an x-api-key and has no AMM quote endpoint, so we
 * quote on-chain as its docs recommend (https://docs.saucerswap.finance/developers/v2/swap/swap-quote.md):
 * QuoterV2.quoteExactInput(path, amountIn) through the mirror node's free POST /api/v1/contracts/call
 * (the docs show both this and the JSON-RPC relay; the mirror node needs no extra endpoint).
 *
 * Swapping (docs: swap-hbar-for-tokens / swap-tokens-for-hbar): ContractExecute on the SwapRouter.
 *  - HBAR in: multicall([exactInput(recipient = you), refundETH()]) with the HBAR as payable amount; WHBAR in the path.
 *  - HBAR out: multicall([exactInput(recipient = the router), unwrapWHBAR(min, you)]).
 *  - Token in: an exact-amount HTS allowance to the router first (AccountAllowanceApprove, HIP-336). Never unlimited.
 *  - Token out: if your account hasn't added the token and has no free auto-association slot, add it first.
 */
export const SAUCERSWAP_V2: Partial<Record<HederaLedger, { quoter: string; router: string; factory: string; positionManager: string; lpNft: string; whbarToken: string }>> = {
  mainnet: { quoter: "0.0.3949424", router: "0.0.3949434", factory: "0.0.3946833", positionManager: "0.0.4053945", lpNft: "0.0.4054027", whbarToken: "0.0.1456986" },
  testnet: { quoter: "0.0.1390002", router: "0.0.1414040", factory: "0.0.1197038", positionManager: "0.0.1308184", lpNft: "0.0.1310436", whbarToken: "0.0.15058" },
};

/** V2 fee tiers in hundredths of a basis point: 0.05 %, 0.15 %, 0.30 %, 1.00 %. */
export const FEE_TIERS = [500, 1500, 3000, 10000] as const;

const QUOTER_ABI = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);
export const ROUTER_ABI = parseAbi([
  "struct ExactInputParams { bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; }",
  "function exactInput(ExactInputParams params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
  "function unwrapWHBAR(uint256 amountMinimum, address recipient) payable",
]);

interface PathCandidate {
  tokens: string[];
  fees: number[];
}

export function encodePath(tokens: string[], fees: number[]): Hex {
  const types: ("address" | "uint24")[] = [];
  const values: (string | number)[] = [];
  tokens.forEach((t, i) => {
    types.push("address");
    values.push(longZero(t));
    if (i < fees.length) {
      types.push("uint24");
      values.push(fees[i]!);
    }
  });
  return encodePacked(types, values as never);
}

function candidates(tokenIn: string, tokenOut: string, whbar: string): PathCandidate[] {
  const out: PathCandidate[] = FEE_TIERS.map((f) => ({ tokens: [tokenIn, tokenOut], fees: [f] }));
  if (tokenIn !== whbar && tokenOut !== whbar) {
    for (const a of [1500, 3000]) for (const b of [1500, 3000]) out.push({ tokens: [tokenIn, whbar, tokenOut], fees: [a, b] });
  }
  return out;
}

interface SaucerData {
  path: Hex;
  gasEstimate: string;
  tokenIn: string;
  tokenOut: string;
}

export class SaucerSwap implements SwapProvider {
  readonly id = "saucerswap";
  readonly name = "SaucerSwap";
  readonly family = "hedera" as const;

  availability(network: Network): Unavailable | null {
    if (network.family !== "hedera") return { code: "swap/wrong-family", message: "SaucerSwap only swaps Hedera tokens." };
    try {
      if (!SAUCERSWAP_V2[ledgerOf(network.id)]) return { code: "swap/unsupported", message: "Swapping isn't available here yet." };
    } catch {
      return { code: "swap/unsupported", message: "Swapping isn't available here yet." };
    }
    return null;
  }

  private contracts(ctx: ChainContext) {
    const c = SAUCERSWAP_V2[ledgerOf(ctx.network.id)];
    if (!c) throw new ClipError("Swapping isn't available here yet.", "swap/unsupported");
    return c;
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const c = this.contracts(ctx);
    const tokenIn = req.sell.address ?? c.whbarToken;
    const tokenOut = req.buy.address ?? c.whbarToken;
    if (tokenIn === tokenOut) throw new ClipError("Pick two different tokens.", "swap/same-token");
    const mirror = mirrorUrl(ctx.network);
    const tries = await Promise.allSettled(
      candidates(tokenIn, tokenOut, c.whbarToken).map(async (p) => {
        const path = encodePath(p.tokens, p.fees);
        const data = encodeFunctionData({ abi: QUOTER_ABI, functionName: "quoteExactInput", args: [path, BigInt(req.amount)] });
        const raw = await mirrorCall(ctx.fetch, mirror, longZero(c.quoter), data, "SaucerSwap");
        const [amountOut, , , gasEstimate] = decodeFunctionResult({ abi: QUOTER_ABI, functionName: "quoteExactInput", data: raw });
        return { p, path, amountOut, gasEstimate };
      }),
    );
    const ok = tries.flatMap((t) => (t.status === "fulfilled" && t.value.amountOut > 0n ? [t.value] : []));
    if (!ok.length) throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
    const best = ok.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
    const minBuy = (best.amountOut * BigInt(10_000 - req.slippageBps)) / 10_000n;
    const q: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: best.amountOut.toString(),
      minBuyAmount: minBuy.toString(),
      slippageBps: req.slippageBps,
      route: best.p.tokens.length > 2 ? ["SaucerSwap (via HBAR)"] : ["SaucerSwap"],
      expiresAt: Date.now() + 30_000,
      data: { path: best.path, gasEstimate: best.gasEstimate.toString(), tokenIn, tokenOut } satisfies SaucerData,
    };
    if (req.sell.address) q.approval = { spender: c.router, spenderName: "SaucerSwap", amount: req.amount };
    if (req.buy.address && !(await this.canReceive(ctx, req.buy.address))) q.association = { tokenId: req.buy.address, symbol: req.buy.symbol };
    return q;
  }

  /** Associated already, or a free auto-association slot (HIP-904: -1 = unlimited). */
  async canReceive(ctx: ChainContext, tokenId: string): Promise<boolean> {
    const mirror = mirrorFor(ctx);
    const acct = await mirror.account(ctx.account.hederaAccountId ?? ctx.account.address);
    if (!acct) return false;
    if (await mirror.tokenRelationship(acct.account, tokenId)) return true;
    const max = acct.max_automatic_token_associations;
    if (max === -1) return true;
    const used = (await mirror.tokenRelationships(acct.account)).filter((r) => r.automatic_association).length;
    return used < max;
  }

  /** Current HTS allowance from you to `spender` for `tokenId` (mirror /allowances/tokens). */
  async allowance(ctx: ChainContext, owner: string, spender: string, tokenId: string): Promise<bigint> {
    const page = await mirrorFor(ctx).get<{ allowances: { amount?: number; amount_granted?: number }[] }>(
      `/api/v1/accounts/${owner}/allowances/tokens?spender.id=${spender}&token.id=${tokenId}&limit=1`,
    );
    const a = page?.allowances[0];
    return BigInt(a?.amount ?? a?.amount_granted ?? 0);
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const c = this.contracts(ctx);
    const d = quote.data as SaucerData;
    const mirror = mirrorFor(ctx);
    const payer = await resolvePayer(ctx, mirror);
    const acct = await mirror.account(payer);
    const me = (acct?.evm_address ?? longZero(payer)) as `0x${string}`;
    const steps: Step[] = [];

    if (quote.association) {
      const tokenId = quote.association.tokenId;
      steps.push({ title: `Add ${quote.association.symbol} to your account`, request: () => buildAssociate(tokenId, ctx) });
    }
    if (quote.sell.address) {
      const have = await this.allowance(ctx, payer, c.router, quote.sell.address);
      if (have < BigInt(quote.sellAmount)) {
        const token = quote.sell.address;
        steps.push({
          title: `Allow SaucerSwap to use exactly ${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol}`,
          lines: [{ label: "Limit", value: "Only this amount, for this swap" }],
          request: async () => {
            if (BigInt(quote.sellAmount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new ClipError("That amount is too large to swap in one go.", "swap/amount-too-large");
            const tx = new AccountAllowanceApproveTransaction().approveTokenAllowance(token, payer, AccountId.fromString(c.router), Number(quote.sellAmount));
            return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
          },
        });
      }
    }

    steps.push({
      title: `Swap ${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol} for ~${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}`,
      lines: [{ label: "You get at least", value: `${formatUnits(quote.minBuyAmount, quote.buy.decimals)} ${quote.buy.symbol}` }],
      request: async () => {
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
        const hbarIn = !quote.sell.address;
        const hbarOut = !quote.buy.address;
        const params = {
          path: d.path,
          recipient: hbarOut ? longZero(c.router) : me,
          deadline,
          amountIn: BigInt(quote.sellAmount),
          amountOutMinimum: BigInt(quote.minBuyAmount),
        };
        const swap = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInput", args: [params] });
        let data: Hex = swap;
        if (hbarIn) data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [[swap, encodeFunctionData({ abi: ROUTER_ABI, functionName: "refundETH" })]] });
        if (hbarOut) {
          data = encodeFunctionData({
            abi: ROUTER_ABI,
            functionName: "multicall",
            args: [[swap, encodeFunctionData({ abi: ROUTER_ABI, functionName: "unwrapWHBAR", args: [BigInt(quote.minBuyAmount), me] })]],
          });
        }
        const est = Number(d.gasEstimate) || 0;
        const gas = Math.min(3_000_000, Math.max(300_000, Math.ceil(est * 1.5) + 100_000));
        const tx = new ContractExecuteTransaction()
          .setContractId(ContractId.fromString(c.router))
          .setGas(gas)
          .setFunctionParameters(hexToBytes(data));
        if (hbarIn) tx.setPayableAmount(Hbar.fromTinybars(quote.sellAmount));
        return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
      },
    });
    return steps;
  }
}

function hexToBytes(h: Hex): Uint8Array {
  const s = h.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
