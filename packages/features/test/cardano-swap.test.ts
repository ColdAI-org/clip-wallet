import {
  CARDANO_METHODS,
  CborMap,
  CborTag,
  type CborValue,
  addressToBech32,
  addressToBytes,
  createCardanoModule,
  encodeCbor,
  parseTransaction,
  rewardAddress,
  witnessDatums,
} from "@clip-wallet/chains-cardano";
import type { AssetRef, DappRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { DexHunterSwap } from "../src/swap/dexhunter.js";
import { MINSWAP_AGG_BASE, MinswapSwap, verifyMinswapTx } from "../src/swap/minswap.js";
import type { Route } from "./helpers.js";
import { ADDR_MAIN, CARDANO_MAINNET, CARDANO_PREPROD, PKH, SKH, STRANGER, TX_A, cardanoCtx, koiosUtxo } from "./cardano-fixtures.js";

const UNIT = "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344"; // DjedMicroUSD
const LP = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4ca939812d08cfb6066e17d2914a7272c6b8c0197acdf68157d02c73649cc3efc0";
const V2_ORDER = "c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c";
const V1_ORDER = "a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b";

const ADA: AssetRef = CARDANO_MAINNET.nativeAsset;
const DJED: AssetRef = { key: `cnt:${UNIT}`, symbol: "DJED", name: "Djed", decimals: 6, networkId: CARDANO_MAINNET.id, address: UNIT };

const ESTIMATE = {
  token_in: "lovelace",
  token_out: UNIT,
  amount_in: "5000000",
  amount_out: "1215696",
  min_amount_out: "1209647",
  total_lp_fee: "15000",
  total_dex_fee: "2000000",
  deposits: "2000000",
  avg_price_impact: 0.3,
  paths: [[{ protocol: "MinswapV2", lp_token: LP, token_in: "lovelace", token_out: UNIT, amount_in: "5000000", amount_out: "1215696" }]],
};

const h = (s: string) => Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)));
const C = (i: number, fields: CborValue[]) => new CborTag(121 + i, fields);
const cred = (hash: Uint8Array) => C(0, [hash]);
const plutusAddr = (pay: Uint8Array, stake: Uint8Array) => C(0, [cred(pay), C(0, [C(0, [cred(stake)])])]);
const orderAddress = (script: string) => Uint8Array.of(0x11, ...h(script), ...SKH);
const OUR_ADDR = addressToBytes(ADDR_MAIN);

interface Variant {
  receiver?: Uint8Array;
  canceller?: Uint8Array;
  minimum?: number;
  orderCoin?: number;
  extraOutput?: [Uint8Array, number];
  withdrawal?: boolean;
  script?: string;
  v1?: boolean;
  desired?: string;
}

/** The order transaction Minswap's /build-tx returns (shape checked against live V1 and V2 builds, 2026-10-03). */
function orderTx(v: Variant = {}): string {
  const receiver = v.receiver ?? PKH;
  let datum: CborValue;
  if (v.v1) {
    const asset = C(0, [h((v.desired ?? UNIT).slice(0, 56)), h((v.desired ?? UNIT).slice(56))]);
    datum = C(0, [plutusAddr(PKH, SKH), plutusAddr(receiver, SKH), C(1, []), C(0, [asset, v.minimum ?? 1209647]), 2_000_000, 2_000_000]);
  } else {
    datum = C(0, [
      C(0, [v.canceller ?? PKH]),
      plutusAddr(receiver, SKH),
      C(0, []),
      plutusAddr(receiver, SKH),
      C(0, []),
      C(0, [h(LP.slice(0, 56)), h(LP.slice(56))]),
      C(0, [C(1, []), C(0, [5_000_000]), v.minimum ?? 1209647, C(0, [])]),
      2_000_000,
      C(1, []),
    ]);
  }
  const witness = v.v1 ? new CborMap([[4, [datum]]]) : new CborMap();
  let datumField: CborValue = [1, new CborTag(24, encodeCbor(datum))];
  if (v.v1) {
    const probe = parseTransaction(encodeCbor([new CborMap([[0, []], [1, []], [2, 0]]), witness, true, null]));
    datumField = [0, h([...witnessDatums(probe).keys()][0]!)];
  }
  const outputs: CborValue[] = [
    new CborMap([[0, orderAddress(v.script ?? (v.v1 ? V1_ORDER : V2_ORDER))], [1, v.orderCoin ?? 9_000_000], [2, datumField]]),
    new CborMap([[0, OUR_ADDR], [1, 10_785_087]]),
  ];
  if (v.extraOutput) outputs.push(new CborMap([[0, v.extraOutput[0]], [1, v.extraOutput[1]]]));
  const body = new CborMap([
    [0, new CborTag(258, [[h(TX_A), 0]])],
    [1, outputs],
    [2, 214_913],
    [3, 199_473_461],
    ...(v.withdrawal ? ([[5, new CborMap([[rewardAddress(1, { kind: "key", hash: SKH }), 1]])]] as [CborValue, CborValue][]) : []),
  ]);
  return Array.from(encodeCbor([body, witness, true, null]), (b) => b.toString(16).padStart(2, "0")).join("");
}

