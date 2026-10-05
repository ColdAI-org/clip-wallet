import { type ChainContext, ClipError, type Network, WALLET_ORIGIN, msg, titled } from "@clip-wallet/core";
import {
  SuiGraphQL,
  type TransactionData,
  inspectTransaction,
  normalizeCoinType,
  normalizeSuiAddress,
  pureAddressOf,
  pureU64Of,
  suiNetworkOf,
  transactionFromKind,
} from "@clip-wallet/chains-sui";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * Aftermath smart-order router on Sui (keyless public API; endpoints and bodies as the official aftermath-ts-sdk 6.1.0
 * `Router.getCompleteTradeRouteGivenAmountIn` / `getTransactionForCompleteTradeRoute` call them, verified live 2026-10-03):
 *   POST https://aftermath.finance/api/router/trade-route            { coinInType, coinOutType, coinInAmount: "<n>n" }
 *        → { routes[].paths[].protocolName, coinIn.amount, coinOut.amount ("<n>n" bigint strings), spotPrice }
 *   POST https://aftermath.finance/api/router/v1/transactions/trade  { walletAddress, completeRoute, slippage (fraction) }
 *        → { txKind } (base64 BCS TransactionKind; gas is left to the wallet)
 * testnet.aftermath.finance has no working router (500), so this is mainnet-only.
 *
 * The returned transaction is parsed with @mysten/sui (chains-sui `inspectTransaction`) and refused unless:
 *  - every MoveCall goes to 0x2 coin/balance plumbing or an Aftermath router package (allow-list below, plus packages
 *    published by Aftermath's deployer that link to the router, checked on-chain over GraphQL);
 *  - the only coin taken is one SplitCoins of exactly the sell amount (from gas for SUI, from your own coins or an
 *    address-balance FundsWithdrawal of the sell coin, capped at the sell amount, otherwise); your objects are never
 *    handed to a contract directly;
 *  - every TransferObjects goes to you;
 *  - begin_router_tx carries the sell amount, the quoted output, a slippage no looser than you asked and no extra fee.
 *    The router enforces output ≥ expected × (1 − slippage) on-chain (end_router_tx), or the whole swap aborts.
 */
export const AFTERMATH_BASE = "https://aftermath.finance";

/**
 * The router's original package id (types defined there) and its current upgrade, read from the transactions the API
 * builds and from on-chain package linkage. `router.packages.utils` (0xdc15…750e) in https://aftermath.finance/api/addresses
 * was published by the same deployer, 0x4b02…8ace.
 */
export const AFTERMATH_ROUTER_ORIGINAL = normalizeSuiAddress("0xe5099fcd45747074d0ef5eabce07a9bd1c3b0c1862435bf2a09c3a81e0604373");
export const AFTERMATH_DEPLOYERS = new Set([
  normalizeSuiAddress("0x4b02b9b45f2a9597363fbaacb2fd6e7fb8ed9329bb6f716631b5717048908ace"),
  normalizeSuiAddress("0x540bba0b0760c20d5d71bebf04ba8ed13288ba181823b27c8340a5bf25e7fbad"),
]);
/** Router + per-DEX wrapper packages seen in API transactions on 2026-10-03, each linking to the router and published by the deployers above. */
export const AFTERMATH_PACKAGES = new Set(
  [
    "0x7de5de8d75a8f4e42cdd3c018f788bc9b9ebf2d3d61dcfe9d2136f17f077afd5", // router (upgrade of 0xe509…4373)
    "0x8fbcffce4ac1b56d517cc2118fae85f1881a80a934af575d825f63a05af5a874", // wrapper
    "0xf92e4e916418d5ae50437cd9fddc17f338429df64062feab1a512c506072f742", // Cetus DLMM wrapper
    "0xd5bd38b8f7b472876ff803814a1c62082c122b77944b0f6da7f2bf2d4888426e", // DeepBook v3 wrapper
    "0x8cd0b2cbaf9d39f457f2d6a6fca0c96500a4d5654b99e1ba86d74a518c68017a", // wrapper
    "0xbb2f1bc0c032aa7237ead35cbdd42d49ee7b04e1269c37af1ca5ec8e099793cb", // wrapper
  ].map((a) => normalizeSuiAddress(a)),
);
const FRAMEWORK = normalizeSuiAddress("0x2");
/** 0x2 calls that only move value between your own coin/balance handles. */
const PLUMBING = new Set(["coin::redeem_funds", "coin::from_balance", "coin::into_balance", "coin::join", "coin::split", "coin::zero", "coin::destroy_zero", "balance::join", "balance::split", "balance::zero", "balance::destroy_zero"]);
const SUI_TYPE = normalizeCoinType("0x2::sui::SUI");
const SLIPPAGE_ONE = 10n ** 18n;

interface RouteResponse {
  routes?: { paths?: { protocolName?: string }[] }[];
  coinIn?: { type?: string; amount?: string };
  coinOut?: { type?: string; amount?: string };
}

function bigOf(v: unknown): bigint | null {
  const s = String(v ?? "").replace(/n$/, "");
  return /^\d+$/.test(s) ? BigInt(s) : null;
}

export interface TradeCheck {
  me: string;
  sellType: string;
  sellAmount: bigint;
  /** Quoted output (route coinOut.amount). */
  expectedOut: bigint;
  slippageBps: number;
}

export interface TradeTerms {
  /** Every package the transaction calls (normalized). */
  packages: string[];
  /** On-chain floor: expected × (1 − slippage). */
  minOut: bigint;
}

type Arg = { $kind: string; Input?: number; Result?: number; NestedResult?: [number, number]; GasCoin?: true };

const refuse = (why: string) => new ClipError(`Aftermath sent a swap Clip Wallet won't sign (${why}). Nothing was sent.`, "swap/aftermath-refused");

/**
 * Structural checks on the router's transaction (no network). Returns the packages it calls (the caller checks them
 * against the allow-list) and the on-chain minimum output.
 */
export function checkAftermathTrade(data: TransactionData, c: TradeCheck): TradeTerms {
  const me = normalizeSuiAddress(c.me);
  const sellType = normalizeCoinType(c.sellType);
  const owned = new Set<number>();
  let withdrawn = 0n;
  data.inputs.forEach((input, i) => {
    const k = (input as { $kind: string }).$kind;
    if (k === "Pure") return;
    if (k === "Object") {
      const o = (input as { Object: { $kind: string } }).Object;
      if (o.$kind === "SharedObject") return;
      if (o.$kind === "ImmOrOwnedObject") return void owned.add(i);
      throw refuse("it receives objects");
    }
    if (k === "FundsWithdrawal") {
      const f = (input as { FundsWithdrawal: { reservation: { MaxAmountU64?: string }; typeArg: { Balance?: string }; withdrawFrom: { $kind: string } } }).FundsWithdrawal;
      if (f.withdrawFrom.$kind !== "Sender") throw refuse("it draws from someone else's balance");
      if (!f.typeArg.Balance || normalizeCoinType(f.typeArg.Balance) !== sellType) throw refuse("it takes a coin you aren't selling");
      const max = bigOf(f.reservation.MaxAmountU64);
      if (max === null) throw refuse("it takes an open-ended amount");
      withdrawn += max;
      return;
    }
    throw refuse(`it has a ${k} input`);
  });
  if (withdrawn > c.sellAmount) throw refuse("it takes more than you're selling");

  const isOwned = (a: Arg) => a.$kind === "Input" && owned.has(a.Input!);
  const isGas = (a: Arg) => a.$kind === "GasCoin";
  let splits = 0;
  let begins = 0;
  let minOut: bigint | null = null;
  const packages = new Set<string>();

  data.commands.forEach((cmd) => {
    switch (cmd.$kind) {
      case "SplitCoins": {
        const s = cmd.SplitCoins as { coin: Arg; amounts: Arg[] };
        if (isGas(s.coin)) {
          if (sellType !== SUI_TYPE) throw refuse("it spends SUI you aren't selling");
        } else if (!isOwned(s.coin)) {
          throw refuse("it splits a coin that isn't yours");
        }
        if (s.amounts.length !== 1) throw refuse("it splits more than one amount");
        const amt = s.amounts[0]!.$kind === "Input" ? pureU64Of(data.inputs[s.amounts[0]!.Input!]) : null;
        if (amt !== c.sellAmount) throw refuse("the amount differs from the quote");
        splits++;
        return;
      }
      case "MergeCoins": {
        const m = cmd.MergeCoins as { destination: Arg; sources: Arg[] };
        if (![m.destination, ...m.sources].every(isOwned)) throw refuse("it merges coins that aren't yours");
        return;
      }
      case "TransferObjects": {
        const t = cmd.TransferObjects as { objects: Arg[]; address: Arg };
        const to = t.address.$kind === "Input" ? pureAddressOf(data.inputs[t.address.Input!]) : null;
        if (to !== me) throw refuse("it sends coins to someone else");
        if (t.objects.some((o) => isGas(o) || isOwned(o))) throw refuse("it moves your coins directly");
        return;
      }
      case "MakeMoveVec": {
        const v = cmd.MakeMoveVec as { elements: Arg[] };
        if (v.elements.some((e) => isGas(e) || isOwned(e))) throw refuse("it hands your coins to a contract");
        return;
      }
      case "MoveCall": {
        const call = cmd.MoveCall as { package: string; module: string; function: string; arguments: Arg[] };
        const pkg = normalizeSuiAddress(call.package);
        if (call.arguments.some((a) => isGas(a) || isOwned(a))) throw refuse("it hands your coins to a contract");
        if (pkg === FRAMEWORK) {
          if (!PLUMBING.has(`${call.module}::${call.function}`)) throw refuse(`it calls 0x2::${call.module}::${call.function}`);
          return;
        }
        packages.add(pkg);
        if (call.module === "router" && call.function.startsWith("begin_router_tx")) {
          begins++;
          const u = (i: number) => {
            const a = call.arguments[i];
            return a && a.$kind === "Input" ? pureU64Of(data.inputs[a.Input!]) : null;
          };
          const amountIn = u(1);
          const expected = u(2);
          const slip = u(3);
          if (amountIn !== c.sellAmount) throw refuse("the amount differs from the quote");
          if (expected === null || expected < c.expectedOut) throw refuse("it expects less than the quote");
          if (slip === null || slip > BigInt(c.slippageBps) * 10n ** 14n) throw refuse("its slippage is looser than you asked");
          if (call.arguments.length >= 8) {
            const feeTo = call.arguments[6]!.$kind === "Input" ? pureAddressOf(data.inputs[call.arguments[6]!.Input!]) : null;
            const fee = u(7);
            if (fee !== 0n || feeTo !== normalizeSuiAddress("0x0")) throw refuse("it adds a fee");
          }
          minOut = (expected * (SLIPPAGE_ONE - slip)) / SLIPPAGE_ONE;
        }
        return;
      }
      default:
        throw refuse(`it contains ${cmd.$kind}`);
    }
  });
  if (splits !== 1 && !(splits === 0 && withdrawn === c.sellAmount)) throw refuse("the amount differs from the quote");
  if (begins !== 1 || minOut === null) throw refuse("it isn't a router swap");
  return { packages: [...packages], minOut };
}

const Q_PACKAGE = /* GraphQL */ `query clipAftermathPackage($id: SuiAddress!) {
  object(address: $id) { previousTransaction { sender { address } } asMovePackage { linkage { originalId } typeOrigins { definingId } } }
}`;

export class AftermathSwap implements SwapProvider {
  readonly id = "aftermath";
  readonly name = "Aftermath";
  readonly family = "sui" as const;
  /** Packages confirmed on-chain this session (Aftermath deployer + router linkage). */
  private readonly verified = new Set<string>();

  constructor(private readonly opts: { base?: string; quoteTtlMs?: number; now?: () => number } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "sui") return { code: "swap/wrong-family", message: "Aftermath only swaps Sui coins." };
    if (suiNetworkOf(network.id) !== "mainnet") return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  private base(): string {
    return (this.opts.base ?? AFTERMATH_BASE).replace(/\/+$/, "");
  }

  /** Allow-listed, or published by Aftermath's deployer and linked to the router (checked over the network's GraphQL). */
  async packageAllowed(pkg: string, ctx: ChainContext): Promise<boolean> {
    if (AFTERMATH_PACKAGES.has(pkg) || this.verified.has(pkg)) return true;
    const url = ctx.network.rpcUrls[0];
    if (!url) return false;
    try {
      const r = await new SuiGraphQL(url, ctx.fetch).query<{
        object: { previousTransaction?: { sender?: { address: string } | null } | null; asMovePackage?: { linkage?: { originalId: string }[]; typeOrigins?: { definingId: string }[] } | null } | null;
      }>(Q_PACKAGE, { id: pkg });
      const o = r.object;
      const sender = o?.previousTransaction?.sender?.address;
      const p = o?.asMovePackage;
      if (!sender || !p || !AFTERMATH_DEPLOYERS.has(normalizeSuiAddress(sender))) return false;
      const linked = (p.linkage ?? []).some((l) => normalizeSuiAddress(l.originalId) === AFTERMATH_ROUTER_ORIGINAL) || (p.typeOrigins ?? []).some((t) => normalizeSuiAddress(t.definingId) === AFTERMATH_ROUTER_ORIGINAL);
      if (linked) this.verified.add(pkg);
      return linked;
    } catch {
      return false;
    }
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    const me = normalizeSuiAddress(ctx.account.address);
    const sellType = normalizeCoinType(req.sell.address ?? SUI_TYPE);
    const buyType = normalizeCoinType(req.buy.address ?? SUI_TYPE);
    const sellAmount = BigInt(req.amount);
    let route: RouteResponse;
    try {
      route = await fetchJson<RouteResponse>(ctx.fetch, `${this.base()}/api/router/trade-route`, "Aftermath", {
        body: { coinInType: sellType, coinOutType: buyType, coinInAmount: `${sellAmount}n` },
      });
    } catch (e) {
      if (e instanceof ClipError && e.code.startsWith("features/http-")) throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another coin.", "swap/no-route", e);
      throw e;
    }
    const out = bigOf(route.coinOut?.amount);
    if (!route.routes?.length || !out || out <= 0n || bigOf(route.coinIn?.amount) !== sellAmount) {
      throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another coin.", "swap/no-route");
    }
    if (normalizeCoinType(route.coinOut?.type ?? "") !== buyType || normalizeCoinType(route.coinIn?.type ?? "") !== sellType) throw refuse("the coins differ from what you asked");

    let tx: { txKind?: string };
    try {
      tx = await fetchJson<{ txKind?: string }>(ctx.fetch, `${this.base()}/api/router/v1/transactions/trade`, "Aftermath", {
        body: { walletAddress: me, completeRoute: route, slippage: req.slippageBps / 10_000 },
      });
    } catch (e) {
      if (e instanceof ClipError && e.code.startsWith("features/http-")) throw new ClipError(msg("bg.err.notEnoughForSwapFee", { symbol: req.sell.symbol }), "swap/insufficient", e);
      throw e;
    }
    if (!tx.txKind) throw new ClipError("Aftermath couldn't prepare this swap. Try again in a moment.", "swap/aftermath-build");
    const data = inspectTransaction(tx.txKind, true);
    const terms = checkAftermathTrade(data, { me, sellType, sellAmount, expectedOut: out, slippageBps: req.slippageBps });
    for (const pkg of terms.packages) {
      if (!(await this.packageAllowed(pkg, ctx))) throw refuse("it calls a contract that isn't Aftermath's");
    }
    const transaction = await transactionFromKind(tx.txKind, me);
    const labels = (route.routes ?? []).flatMap((r) => (r.paths ?? []).map((p) => p.protocolName)).filter((l): l is string => !!l);
    const now = this.opts.now?.() ?? Date.now();
    return {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: sellAmount.toString(),
      buyAmount: out.toString(),
      minBuyAmount: terms.minOut.toString(),
      slippageBps: req.slippageBps,
      route: [...new Set(labels.length ? labels : ["Aftermath"])],
      expiresAt: now + (this.opts.quoteTtlMs ?? 30_000),
      data: { transaction },
    };
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const { transaction } = quote.data as { transaction: string };
    return [
      {
        ...titled(msg("bg.req.swap", { pay: quote.sell.symbol, get: quote.buy.symbol })),
        request: {
          id: randomId(),
          origin: WALLET_ORIGIN,
          via: "injected",
          family: "sui",
          networkId: ctx.network.id,
          method: "sui:signAndExecuteTransaction",
          params: { inputs: [{ account: normalizeSuiAddress(ctx.account.address), transaction, chain: ctx.network.id }] },
        },
      },
    ];
  }
}
