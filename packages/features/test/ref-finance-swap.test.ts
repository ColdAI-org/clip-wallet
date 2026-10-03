import { type AssetRef, ClipError, type DappRequest } from "@clip-wallet/core";
import { USDC_CONTRACTS, clearTokenCache, createNearModule, decodeTransaction, encodeTransaction, parsePublicKey } from "@clip-wallet/chains-near";
import { beforeEach, describe, expect, it } from "vitest";
import { RefFinanceSwap, verifyRefRequest } from "../src/swap/ref-finance.js";
import { minOut } from "../src/swap/types.js";
import { SEPOLIA } from "./helpers.js";
import { ME_NEAR, NEAR_MAIN, NEAR_PK, NEAR_TEST, YOCTO, decodeBasics, mockNearRpc, nearCtx, viewAccount } from "./near-fixtures.js";

const TGAS = 10n ** 12n;
const USDC_T = USDC_CONTRACTS.testnet;
const USDC_M = USDC_CONTRACTS.mainnet;
const FRAX = "853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near";
const nearMod = createNearModule();

const nearT: AssetRef = NEAR_TEST.nativeAsset;
const nearM: AssetRef = NEAR_MAIN.nativeAsset;
const usdcT: AssetRef = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: NEAR_TEST.id, address: USDC_T };
const usdcM: AssetRef = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: NEAR_MAIN.id, address: USDC_M };

/** Shape of a live smart-router answer (GET smartrouter.ref.finance/findPath, 1 NEAR → USDC, 2026-10-03). */
function routerAnswer(over: Record<string, unknown> = {}, minLast = "4651818") {
  return {
    result_code: 0,
    result_message: "",
    result_data: {
      routes: [
        {
          pools: [
            { pool_id: "4525", token_in: "wrap.near", token_out: FRAX, amount_in: YOCTO.toString(), amount_out: "0", min_amount_out: "0" },
            { pool_id: "4514", token_in: FRAX, token_out: USDC_M, amount_in: "0", amount_out: "0", min_amount_out: minLast },
          ],
          amount_in: YOCTO.toString(),
          min_amount_out: minLast,
          amount_out: "0",
        },
      ],
      contract_in: "wrap.near",
      contract_out: USDC_M,
      amount_in: YOCTO.toString(),
      amount_out: "4675194",
      ...over,
    },
  };
}

const TESTNET_POOLS = {
  "call:ref-finance-101.testnet:get_pool": (a: Record<string, unknown>) => ({ pool_kind: "SIMPLE_POOL", token_account_ids: ["wrap.testnet", USDC_T], amounts: ["1", "1"], total_fee: a.pool_id === 1845 ? 30 : 20 }),
  "call:ref-finance-101.testnet:get_return": (a: Record<string, unknown>) => {
    const out = a.token_in === "wrap.testnet" ? { 1845: "754817", 2206: "480000" } : { 1845: (12n * YOCTO / 10n).toString(), 2206: YOCTO.toString() };
    return out[a.pool_id as 1845 | 2206];
  },
};

const META = {
  [`call:${USDC_T}:ft_metadata`]: { spec: "ft-1.0.0", name: "USDC", symbol: "USDC", decimals: 6 },
  "call:wrap.testnet:ft_metadata": { spec: "ft-1.0.0", name: "Wrapped NEAR fungible token", symbol: "wNEAR", decimals: 24 },
};

function borsh(request: DappRequest) {
  const n = nearMod.normalize(request, ME_NEAR, parsePublicKey(NEAR_PK));
  if (n.kind !== "build") throw new Error("expected built transactions");
  return n.txs.map((t, i) => decodeTransaction(encodeTransaction({ signerId: t.signerId, publicKey: parsePublicKey(NEAR_PK), nonce: BigInt(i + 6), receiverId: t.receiverId, blockHash: new Uint8Array(32).fill(9), actions: t.actions })));
}

function calls(tx: ReturnType<typeof borsh>[number]) {
  return tx.actions.map((a) => {
    if (a.kind !== "FunctionCall") throw new Error("expected function calls only");
    return { method: a.methodName, args: JSON.parse(new TextDecoder().decode(a.args)) as Record<string, unknown>, gas: a.gas, deposit: a.deposit };
  });
}

async function rejects(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
  return e as ClipError;
}

beforeEach(() => clearTokenCache());

describe("Ref Finance: availability", () => {
  it("works on NEAR mainnet and testnet only", () => {
    const p = new RefFinanceSwap();
    expect(p.availability(NEAR_TEST)).toBeNull();
    expect(p.availability(NEAR_MAIN)).toBeNull();
    expect(p.availability(SEPOLIA)?.code).toBe("swap/wrong-family");
  });
});

