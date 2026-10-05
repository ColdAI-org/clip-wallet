import { type AssetRef, type ChainContext, ClipError, type DappRequest, WALLET_ORIGIN, msg } from "@clip-wallet/core";
import { Account, type Asset, Operation, TransactionBuilder } from "@stellar/stellar-base";
import { Horizon, type HorizonAccount } from "./horizon.js";
import { type ClassicAsset, STELLAR_HORIZON, netOf, networkPassphrase, toStellarAsset } from "./networks.js";
import { fromStroops, isContract, randomId, toStroops } from "./util.js";

/**
 * Wallet-built swaps on Stellar's own exchange (order books + AMM pools), with no third party:
 *   [changeTrust(buy)] + pathPaymentStrictSend(sendAsset, sendAmount, destination = you, destAsset, destMin, path)
 * in ONE transaction, so adding the bought asset and swapping happen together or not at all.
 * `destMin` is enforced by the network (op_under_dest_min → nothing happens). Paths come from Horizon
 * `GET /paths/strict-send` (the caller quotes; this module only builds and checks).
 * Operations: https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations (path ≤ 5 assets).
 */
export const MAX_PATH_LENGTH = 5;

export interface PathSwapParams {
  sell: AssetRef;
  buy: AssetRef;
  /** Stroops of `sell` to send (exact). */
  sendAmount: string;
  /** Minimum stroops of `buy` to receive, or the swap fails on-chain. */
  destMin: string;
  /** Intermediate assets from Horizon's path record. */
  path: ClassicAsset[];
}

export interface PathSwapCheck {
  /** The bought asset isn't in the account yet: a changeTrust goes first (sets aside one base reserve). */
  addsTrustline: boolean;
  /** Base reserve in stroops (0.5 XLM today). */
  reserve: bigint;
  /** Fee per operation in stroops. */
  feePerOp: bigint;
}

export interface PathSwapOptions {
  /** Validity window in seconds (default 300). */
  txTimeoutSeconds?: number;
  now?: () => number;
}

function horizonOf(ctx: ChainContext): Horizon {
  const n = netOf(ctx.network.id);
  const url = ctx.network.rpcUrls[0] ?? (n ? STELLAR_HORIZON[n] : undefined);
  if (!url) throw new ClipError("No Stellar connection is set up for this network.", "stellar/no-horizon");
  return new Horizon(url, ctx.fetch);
}

/** A classic asset (XLM or CODE:ISSUER) as stellar-base sees it; SEP-41 contract tokens are refused. */
export function swapAsset(a: AssetRef | ClassicAsset): Asset {
  if ("key" in a && a.address && isContract(a.address)) {
    throw new ClipError(msg("bg.err.swapAssetUnavailable", { symbol: a.symbol }), "stellar/swap-unsupported-asset");
  }
  try {
    return toStellarAsset(a);
  } catch {
    throw new ClipError("That isn't a Stellar asset that can be swapped.", "stellar/bad-asset");
  }
}

async function feePerOp(h: Horizon): Promise<bigint> {
  const s = await h.feeStats();
  const base = BigInt(s?.last_ledger_base_fee ?? "100");
  const p50 = BigInt(s?.fee_charged?.p50 ?? "100");
  const fee = p50 > base ? p50 : base;
  return fee > 100_000n ? 100_000n : fee; // same cap as buildTransfer: ≤ 0.01 XLM per operation
}

function holdingOf(acct: HorizonAccount, a: Asset) {
  return acct.balances.find((b) => b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer());
}

function spendableXlm(acct: HorizonAccount, reserve: bigint): bigint {
  const native = acct.balances.find((b) => b.asset_type === "native");
  if (!native) return 0n;
  const min = (2n + BigInt(acct.subentry_count) + BigInt(acct.num_sponsoring ?? 0) - BigInt(acct.num_sponsored ?? 0)) * reserve;
  const v = toStroops(native.balance) - toStroops(native.selling_liabilities ?? "0") - min;
  return v > 0n ? v : 0n;
}

