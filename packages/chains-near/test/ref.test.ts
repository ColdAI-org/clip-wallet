import type { DappRequest } from "@clip-wallet/core";
import { base58 } from "@scure/base";
import { beforeEach, describe, expect, it } from "vitest";
import {
  NEAR_METHODS,
  NEAR_TESTNET,
  REF_CONTRACTS,
  USDC_CONTRACTS,
  checkRefRoute,
  clearTokenCache,
  createNearModule,
  decodeTransaction,
  encodeTransaction,
  parsePublicKey,
  parseRefSwapMsg,
  refSwapTransactions,
  type RefSwapAction,
} from "../src/index.js";
import { ctxFor, fullAccess, makeAccount, mockNear, viewAccount } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const PK = parsePublicKey(FIX.publicKey);
const USDC = USDC_CONTRACTS.testnet;
const REF = REF_CONTRACTS.testnet;
const POOL = "kiln.pool.f863973.m0";
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const near = createNearModule();

function chain() {
  const m = mockNear({
    block: { header: { hash: FIX.blockHash, height: 271356934 } },
    gas_price: { gas_price: "100000000" },
    [`view_access_key:${ME}`]: fullAccess(FIX.accessKeyNonce),
    [`view_account:${ME}`]: viewAccount((100n * NEAR).toString()),
    [`call:${USDC}:ft_metadata`]: { spec: "ft-1.0.0", name: "USDC", symbol: "USDC", decimals: 6 },
    "call:wrap.testnet:ft_metadata": { spec: "ft-1.0.0", name: "Wrapped NEAR fungible token", symbol: "wNEAR", decimals: 24 },
  });
  return { ...m, ctx: ctxFor(makeAccount(ME), m.fetch) };
}

const hop = (a: Partial<RefSwapAction>): RefSwapAction => ({ pool_id: 1845, token_in: "wrap.testnet", token_out: USDC, min_amount_out: "0", ...a });

function wallet(params: unknown, method: string = NEAR_METHODS.signAndSendTransactions): DappRequest {
  return { id: "r1", origin: "clip-wallet", via: "injected", family: "near", networkId: NEAR_TESTNET.id, method, params };
}

/** Normalises the request like the module does, then encodes and decodes each transaction with the borsh codec. */
function borshRoundTrip(request: DappRequest) {
  const n = near.normalize(request, ME, PK);
  if (n.kind !== "build") throw new Error("expected build");
  const blockHash = base58.decode(FIX.blockHash);
  return n.txs.map((t, i) => decodeTransaction(encodeTransaction({ signerId: t.signerId, publicKey: PK, nonce: BigInt(i + 1), receiverId: t.receiverId, blockHash, actions: t.actions })));
}

beforeEach(() => clearTokenCache());