describe("Ref Finance: mainnet quotes from the smart router", () => {
  it("asks the keyless router and keeps its checked route", async () => {
    const { fetch, calls: seen } = mockNearRpc({}, [[/smartrouter\.ref\.finance\/findPath/, routerAnswer()]]);
    const q = await new RefFinanceSwap().quote({ sell: nearM, buy: usdcM, amount: YOCTO.toString(), slippageBps: 50 }, nearCtx(fetch, NEAR_MAIN));
    const url = new URL(seen[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ amountIn: YOCTO.toString(), tokenIn: "wrap.near", tokenOut: USDC_M, pathDeep: "3", slippage: "0.005" });
    expect(q).toMatchObject({ providerId: "ref-finance", provider: "Ref Finance", sellAmount: YOCTO.toString(), buyAmount: "4675194", minBuyAmount: "4651818", route: ["Ref Finance"], slippageBps: 50 });
    expect(q.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
    expect((q.data as { actions: unknown[] }).actions).toEqual([
      { pool_id: 4525, token_in: "wrap.near", token_out: FRAX, amount_in: YOCTO.toString(), min_amount_out: "0" },
      { pool_id: 4514, token_in: FRAX, token_out: USDC_M, min_amount_out: "4651818" },
    ]);
  });

  it("refuses routes that don't match the request or promise less than the slippage floor", async () => {
    const quote = (answer: unknown) => {
      const { fetch } = mockNearRpc({}, [[/findPath/, answer]]);
      return new RefFinanceSwap().quote({ sell: nearM, buy: usdcM, amount: YOCTO.toString(), slippageBps: 50 }, nearCtx(fetch, NEAR_MAIN));
    };
    await rejects(quote(routerAnswer({}, "4000000")), "swap/bad-route");
    await rejects(quote(routerAnswer({ contract_out: FRAX })), "swap/bad-route");
    await rejects(quote(routerAnswer({ amount_in: "5" })), "swap/bad-route");
    const wrongEnd = routerAnswer();
    wrongEnd.result_data.routes[0]!.pools[1]!.token_out = "evil.near";
    await rejects(quote(wrongEnd), "swap/bad-route");
    await rejects(quote({ result_code: -1, result_message: "no path", result_data: {} }), "swap/no-route");
  });
});

describe("Ref Finance: testnet quotes on-chain", () => {
  it("quotes the known wNEAR/USDC pools with get_return and picks the best", async () => {
    const { fetch } = mockNearRpc(TESTNET_POOLS);
    const q = await new RefFinanceSwap().quote({ sell: nearT, buy: usdcT, amount: YOCTO.toString(), slippageBps: 100 }, nearCtx(fetch));
    expect(q.buyAmount).toBe("754817");
    expect(q.minBuyAmount).toBe(minOut(754817n, 100).toString());
    expect((q.data as { actions: unknown[] }).actions).toEqual([{ pool_id: 1845, token_in: "wrap.testnet", token_out: USDC_T, amount_in: YOCTO.toString(), min_amount_out: "747268" }]);
  });

  it("other testnet pairs say plainly they aren't available", async () => {
    const { fetch } = mockNearRpc(TESTNET_POOLS);
    const other: AssetRef = { key: "nep141:ref.fakes.testnet", symbol: "REF", name: "Ref", decimals: 18, networkId: NEAR_TEST.id, address: "ref.fakes.testnet" };
    const e = await rejects(new RefFinanceSwap().quote({ sell: nearT, buy: other, amount: YOCTO.toString(), slippageBps: 50 }, nearCtx(fetch)), "swap/unsupported-pair");
    expect(e.userMessage).toMatch(/isn't available in this test version yet/);
    await rejects(new RefFinanceSwap().quote({ sell: nearT, buy: { ...usdcT, address: "wrap.testnet" }, amount: "1", slippageBps: 50 }, nearCtx(fetch)), "swap/same-token");
  });
});

describe("Ref Finance: building the swap", () => {
  it("NEAR → USDC: registers with USDC, then wraps and swaps in one transaction, exact amount and on-chain minimum", async () => {
    const { fetch } = mockNearRpc({
      ...decodeBasics,
      ...TESTNET_POOLS,
      ...META,
      [`view_account:${ME_NEAR}`]: viewAccount(10n * YOCTO),
      [`call:${USDC_T}:storage_balance_of`]: null,
      [`call:${USDC_T}:storage_balance_bounds`]: { min: "1250000000000000000000", max: "1250000000000000000000" },
      "call:wrap.testnet:storage_balance_of": { total: "1250000000000000000000", available: "0" },
    });
    const ctx = nearCtx(fetch);
    const p = new RefFinanceSwap();
    const q = await p.quote({ sell: nearT, buy: usdcT, amount: YOCTO.toString(), slippageBps: 100 }, ctx);
    const [step, ...more] = await p.build(q, ctx);
    expect(more).toEqual([]);
    expect(step!.title).toBe("Swap 1 NEAR for USDC");
    const req = step!.request as DappRequest;
    expect(req).toMatchObject({ family: "near", networkId: "near:testnet", method: "near_signAndSendTransactions", origin: "clip-wallet" });

    const [reg, swap] = borsh(req);
    expect([reg!.signerId, reg!.receiverId, swap!.signerId, swap!.receiverId]).toEqual([ME_NEAR, USDC_T, ME_NEAR, "wrap.testnet"]);
    expect(calls(reg!)).toEqual([{ method: "storage_deposit", args: { account_id: ME_NEAR, registration_only: true }, gas: 30n * TGAS, deposit: 1_250_000_000_000_000_000_000n }]);
    const [wrap, transfer] = calls(swap!);
    expect(wrap).toEqual({ method: "near_deposit", args: {}, gas: 10n * TGAS, deposit: YOCTO });
    expect(transfer!.method).toBe("ft_transfer_call");
    expect(transfer!.deposit).toBe(1n);
    expect(transfer!.gas).toBe(300n * TGAS);
    expect(transfer!.args.receiver_id).toBe("ref-finance-101.testnet");
    expect(transfer!.args.amount).toBe(YOCTO.toString());
    expect(JSON.parse(transfer!.args.msg as string)).toEqual({ force: 0, actions: [{ pool_id: 1845, token_in: "wrap.testnet", token_out: USDC_T, amount_in: YOCTO.toString(), min_amount_out: "747268" }] });

    expect(step!.verify!(req)).toBe(true);
    const d = await nearMod.decode(req, ctx);
    expect(d.blind).toBe(false);
    expect(d.lines.find((l) => l.label === "Transaction 2")?.value).toBe("Swap 1 wNEAR for at least 0.747268 USDC");
    expect(Object.fromEntries(d.balanceChanges.map((c) => [c.asset.symbol, c.delta]))).toEqual({ NEAR: (-(YOCTO + 1_250_000_000_000_000_000_000n + 1n)).toString(), USDC: "747268" });
  });

  it("USDC → NEAR: one transaction to the token, unwrapped by the exchange", async () => {
    const { fetch } = mockNearRpc({
      ...decodeBasics,
      ...TESTNET_POOLS,
      ...META,
      [`call:${USDC_T}:ft_balance_of`]: "5000000",
      "call:wrap.testnet:storage_balance_of": { total: "1", available: "0" },
    });
    const ctx = nearCtx(fetch);
    const p = new RefFinanceSwap();
    const q = await p.quote({ sell: usdcT, buy: nearT, amount: "1000000", slippageBps: 50 }, ctx);
    const [step] = await p.build(q, ctx);
    const req = step!.request as DappRequest;
    expect(req.method).toBe("near_signAndSendTransaction");
    const [tx] = borsh(req);
    expect(tx!.receiverId).toBe(USDC_T);
    const [call] = calls(tx!);
    expect(call!.method).toBe("ft_transfer_call");
    expect(JSON.parse(call!.args.msg as string)).toEqual({
      force: 0,
      actions: [{ pool_id: 1845, token_in: USDC_T, token_out: "wrap.testnet", amount_in: "1000000", min_amount_out: minOut(12n * YOCTO / 10n, 50).toString() }],
      skip_unwrap_near: false,
    });
    expect(step!.verify!(req)).toBe(true);
    expect((await nearMod.decode(req, ctx)).title).toBe("Swap 1 USDC for at least 1.194 NEAR");
  });

  it("checks the balance before building", async () => {
    const { fetch } = mockNearRpc({ ...TESTNET_POOLS, ...META, [`call:${USDC_T}:ft_balance_of`]: "10", "call:wrap.testnet:storage_balance_of": { total: "1", available: "0" } });
    const ctx = nearCtx(fetch);
    const p = new RefFinanceSwap();
    const q = await p.quote({ sell: usdcT, buy: nearT, amount: "1000000", slippageBps: 50 }, ctx);
    await rejects(p.build(q, ctx), "swap/insufficient");
  });

  it("verify refuses anything but the expected exchange call", () => {
    const msg = JSON.stringify({ force: 0, actions: [{ pool_id: 1845, token_in: USDC_T, token_out: "wrap.testnet", amount_in: "1000000", min_amount_out: "1" }] });
    const req = (receiver: string, method = "ft_transfer_call", m = msg): DappRequest => ({
      id: "x",
      origin: "clip-wallet",
      via: "injected",
      family: "near",
      networkId: NEAR_TEST.id,
      method: "near_signAndSendTransaction",
      params: { signerId: ME_NEAR, receiverId: USDC_T, actions: [{ type: "FunctionCall", params: { methodName: method, args: { receiver_id: receiver, amount: "1000000", msg: m }, gas: "1", deposit: "1" } }] },
    });
    expect(verifyRefRequest(req("ref-finance-101.testnet"), NEAR_TEST.id, ME_NEAR, USDC_T, "wrap.testnet")).toBe(true);
    expect(verifyRefRequest(req("evil.testnet"), NEAR_TEST.id, ME_NEAR, USDC_T, "wrap.testnet")).toBe(false);
    expect(verifyRefRequest(req("ref-finance-101.testnet", "ft_transfer"), NEAR_TEST.id, ME_NEAR, USDC_T, "wrap.testnet")).toBe(false);
    expect(verifyRefRequest(req("ref-finance-101.testnet", "ft_transfer_call", msg.replace("wrap.testnet", "evil.testnet")), NEAR_TEST.id, ME_NEAR, USDC_T, "wrap.testnet")).toBe(false);
  });
});