function body(init?: RequestInit): any {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

function routes(cbor: string | (() => string), estimate: unknown = ESTIMATE, inputOwner = ADDR_MAIN): Route[] {
  return [
    [/agg-api\.minswap\.org\/aggregator\/estimate$/, estimate],
    [/agg-api\.minswap\.org\/aggregator\/build-tx$/, () => ({ cbor: typeof cbor === "function" ? cbor() : cbor })],
    [/\/utxo_info$/, [koiosUtxo(TX_A, 0, inputOwner, 20_000_000n)]],
    [/\/asset_info$/, []],
  ];
}

const swap = new MinswapSwap();
const req = { sell: ADA, buy: DJED, amount: "5000000", slippageBps: 50 };

describe("Minswap availability", () => {
  it("is mainnet-only and Cardano-only, in plain words", () => {
    expect(swap.availability(CARDANO_MAINNET)).toBeNull();
    expect(swap.availability(CARDANO_PREPROD)).toEqual({ code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." });
    expect(swap.availability({ ...CARDANO_MAINNET, family: "solana" })?.code).toBe("swap/wrong-family");
  });

  it("DexHunter is wired but off: needs a partner key", () => {
    expect(new DexHunterSwap().availability(CARDANO_MAINNET)).toMatchObject({ code: "swap/not-configured", message: expect.stringContaining("partner key") });
    expect(new DexHunterSwap({ apiKey: "k" }).availability(CARDANO_MAINNET)?.code).toBe("swap/not-verified");
    expect(new DexHunterSwap({ apiKey: "k" }).availability(CARDANO_PREPROD)?.code).toBe("swap/mainnet-only");
  });
});

describe("Minswap quote", () => {
  it("asks for Minswap-only routing with the request's slippage and keeps the stricter minimum", async () => {
    const ctx = cardanoCtx(CARDANO_MAINNET, routes(orderTx()));
    const q = await swap.quote(req, ctx);
    const call = ctx.calls.find((c) => c.url === `${MINSWAP_AGG_BASE}/estimate`)!;
    expect(body(call.init)).toEqual({ amount: "5000000", token_in: "lovelace", token_out: UNIT, slippage: 0.5, include_protocols: ["MinswapV2"], allow_multi_hops: false });
    expect(q).toMatchObject({ provider: "Minswap", buyAmount: "1215696", minBuyAmount: "1209647", route: ["Minswap V2"], priceImpactPct: 0.3 });
    expect(q.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
    const looser = await swap.quote({ ...req, slippageBps: 10 }, cardanoCtx(CARDANO_MAINNET, routes(orderTx())));
    expect(looser.minBuyAmount).toBe((1215696n * 9990n / 10000n).toString());
  });

  it("refuses routes through other DEXes, mismatched quotes and testnets", async () => {
    const other = { ...ESTIMATE, paths: [[{ protocol: "VyFinance", lp_token: "x" }]] };
    await expect(swap.quote(req, cardanoCtx(CARDANO_MAINNET, routes(orderTx(), other)))).rejects.toMatchObject({ code: "swap/unexpected-route" });
    await expect(swap.quote(req, cardanoCtx(CARDANO_MAINNET, routes(orderTx(), { ...ESTIMATE, amount_in: "6000000" })))).rejects.toMatchObject({ code: "swap/unexpected-quote" });
    await expect(swap.quote(req, cardanoCtx(CARDANO_PREPROD, routes(orderTx())))).rejects.toMatchObject({ code: "swap/mainnet-only" });
  });
});

describe("Minswap build", () => {
  it("parses Minswap's transaction back and returns a sign-and-submit request the Cardano module describes", async () => {
    const ctx = cardanoCtx(CARDANO_MAINNET, routes(orderTx()));
    const q = await swap.quote(req, ctx);
    const steps = await swap.build(q, ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe("Swap 5 ADA for ~1.215696 DJED");
    expect(steps[0]!.lines).toContainEqual({ label: "You get at least", value: "1.209647 DJED" });
    expect(steps[0]!.lines).toContainEqual({ label: "Order fee", value: "2 ADA to Minswap's order processors" });
    const r = steps[0]!.request as DappRequest;
    expect(r.method).toBe(CARDANO_METHODS.signAndSubmitTx);
    const buildCall = ctx.calls.find((c) => c.url.endsWith("/build-tx"))!;
    expect(body(buildCall.init)).toMatchObject({ sender: ADDR_MAIN, min_amount_out: "1209647", estimate: { include_protocols: ["MinswapV2"] } });

    const tx = parseTransaction(h((r.params as { tx: string }).tx));
    expect(Buffer.from(tx.body.outputs[0]!.address.subarray(1, 29)).toString("hex")).toBe(V2_ORDER);
    expect(tx.body.outputs[0]!.value.coin).toBe(9_000_000n);
    expect(tx.body.outputs[1]!.address).toEqual(OUR_ADDR);

    const m = createCardanoModule();
    const d = await m.decode(r, ctx);
    expect(d.blind).toBe(false);
    const payloads = await m.prepare(r, ctx, "s1");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.derivationSubPath).toBeUndefined();
  });

  it("accepts a V1 order whose datum travels in the witness set", async () => {
    const ctx = cardanoCtx(CARDANO_MAINNET, routes(orderTx({ v1: true }), { ...ESTIMATE, paths: [[{ protocol: "Minswap", lp_token: "y" }]] }));
    const steps = await swap.build(await swap.quote(req, ctx), ctx);
    expect(steps).toHaveLength(1);
  });

  const refused: [string, Variant | "input" | "garbage", string | undefined][] = [
    ["the order pays someone else", { receiver: STRANGER }, "datum: pays someone else"],
    ["someone else can cancel the order", { canceller: STRANGER }, "datum: canceller"],
    ["the minimum is below the quote", { minimum: 1_000_000 }, "minimum below quote"],
    ["the order takes more ADA than quoted", { orderCoin: 9_500_000 }, "order: amount"],
    ["an extra payment to a stranger", { extraOutput: [Uint8Array.of(0x61, ...STRANGER), 1_000_000] }, "output: unexpected payment"],
    ["a reward withdrawal sneaks in", { withdrawal: true }, "body: extra parts"],
    ["an order to an unknown script", { script: "ab".repeat(28) }, "output: unknown recipient"],
    ["a V1 order for a different token", { v1: true, desired: "11".repeat(28) + "41" }, "datum: wrong asset"],
    ["inputs that aren't ours", "input", "inputs: not ours"],
    ["bytes that aren't a transaction", "garbage", undefined],
  ];
  for (const [why, v, cause] of refused) {
    it(`refuses when ${why}`, async () => {
      const cbor = v === "garbage" ? "deadbeef" : orderTx(typeof v === "object" ? v : {});
      const est = typeof v === "object" && v.v1 ? { ...ESTIMATE, paths: [[{ protocol: "Minswap", lp_token: "y" }]] } : ESTIMATE;
      const ctx = cardanoCtx(CARDANO_MAINNET, routes(cbor, est, v === "input" ? addressToBech32(Uint8Array.of(0x61, ...STRANGER)) : ADDR_MAIN));
      const q = await swap.quote(req, ctx);
      const err = await swap.build(q, ctx).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "swap/unexpected-transaction" });
      if (cause) expect((err as { cause?: unknown }).cause).toBe(cause);
    });
  }

  it("verifyMinswapTx reports what the order holds", () => {
    const tx = parseTransaction(h(orderTx()));
    const out = verifyMinswapTx(tx, {
      paymentKeyHash: PKH,
      sell: "lovelace",
      buy: UNIT,
      amountIn: 5_000_000n,
      minOut: 1_209_647n,
      dexFee: 2_000_000n,
      deposits: 2_000_000n,
      aggregatorFee: 0n,
      lpTokens: [LP],
      networkId: 1,
    });
    expect(out).toEqual({ orders: 1, spentAda: 9_214_913n });
  });
});
