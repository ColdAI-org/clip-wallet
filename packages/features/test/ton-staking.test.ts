import type { DappRequest } from "@clip-wallet/core";
import { DEFI_OP, cellFromBase64, createTonModule, opOf, parseJettonBurn, parseSendTx, parseTonstakersDeposit, rawTonAddress, sameTonAddress } from "@clip-wallet/chains-ton";
import { describe, expect, it } from "vitest";
import { refineDecoded, registerIntent } from "../src/steps.js";
import { DEPOSIT_FEE, TONSTAKERS, TonStaking, UNSTAKE_FEE, checkTonstakersRequest } from "../src/staking/ton.js";
import { mockFetch } from "./helpers.js";
import { TON_MAIN, TON_TEST, rawOf, tonCtx, tonMe } from "./ton-fixtures.js";

const POOL_RAW = rawTonAddress(TONSTAKERS.testnet.pool);
const MY_TSTON_WALLET = rawOf(0x5a);

/** tonapi /v2/staking/pool/{addr} (live testnet answer, 2026-10-03). */
const POOL = {
  implementation: { name: "Tonstakers", description: "Minimum deposit 1 GRAM", url: "https://tonstakers.com/" },
  pool: {
    address: POOL_RAW,
    name: "Tonstakers",
    total_amount: 301538167050321,
    implementation: "liquidTF",
    apy: 3.2238202318850107,
    min_stake: 1000000000,
    liquid_jetton_master: TONSTAKERS.testnet.tsTON,
  },
};

/** get_pool_full_data: total_balance at stack[2], supply at stack[13]; ratio 1.2 GRAM per tsTON. */
function poolData(balance = 1_200_000_000_000n, supply = 1_000_000_000_000n) {
  const stack = Array.from({ length: 20 }, () => ({ type: "num", num: "0x0" }));
  stack[2] = { type: "num", num: `0x${balance.toString(16)}` };
  stack[13] = { type: "num", num: `0x${supply.toString(16)}` };
  return {
    success: true,
    exit_code: 0,
    stack,
    decoded: { total_balance: Number(balance), supply: Number(supply), projected_balance: 1_250_000_000_000, projected_supply: 1_000_000_000_000, deposits_open: true, halted: false },
  };
}

const tsTON = (balance: string) => ({ balance, wallet_address: { address: MY_TSTON_WALLET }, jetton: { address: TONSTAKERS.testnet.tsTON, symbol: "tsTON", decimals: 9 } });

