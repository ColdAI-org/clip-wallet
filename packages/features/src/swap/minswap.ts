import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import {
  CARDANO_METHODS,
  type CborValue,
  Koios,
  type ParsedTx,
  addressToBytes,
  addressesIn,
  constrOf,
  meOf,
  outputDatum,
  parseAddressBytes,
  parseTransaction,
  utxoRef,
  witnessDatums,
} from "@clip-wallet/chains-cardano";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Minswap Aggregator API (https://docs.minswap.org/developer/aggregator-api, OpenAPI checked 2026-10-03). Keyless.
 *   POST https://agg-api.minswap.org/aggregator/estimate  { amount, token_in, token_out, slippage (%), include_protocols, allow_multi_hops, partner? }
 *     → amount_out, min_amount_out, total_dex_fee, deposits, avg_price_impact, paths[][]{protocol, lp_token}, aggregator_fee?
 *   POST /build-tx { sender, min_amount_out, estimate } → { cbor } (unsigned transaction)
 * Production server only (Cardano mainnet), so testnets get a plain "not in this test version" message.
 *
 * Routing is limited to Minswap's own pools: `include_protocols` overrides exclusions and "Minswap protocols are always
 * included", so ["MinswapV2"] yields Minswap V1 / V2 / Stableswap only, and no aggregator fee. The returned
 * transaction is parsed back with chains-cardano and refused unless: every input is ours; every output is our
 * address, a Minswap order script from the allow-list below, or (at most the quoted aggregator fee) a fee output;
 * each order's datum pays us (sender/receiver/refund/success receivers are our payment key, no extra datum) with a
 * minimum at or above ours; the order holds no more than the amount + batcher fee + deposit; and there are no
 * certificates, withdrawals, mints, collateral, required signers, reference inputs, governance or scripts to run.
 */
export const MINSWAP_AGG_BASE = "https://agg-api.minswap.org/aggregator";

/**
 * Order script hashes (payment credential of the order address), Cardano mainnet. Source: minswap/sdk
 * src/types/constants.ts (main, 2026-10-03): DexV1Constant.ORDER_BASE_ADDRESS, DexV2Constant.CONFIG.orderScriptHash,
 * StableswapConstant.CONFIG[].orderAddress (13 pools).
 */
export const MINSWAP_ORDER_SCRIPTS: Readonly<Record<string, "v1" | "v2" | "stable">> = {
  a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b: "v1",
  c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c: "v2",
  "4c4d65a0616f60adc2cba70f533705233b1d7e8cb3e9868cdca39d86": "stable",
  "62d3e3975c6ec02d4002640413368a2d46ea10548b1cd217a3e9b7cd": "stable",
  "96c2d95fc73740ef18abb95af68be279f80bb711eb69a527f3b1d713": "stable",
  "865085a4d810ed21f7677bdf3b1a93e1b75fd17f246d7f0243493cde": "stable",
  "6d0241ff7fa052c63645a75e189f84214b6be062f59d6ac9c7bbb2c1": "stable",
  fb65ab56748b6c2894d04e68c0b92fc2a00178303ef1ee62a539afda: "stable",
  f5da441786eef04048a9f59fff53c5c9ef101a59ad0488e1a8aa3897: "stable",
  "2aa1ae236856def55f77e6bb1aa5b43801ec0097f9e0a69fa24fc0ed": "stable",
  f1d4865bce47591d67ec320e92eeb26b917389e65f8fb12bb9b38877: "stable",
  e296ea95bb834b0816ee6b700fb008c1e52d7508728b914ff3f52764: "stable",
  "2c3a242850258ed3ebf501bb9515a159370de774a86fa70e27f24075": "stable",
  "9fb4b54c367463bd3da3d2e8aa9357133ef7b489adb1cf9cb2e8dd70": "stable",
  baef35198c17567a43cf11a5d049b83f664241b35a666f5988f08092: "stable",
};

const PROTOCOL_LABELS: Record<string, string> = { Minswap: "Minswap V1", MinswapV2: "Minswap V2", MinswapStable: "Minswap Stableswap" };
/** Highest network fee the wallet accepts on a swap order transaction (lovelace). */
export const MAX_TX_FEE = 2_000_000n;

interface EstimateBody {
  amount: string;
  token_in: string;
  token_out: string;
  slippage: number;
  include_protocols: string[];
  allow_multi_hops: boolean;
  partner?: string;
}

interface EstimateHop {
  protocol: string;
  lp_token?: string;
  pool_id?: string;
}

interface EstimateResponse {
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
  min_amount_out: string;
  total_dex_fee?: string;
  deposits?: string;
  avg_price_impact?: number;
  paths?: EstimateHop[][];
  aggregator_fee?: string;
}

/** What `build` needs from the quote. Lovelace / base units as decimal strings. */
export interface MinswapQuoteData {
  estimate: EstimateBody;
  minOut: string;
  dexFee: string;
  deposits: string;
  aggregatorFee: string;
  lpTokens: string[];
}

export interface MinswapCheck {
  paymentKeyHash: Uint8Array;
  /** "lovelace" or policy id + asset name hex. */
  sell: string;
  buy: string;
  amountIn: bigint;
  minOut: bigint;
  dexFee: bigint;
  deposits: bigint;
  aggregatorFee: bigint;
  /** Minswap V2 LP assets from the quote's path (policy + name hex). */
  lpTokens: string[];
  networkId: number;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const bad = (why: string) => new ClipError("This swap from Minswap doesn't match what was quoted, so Clip Wallet stopped it.", "swap/unexpected-transaction", why);

function int(v: CborValue | undefined): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  throw bad("datum: not an integer");
}

function assetUnit(v: CborValue | undefined): string {
  const c = v === undefined ? null : constrOf(v);
  const [p, n] = c?.fields ?? [];
  if (!c || c.index !== 0 || !(p instanceof Uint8Array) || !(n instanceof Uint8Array)) throw bad("datum: bad asset");
  return p.length === 0 && n.length === 0 ? "lovelace" : hex(p) + hex(n);
}

function isNone(v: CborValue | undefined): boolean {
  const c = v === undefined ? null : constrOf(v);
  return !!c && c.fields.length === 0;
}

/** Minimum the order guarantees (base units of `buy`), after checking it pays only us. */
function checkOrderDatum(kind: "v1" | "v2" | "stable", datum: CborValue, x: MinswapCheck): bigint {
  const d = constrOf(datum);
  if (!d || d.index !== 0) throw bad("datum: not an order");
  // Generic: every address inside the order is our payment key.
  const addrs = addressesIn(datum);
  if (!addrs.length || addrs.some((a) => a.payment.kind !== "key" || !same(a.payment.hash, x.paymentKeyHash))) throw bad("datum: pays someone else");
  if (kind === "v1" || kind === "stable") {
    // [sender, receiver, receiverDatumHash (Maybe), step, batcherFee, depositADA]
    if (d.fields.length !== 6 || !isNone(d.fields[2])) throw bad("datum: v1 layout");
    const step = constrOf(d.fields[3]!);
    if (!step || step.index !== 0) throw bad("datum: not a swap");
    if (kind === "v1") {
      // SwapExactIn [desiredAsset, minimumReceived]
      if (assetUnit(step.fields[0]) !== x.buy) throw bad("datum: wrong asset");
      return int(step.fields[1]);
    }
    // Stableswap SWAP [assetInIndex, assetOutIndex, minimumAssetOut]
    return int(step.fields[2]);
  }
  // V2: [canceller, refundReceiver, refundReceiverDatum, successReceiver, successReceiverDatum, lpAsset, step, maxBatcherFee, expiry]
  if (d.fields.length !== 9) throw bad("datum: v2 layout");
  const canceller = constrOf(d.fields[0]!);
  const pkh = canceller?.fields[0];
  if (!canceller || canceller.index !== 0 || !(pkh instanceof Uint8Array) || !same(pkh, x.paymentKeyHash)) throw bad("datum: canceller");
  const noDatum = (v: CborValue | undefined) => {
    const c = v === undefined ? null : constrOf(v);
    return !!c && c.index === 0 && c.fields.length === 0;
  };
  if (!noDatum(d.fields[2]) || !noDatum(d.fields[4])) throw bad("datum: extra receiver datum");
  const lp = assetUnit(d.fields[5]);
  if (x.lpTokens.length && !x.lpTokens.includes(lp)) throw bad("datum: other pool");
  const step = constrOf(d.fields[6]!);
  if (!step || step.index !== 0 || step.fields.length !== 4) throw bad("datum: not a swap");
  // SwapExactIn [direction, swapAmount, minimumReceived, killable]
  const amount = constrOf(step.fields[1]!);
  if (!amount || (amount.index === 0 && int(amount.fields[0]) !== x.amountIn)) throw bad("datum: amount");
  return int(step.fields[2]);
}

/** Checks a Minswap-built order transaction against the quote. Throws a plain ClipError when anything is off. */
export function verifyMinswapTx(tx: ParsedTx, x: MinswapCheck): { orders: number; spentAda: bigint } {
  const b = tx.body;
  if (b.certs.length || b.withdrawals.length || b.mint.size || b.collateral.length || b.requiredSigners.length || b.referenceInputs.length) throw bad("body: extra parts");
  if (b.votingProcedures || b.proposals.length || b.donation || b.unknownKeys.length || b.collateralReturn || b.totalCollateral !== undefined) throw bad("body: governance/unknown");
  if (b.networkId !== undefined && b.networkId !== x.networkId) throw bad("body: network");
  for (const [k] of tx.witness.entries) if (Number(k) !== 4) throw bad("witness: scripts or signatures");
  if (b.fee > MAX_TX_FEE) throw bad("fee too high");
  const datums = witnessDatums(tx);
  let orderAda = 0n;
  const orderAssets = new Map<string, bigint>();
  let otherAda = 0n;
  let guaranteed = 0n;
  let orders = 0;
  for (const o of b.outputs) {
    const a = parseAddressBytes(o.address);
    if (a.networkId !== x.networkId) throw bad("output: network");
    if (o.scriptRef) throw bad("output: script reference");
    const pay = a.payment;
    if (pay?.kind === "key" && same(pay.hash, x.paymentKeyHash)) {
      if (o.datum) throw bad("output: datum on change");
      continue;
    }
    const kind = pay?.kind === "script" ? MINSWAP_ORDER_SCRIPTS[hex(pay.hash)] : undefined;
    if (kind) {
      const datum = outputDatum(tx, o, datums);
      if (datum === null) throw bad("order: no datum");
      guaranteed += checkOrderDatum(kind, datum, x);
      orderAda += o.value.coin;
      for (const [u, q] of o.value.assets) orderAssets.set(u, (orderAssets.get(u) ?? 0n) + q);
      orders++;
      continue;
    }
    if (o.value.assets.size || o.datum) throw bad("output: unknown recipient");
    otherAda += o.value.coin;
  }
  if (!orders) throw bad("no order");
  if (otherAda > x.aggregatorFee) throw bad("output: unexpected payment");
  if (guaranteed < x.minOut) throw bad("minimum below quote");
  const extra = x.dexFee + x.deposits;
  if (x.sell === "lovelace") {
    if (orderAssets.size || orderAda > x.amountIn + extra) throw bad("order: amount");
  } else {
    if (orderAssets.size !== 1 || orderAssets.get(x.sell) !== x.amountIn || orderAda > extra) throw bad("order: amount");
  }
  return { orders, spentAda: orderAda + otherAda + b.fee };
}

export class MinswapSwap implements SwapProvider {
  readonly id = "minswap";
  readonly name = "Minswap";
  readonly family = "cardano" as const;

  constructor(private readonly opts: { base?: string; partner?: string } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "cardano") return { code: "swap/wrong-family", message: "Minswap only swaps on Cardano." };
    if (network.testnet) return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  private unit(a: { address?: string; symbol: string }): string {
    if (!a.address) return "lovelace";
    const u = a.address.toLowerCase();
    if (!/^[0-9a-f]{56,120}$/.test(u)) throw new ClipError(`${a.symbol} can't be swapped here.`, "swap/unsupported-asset");
    return u;
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    const estimate: EstimateBody = {
      amount: req.amount,
      token_in: this.unit(req.sell),
      token_out: this.unit(req.buy),
      slippage: req.slippageBps / 100,
      include_protocols: ["MinswapV2"],
      allow_multi_hops: false,
    };
    if (this.opts.partner) estimate.partner = this.opts.partner;
    const base = this.opts.base ?? MINSWAP_AGG_BASE;
    const q = await fetchJson<EstimateResponse>(ctx.fetch, `${base}/estimate`, "Minswap", { body: estimate });
    if (!q.amount_out || BigInt(q.amount_out) <= 0n) throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
    if (q.token_in !== estimate.token_in || q.token_out !== estimate.token_out || q.amount_in !== req.amount) {
      throw new ClipError("This swap quote looks wrong, so Clip Wallet stopped it.", "swap/unexpected-quote");
    }
    const hops = (q.paths ?? []).flat();
    if (!hops.length || hops.some((h) => !PROTOCOL_LABELS[h.protocol])) throw new ClipError("This swap quote looks wrong, so Clip Wallet stopped it.", "swap/unexpected-route");
    const buyAmount = BigInt(q.amount_out);
    const ours = minOut(buyAmount, req.slippageBps);
    const theirs = BigInt(q.min_amount_out || "0");
    const floor = ours > theirs ? ours : theirs;
    const data: MinswapQuoteData = {
      estimate,
      minOut: floor.toString(),
      dexFee: q.total_dex_fee ?? "0",
      deposits: q.deposits ?? "0",
      aggregatorFee: q.aggregator_fee ?? "0",
      lpTokens: hops.filter((h) => h.protocol === "MinswapV2" && h.lp_token).map((h) => h.lp_token!.toLowerCase()),
    };
    const quote: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: buyAmount.toString(),
      minBuyAmount: floor.toString(),
      slippageBps: req.slippageBps,
      route: [...new Set(hops.map((h) => PROTOCOL_LABELS[h.protocol]!))],
      expiresAt: Date.now() + 30_000,
      data,
    };
    if (typeof q.avg_price_impact === "number") quote.priceImpactPct = q.avg_price_impact;
    return quote;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const d = quote.data as MinswapQuoteData;
    const base = this.opts.base ?? MINSWAP_AGG_BASE;
    const res = await fetchJson<{ cbor?: string }>(ctx.fetch, `${base}/build-tx`, "Minswap", {
      body: { sender: ctx.account.address, min_amount_out: d.minOut, estimate: d.estimate },
      timeoutMs: 20_000,
    });
    if (typeof res.cbor !== "string" || !/^[0-9a-f]+$/i.test(res.cbor)) throw new ClipError("Minswap didn't return a transaction. Try again.", "swap/no-transaction");
    let tx: ParsedTx;
    try {
      tx = parseTransaction(Uint8Array.from(res.cbor.match(/../g)!.map((h) => parseInt(h, 16))));
    } catch (cause) {
      throw new ClipError("Minswap's transaction couldn't be read, so Clip Wallet stopped it.", "swap/unexpected-transaction", cause);
    }
    const me = meOf(ctx);
    verifyMinswapTx(tx, {
      paymentKeyHash: me.paymentKeyHash,
      sell: d.estimate.token_in,
      buy: d.estimate.token_out,
      amountIn: BigInt(quote.sellAmount),
      minOut: BigInt(d.minOut),
      dexFee: BigInt(d.dexFee),
      deposits: BigInt(d.deposits),
      aggregatorFee: BigInt(d.aggregatorFee),
      lpTokens: d.lpTokens,
      networkId: me.networkId,
    });
    // Inputs must be this wallet's own coins (looked up on Koios, not taken from Minswap's word).
    const koios = new Koios(ctx.network.indexerUrl ?? ctx.network.rpcUrls[0] ?? "", ctx.fetch);
    const refs = tx.body.inputs.map((i) => utxoRef(i.txHash, i.index));
    const found = await koios.utxoInfo(refs);
    const mine = new Set(
      found
        .filter((u) => {
          try {
            const p = parseAddressBytes(addressToBytes(u.address));
            return p.payment?.kind === "key" && same(p.payment.hash, me.paymentKeyHash) && !u.is_spent;
          } catch {
            return false;
          }
        })
        .map((u) => `${u.tx_hash}#${u.tx_index}`),
    );
    if (!refs.length || refs.some((r) => !mine.has(r))) throw bad("inputs: not ours");

    const request: DappRequest = {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "cardano",
      networkId: ctx.network.id,
      method: CARDANO_METHODS.signAndSubmitTx,
      params: { tx: res.cbor.toLowerCase() },
    };
    const lines = [
      { label: "You get at least", value: `${formatUnits(quote.minBuyAmount, quote.buy.decimals)} ${quote.buy.symbol}` },
      { label: "Order fee", value: `${formatUnits(d.dexFee, 6)} ADA to Minswap's order processors` },
    ];
    if (BigInt(d.deposits) > 0n) lines.push({ label: "Comes back", value: `${formatUnits(d.deposits, 6)} ADA deposit, with your ${quote.buy.symbol}` });
    if (BigInt(d.aggregatorFee) > 0n) lines.push({ label: "Minswap fee", value: `${formatUnits(d.aggregatorFee, 6)} ADA` });
    lines.push({ label: "If the price moves too far", value: "The order waits; you can cancel it in Minswap and get everything back" });
    return [
      {
        title: `Swap ${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol} for ~${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}`,
        lines,
        request,
      },
    ];
  }
}