describe("Ref Finance swap transactions", () => {
  it("NEAR → USDC: registers with USDC, then wraps and swaps in one transaction", async () => {
    const actions = [hop({ amount_in: NEAR.toString(), min_amount_out: "750000" })];
    const txs = refSwapTransactions(
      { networkId: NEAR_TESTNET.id, sell: null, buy: USDC, amountIn: NEAR.toString(), actions, register: [{ contract: USDC, deposit: "1250000000000000000000" }, { contract: "wrap.testnet", deposit: "1250000000000000000000" }] },
      ME,
    );
    expect(txs.map((t) => t.receiverId)).toEqual([USDC, "wrap.testnet"]);
    const [reg, swap] = borshRoundTrip(wallet({ transactions: txs }));
    expect(reg!.receiverId).toBe(USDC);
    expect(reg!.actions).toHaveLength(1);
    const r = reg!.actions[0]!;
    if (r.kind !== "FunctionCall") throw new Error("kind");
    expect(r.methodName).toBe("storage_deposit");
    expect(JSON.parse(new TextDecoder().decode(r.args))).toEqual({ account_id: ME, registration_only: true });
    expect(r.deposit).toBe(1_250_000_000_000_000_000_000n);

    expect(swap!.receiverId).toBe("wrap.testnet");
    expect(swap!.signerId).toBe(ME);
    const [sd, wrap, call] = swap!.actions;
    if (sd?.kind !== "FunctionCall" || wrap?.kind !== "FunctionCall" || call?.kind !== "FunctionCall") throw new Error("kind");
    expect(sd.methodName).toBe("storage_deposit");
    expect(wrap.methodName).toBe("near_deposit");
    expect(wrap.deposit).toBe(NEAR);
    expect(wrap.gas).toBe(10n * TGAS);
    expect(call.methodName).toBe("ft_transfer_call");
    expect(call.deposit).toBe(1n);
    expect(call.gas).toBe(300n * TGAS);
    const args = JSON.parse(new TextDecoder().decode(call.args)) as { receiver_id: string; amount: string; msg: string };
    expect(args.receiver_id).toBe(REF);
    expect(args.amount).toBe(NEAR.toString());
    expect(JSON.parse(args.msg)).toEqual({ force: 0, actions: [{ pool_id: 1845, token_in: "wrap.testnet", token_out: USDC, amount_in: NEAR.toString(), min_amount_out: "750000" }] });
  });

  it("decodes the swap plainly: amounts in, at least out, no blind warning", async () => {
    const { ctx } = chain();
    const actions = [hop({ amount_in: NEAR.toString(), min_amount_out: "750000" })];
    const txs = refSwapTransactions({ networkId: NEAR_TESTNET.id, sell: null, buy: USDC, amountIn: NEAR.toString(), actions, register: [] }, ME);
    const d = await near.decode(wallet({ transactions: txs }), ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Swap 1 wNEAR for at least 0.75 USDC");
    expect(d.lines.find((l) => l.label === "Exchange")?.value).toBe(`Ref Finance (${REF})`);
    expect(d.lines.find((l) => l.label === "Also")?.value).toBe("Wrap 1 NEAR into wNEAR");
    const changes = Object.fromEntries(d.balanceChanges.map((c) => [c.asset.symbol, c.delta]));
    expect(changes).toEqual({ NEAR: (-(NEAR + 1n)).toString(), USDC: "750000" });
  });

  it("USDC → NEAR asks the exchange to unwrap and shows NEAR coming in", async () => {
    const { ctx } = chain();
    const actions = [hop({ token_in: USDC, token_out: "wrap.testnet", amount_in: "1000000", min_amount_out: (12n * NEAR / 10n).toString() })];
    const [tx, ...rest] = refSwapTransactions({ networkId: NEAR_TESTNET.id, sell: USDC, buy: null, amountIn: "1000000", actions, register: [] }, ME);
    expect(rest).toEqual([]);
    const req = wallet({ receiverId: tx!.receiverId, actions: tx!.actions }, NEAR_METHODS.signAndSendTransaction);
    const [decoded] = borshRoundTrip(req);
    expect(decoded!.receiverId).toBe(USDC);
    const a = decoded!.actions[0]!;
    if (a.kind !== "FunctionCall") throw new Error("kind");
    expect(JSON.parse((JSON.parse(new TextDecoder().decode(a.args)) as { msg: string }).msg).skip_unwrap_near).toBe(false);
    const d = await near.decode(req, ctx);
    expect(d.title).toBe("Swap 1 USDC for at least 1.2 NEAR");
    expect(Object.fromEntries(d.balanceChanges.map((c) => [c.asset.symbol, c.delta]))).toEqual({ USDC: "-1000000", NEAR: (12n * NEAR / 10n - 1n).toString() });
  });

  it("a swap message to a contract that isn't the exchange stays a plain token transfer", async () => {
    const { ctx } = chain();
    const msg = JSON.stringify({ force: 0, actions: [hop({ token_in: USDC, amount_in: "1000000", token_out: "wrap.testnet", min_amount_out: "1" })] });
    const req = wallet({ receiverId: USDC, actions: [{ type: "FunctionCall", params: { methodName: "ft_transfer_call", args: { receiver_id: "evil.testnet", amount: "1000000", msg }, gas: "300000000000000", deposit: "1" } }] }, NEAR_METHODS.signAndSendTransaction);
    expect((await near.decode(req, ctx)).title).toBe("Send 1 USDC to evil.testnet");
  });

  it("checks routes: start, connection, end, minimum and total", () => {
    const a = (x: Partial<RefSwapAction>) => hop(x);
    expect(checkRefRoute([a({ amount_in: "10", min_amount_out: "5" })], "wrap.testnet", USDC, 10n)).toEqual({ minOut: 5n });
    const twoHop = [a({ amount_in: "10", token_out: "mid.testnet" }), a({ token_in: "mid.testnet", min_amount_out: "4" })];
    expect(checkRefRoute(twoHop, "wrap.testnet", USDC, 10n)).toEqual({ minOut: 4n });
    const parallel = [a({ amount_in: "6", min_amount_out: "3" }), a({ amount_in: "4", min_amount_out: "2", pool_id: 2206 })];
    expect(checkRefRoute(parallel, "wrap.testnet", USDC, 10n)).toEqual({ minOut: 5n });
    expect(checkRefRoute([a({ min_amount_out: "5" })], "wrap.testnet", USDC, 10n)).toHaveProperty("error");
    expect(checkRefRoute([a({ amount_in: "10", min_amount_out: "0" })], "wrap.testnet", USDC, 10n)).toHaveProperty("error");
    expect(checkRefRoute([a({ amount_in: "9", min_amount_out: "5" })], "wrap.testnet", USDC, 10n)).toHaveProperty("error");
    expect(checkRefRoute([a({ amount_in: "10", min_amount_out: "5", token_out: "other.testnet" })], "wrap.testnet", USDC, 10n)).toHaveProperty("error");
    expect(checkRefRoute([a({ amount_in: "10", token_out: "mid.testnet" }), a({ token_in: "x.testnet", min_amount_out: "4" })], "wrap.testnet", USDC, 10n)).toHaveProperty("error");
    expect(checkRefRoute([a({ amount_in: "10", token_in: "x.testnet", min_amount_out: "4" })], "wrap.testnet", USDC, 10n)).toHaveProperty("error");
    expect(() => refSwapTransactions({ networkId: NEAR_TESTNET.id, sell: null, buy: USDC, amountIn: "10", actions: [a({ amount_in: "9", min_amount_out: "1" })], register: [] }, ME)).toThrow();
  });

  it("parses only well-formed swap messages", () => {
    expect(parseRefSwapMsg(JSON.stringify({ actions: [{ pool_id: "7", token_in: "a.testnet", token_out: "b.testnet", min_amount_out: "1" }] }))?.actions[0]?.pool_id).toBe(7);
    expect(parseRefSwapMsg("not json")).toBeNull();
    expect(parseRefSwapMsg(JSON.stringify({ actions: [] }))).toBeNull();
    expect(parseRefSwapMsg(JSON.stringify({ actions: [{ pool_id: 1, token_in: "A", token_out: "b.testnet", min_amount_out: "1" }] }))).toBeNull();
    expect(parseRefSwapMsg(JSON.stringify({ actions: [{ pool_id: 1, token_in: "a.testnet", token_out: "b.testnet", min_amount_out: 1 }] }))).toBeNull();
  });
});

describe("staking builders: unstake everything, withdraw an amount", () => {
  it("unstake without an amount is unstake_all; withdraw with an amount is withdraw {amount}", async () => {
    const { ctx } = chain();
    const all = await near.staking.buildUnstake({ validator: POOL }, ctx);
    const [u] = borshRoundTrip(all);
    const ua = u!.actions[0]!;
    if (ua.kind !== "FunctionCall") throw new Error("kind");
    expect([u!.receiverId, ua.methodName, ua.gas, ua.deposit]).toEqual([POOL, "unstake_all", 125n * TGAS, 0n]);
    expect((await near.decode(all, ctx)).title).toBe("Unstake everything from kiln");
    const some = await near.staking.buildWithdraw({ validator: POOL, amount: (3n * NEAR).toString() }, ctx);
    const [w] = borshRoundTrip(some);
    const wa = w!.actions[0]!;
    if (wa.kind !== "FunctionCall") throw new Error("kind");
    expect(wa.methodName).toBe("withdraw");
    expect(JSON.parse(new TextDecoder().decode(wa.args))).toEqual({ amount: (3n * NEAR).toString() });
    expect((await near.decode(some, ctx)).title).toBe("Withdraw 3 NEAR of unstaked NEAR from kiln");
  });
});