function routes(o: { tsTON?: unknown; data?: unknown } = {}) {
  return mockFetch([
    [/\/v2\/staking\/pool\//, POOL],
    [/get_pool_full_data/, o.data ?? poolData()],
    [/\/v2\/accounts\/[^/]+\/jettons\//, o.tsTON ?? tsTON("10000000000"), o.tsTON === null ? 404 : 200],
  ]);
}

describe("TON staking (Tonstakers)", () => {
  const s = new TonStaking();

  it("supports TON networks; speaks in GRAM", () => {
    expect(s.supports(TON_TEST)).toBe(true);
    expect(s.supports(TON_MAIN)).toBe(true);
    expect(s.assetKey).toBe("gram");
    expect(s.wholeBalance).toBe(false);
  });

  it("one recommended option with the pool's APY from tonapi", async () => {
    const { fetch, calls } = routes();
    const ctx = tonCtx(TON_TEST, fetch);
    const [o] = await s.options(ctx);
    expect(calls[0]!.url).toBe(`https://testnet.tonapi.test/v2/staking/pool/${POOL_RAW}`);
    expect(o).toMatchObject({ id: "tonstakers", title: "Tonstakers", recommended: true });
    expect(o!.apy).toBeCloseTo(3.2238);
    expect(o!.detail).toContain("at least 1 GRAM");
    expect(await s.rewardRate!(ctx)).toBe("About 3.2% a year");
  });

  it("refuses a pool whose token isn't the allow-listed tsTON", async () => {
    const { fetch } = mockFetch([[/staking\/pool/, { ...POOL, pool: { ...POOL.pool, liquid_jetton_master: rawOf(0x99) } }]]);
    await expect(s.options(tonCtx(TON_TEST, fetch))).rejects.toMatchObject({ code: "stake/unexpected-pool" });
  });

  it("position: tsTON balance valued in GRAM at the pool's exact rate", async () => {
    const { fetch, calls } = routes();
    const [p] = await s.positions(tonCtx(TON_TEST, fetch));
    expect(calls[0]!.url).toBe(`https://testnet.tonapi.test/v2/accounts/${tonMe(TON_TEST)}/jettons/${TONSTAKERS.testnet.tsTON}`);
    expect(p).toMatchObject({ id: "tonstakers", amount: "12000000000", amountDisplay: "12 GRAM", with: "Tonstakers", status: "active", actions: ["unstake"], partialUnstake: true });
    expect(p!.statusText).toBe("Earning rewards · you hold 10 tsTON");
  });

  it("no tsTON → no positions", async () => {
    const { fetch } = routes({ tsTON: null });
    expect(await s.positions(tonCtx(TON_TEST, fetch))).toEqual([]);
  });

  it("stake: deposit to the allow-listed pool with 1 GRAM fee attached; BoC parsed back", async () => {
    const { fetch } = routes();
    const ctx = tonCtx(TON_TEST, fetch);
    const { steps } = await s.buildStake({ amount: "50000000000" }, ctx);
    expect(steps[0]!.title).toBe("Stake 50 GRAM");
    expect(steps[0]!.lines).toContainEqual({ label: "You get about", value: "40 tsTON" });
    const r = steps[0]!.request as DappRequest;
    const tx = parseSendTx(r.params);
    expect(tx).toMatchObject({ network: "-3", from: tonMe(TON_TEST) });
    const m = tx.messages![0]!;
    expect(m.address).toBe(TONSTAKERS.testnet.pool); // friendly, bounceable, test-only
    expect(BigInt(m.amount)).toBe(50_000_000_000n + DEPOSIT_FEE);
    const body = cellFromBase64(m.payload!);
    expect(opOf(body)).toBe(DEFI_OP.tonstakersDeposit);
    expect(parseTonstakersDeposit(body).queryId).toBe(1n);
    expect(steps[0]!.verify!(r)).toBe(true);
    expect(checkTonstakersRequest(r, { kind: "stake", pool: rawOf(0x01), amount: 50_000_000_000n })).toBe(false);
    expect(checkTonstakersRequest(r, { kind: "stake", pool: POOL_RAW, amount: 1n })).toBe(false);
  });

  it("stake: at least 1 GRAM, and not while deposits are closed", async () => {
    const { fetch } = routes();
    await expect(s.buildStake({ amount: "500000000" }, tonCtx(TON_TEST, fetch))).rejects.toMatchObject({ code: "stake/too-small" });
    const closed = poolData();
    closed.decoded.deposits_open = false;
    const c = routes({ data: closed });
    await expect(s.buildStake({ amount: "5000000000" }, tonCtx(TON_TEST, c.fetch))).rejects.toMatchObject({ code: "stake/closed" });
  });

  it("unstake all: burns your whole tsTON at your own tsTON wallet, response to you", async () => {
    const { fetch } = routes();
    const { steps } = await s.buildUnstake({ positionId: "tonstakers" }, tonCtx(TON_TEST, fetch));
    expect(steps[0]!.title).toBe("Unstake 12 GRAM");
    const r = steps[0]!.request as DappRequest;
    const m = parseSendTx(r.params).messages![0]!;
    expect(sameTonAddress(m.address, MY_TSTON_WALLET)).toBe(true);
    expect(BigInt(m.amount)).toBe(UNSTAKE_FEE);
    const b = parseJettonBurn(cellFromBase64(m.payload!));
    expect(b).toMatchObject({ amount: 10_000_000_000n, responseDestination: tonMe(TON_TEST), waitTillRoundEnd: false, fillOrKill: false });
    expect(steps[0]!.verify!(r)).toBe(true);
  });

  it("partial unstake: a GRAM amount converts to tsTON at the current rate (capped at what you hold)", async () => {
    const { fetch } = routes();
    const { steps } = await s.buildUnstake({ positionId: "tonstakers", amount: "6000000000" }, tonCtx(TON_TEST, fetch));
    const m = parseSendTx((steps[0]!.request as DappRequest).params).messages![0]!;
    expect(parseJettonBurn(cellFromBase64(m.payload!)).amount).toBe(5_000_000_000n);
    const all = await s.buildUnstake({ positionId: "tonstakers", amount: "999000000000" }, tonCtx(TON_TEST, routes().fetch));
    const m2 = parseSendTx((all.steps[0]!.request as DappRequest).params).messages![0]!;
    expect(parseJettonBurn(cellFromBase64(m2.payload!)).amount).toBe(10_000_000_000n);
  });

  it("the TON module decodes the deposit as blind; verify + clean emulation give the plain title", async () => {
    const { fetch: f1 } = routes();
    const { steps } = await s.buildStake({ amount: "50000000000" }, tonCtx(TON_TEST, f1));
    const request = steps[0]!.request as DappRequest;
    const { fetch } = mockFetch([
      [/\/v3\/walletInformation/, { balance: "60000000000", status: "active", seqno: 2 }],
      [/\/events\/emulate/, { actions: [{ TonTransfer: { sender: { address: tonMe(TON_TEST) }, recipient: { address: POOL_RAW }, amount: "51000000000" } }], extra: -5_000_000 }],
    ]);
    const decoded = await createTonModule({ minIntervalMs: 0, now: () => 1_790_000_000 }).decode(request, tonCtx(TON_TEST, fetch));
    expect(decoded.blind).toBe(true);
    registerIntent(request, { title: steps[0]!.title, lines: steps[0]!.lines ?? [], verify: steps[0]!.verify });
    const refined = refineDecoded(request, decoded);
    expect(refined).toMatchObject({ blind: false, title: "Stake 50 GRAM" });
  });

  it("nothing staked → plain error on unstake", async () => {
    const { fetch } = routes({ tsTON: null });
    await expect(s.buildUnstake({ positionId: "tonstakers" }, tonCtx(TON_TEST, fetch))).rejects.toMatchObject({ code: "stake/nothing-staked" });
  });
});