async function check(p: { sell: AssetRef; buy: AssetRef; sendAmount: string }, ctx: ChainContext): Promise<PathSwapCheck & { acct: HorizonAccount }> {
  if (!/^\d+$/.test(p.sendAmount) || BigInt(p.sendAmount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "stellar/bad-amount");
  const amount = BigInt(p.sendAmount);
  const sell = swapAsset(p.sell);
  const buy = swapAsset(p.buy);
  if (sell.equals(buy)) throw new ClipError("Pick two different assets.", "stellar/same-asset");
  const h = horizonOf(ctx);
  const acct = await h.account(ctx.account.address);
  if (!acct) throw new ClipError("Your Stellar account isn't open yet. Receive at least 1 XLM to open it.", "stellar/not-activated");
  const [reserve, fee] = await Promise.all([h.baseReserve(), feePerOp(h)]);
  const held = buy.isNative() ? true : holdingOf(acct, buy);
  if (held && typeof held === "object" && held.is_authorized === false) {
    throw new ClipError(`The issuer of ${buy.getCode()} hasn't allowed your account to hold it, so you can't swap into it.`, "stellar/not-authorized");
  }
  const addsTrustline = !held;
  const ops = addsTrustline ? 2n : 1n;
  const xlmNeeded = fee * ops + (addsTrustline ? reserve : 0n) + (sell.isNative() ? amount : 0n);
  const free = spendableXlm(acct, reserve);
  if (!sell.isNative()) {
    const h2 = holdingOf(acct, sell);
    const have = h2 ? toStroops(h2.balance) - toStroops(h2.selling_liabilities ?? "0") : 0n;
    if (have < amount) throw new ClipError(msg("bg.err.notEnoughForSwap", { symbol: sell.getCode() }), "stellar/insufficient-token");
  }
  if (xlmNeeded > free) {
    const why = addsTrustline ? ` Adding ${buy.getCode()} also sets aside 0.5 XLM of your balance.` : "";
    throw new ClipError(`You don't have enough XLM for this swap. Your account must keep a small minimum balance.${why}`, "stellar/insufficient-balance");
  }
  return { addsTrustline, reserve, feePerOp: fee, acct };
}

/** Read-only check used at quote time: balances, the minimum balance, and whether a trustline is needed. */
export async function checkPathSwap(p: { sell: AssetRef; buy: AssetRef; sendAmount: string }, ctx: ChainContext): Promise<PathSwapCheck> {
  const { acct: _acct, ...rest } = await check(p, ctx);
  return rest;
}

/**
 * Builds `[changeTrust(buy)] + pathPaymentStrictSend(…, destination = you)` as a `stellar_signAndSubmitXDR`
 * request (the method chains-stellar uses for its own builders; decode describes both operations plainly).
 */
export async function buildPathSwap(p: PathSwapParams, ctx: ChainContext, opts: PathSwapOptions = {}): Promise<{ request: DappRequest; addsTrustline: boolean }> {
  if (p.path.length > MAX_PATH_LENGTH) throw new ClipError("This swap route is too long. Get a new price.", "stellar/path-too-long");
  if (!/^\d+$/.test(p.destMin) || BigInt(p.destMin) <= 0n) throw new ClipError("This price is too small to swap. Try a larger amount.", "stellar/bad-amount");
  const c = await check(p, ctx);
  const sendAsset = swapAsset(p.sell);
  const destAsset = swapAsset(p.buy);
  const path = p.path.map((a) => swapAsset(a));
  const t = Math.floor((opts.now ?? Date.now)() / 1000);
  const b = new TransactionBuilder(new Account(c.acct.id, c.acct.sequence), {
    fee: c.feePerOp.toString(),
    networkPassphrase: networkPassphrase(ctx.network.id),
    timebounds: { minTime: 0, maxTime: t + (opts.txTimeoutSeconds ?? 300) },
  });
  if (c.addsTrustline) b.addOperation(Operation.changeTrust({ asset: destAsset }));
  b.addOperation(
    Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount: fromStroops(BigInt(p.sendAmount)),
      destination: ctx.account.address,
      destAsset,
      destMin: fromStroops(BigInt(p.destMin)),
      path,
    }),
  );
  const tx = b.build();
  const request: DappRequest = {
    id: randomId(),
    origin: WALLET_ORIGIN,
    via: "injected",
    family: "stellar",
    networkId: ctx.network.id,
    method: "stellar_signAndSubmitXDR",
    params: { xdr: tx.toXDR(), networkPassphrase: networkPassphrase(ctx.network.id), address: ctx.account.address },
  };
  return { request, addsTrustline: c.addsTrustline };
}

/** Parses a transaction envelope back (tests and reviews). */
export function parseStellarTransaction(xdrB64: string, networkId: string) {
  return TransactionBuilder.fromXDR(xdrB64, networkPassphrase(networkId));
}
