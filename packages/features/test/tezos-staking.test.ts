import { TEZOS_SHADOWNET } from "@clip-wallet/chains-tezos";
import type { DappRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { TezosStaking, bakerChoice, rankBakers, type TzktBaker } from "../src/staking/tezos.js";
import { mockFetch, type Route } from "./helpers.js";
import { NODE_ROUTES, TZKT_DEFAULTS, TZ_ME, decodeTitle, forgeAndParse, tezosCtx } from "./tezos-fixtures.js";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const KRAKEN = "tz1RCFbB9GpALpsZtu6J58sb74dm8qe6XBzv";
const COINBASE = "tz1irJKkXS2DBWkU1NnmFQx1c1L7pbGg4yhk";
const KILN = "tz3dKooaL9Av4UY15AUx9uRGL5H6YyqoGSPV";
const STALE = "tz1S7GgVV4FPEGUVzepKBwx22DyNikdpa4X6";
const FULL = "tz1N29q5T3jJ2i1JEWHax7q1NRkDMADj6fof";

/** TzKT /v1/delegates records (mainnet, 2026-10-03, trimmed to the selected fields). */
const BAKERS: TzktBaker[] = [
  { address: KRAKEN, alias: "Kraken Baker", active: true, stakedBalance: 6547360892629, externalStakedBalance: 52872926613355, limitOfStakingOverBaking: 9000000, edgeOfBakingOverStaking: 100000000, bakingPower: 62459385199462, ownDelegatedBalance: 212514245659, externalDelegatedBalance: 8904778834776, stakersCount: 95, numDelegators: 3855, lastActivityTime: "2026-10-03T11:57:34Z" },
  { address: COINBASE, alias: "Coinbase Baker", active: true, stakedBalance: 13543448887903, externalStakedBalance: 0, limitOfStakingOverBaking: null, edgeOfBakingOverStaking: null, bakingPower: 43880054593207, ownDelegatedBalance: 1118791969724, externalDelegatedBalance: 89891025146188, lastActivityTime: "2026-10-03T11:57:34Z" },
  { address: KILN, alias: "Kiln", active: true, stakedBalance: 3101687838430, externalStakedBalance: 23976482100566, limitOfStakingOverBaking: 9000000, edgeOfBakingOverStaking: 200000000, bakingPower: 34790630492175, ownDelegatedBalance: 8842847508, externalDelegatedBalance: 23128538812029, lastActivityTime: "2026-10-03T11:57:34Z" },
  { address: STALE, alias: null, active: true, stakedBalance: 12959526736, externalStakedBalance: 9014674, limitOfStakingOverBaking: 5000000, edgeOfBakingOverStaking: 10000000, bakingPower: 12992288807, lastActivityTime: "2026-09-20T00:00:00Z" },
  { address: FULL, alias: "Full House", active: true, stakedBalance: 1000000000000, externalStakedBalance: 9000000000000, limitOfStakingOverBaking: 9000000, edgeOfBakingOverStaking: 50000000, bakingPower: 10000000000000, ownDelegatedBalance: 0, externalDelegatedBalance: 0, lastActivityTime: "2026-10-03T11:57:34Z" },
];
const STATS = { totalSupply: 1117801196534122, totalBakingPower: 440450248920861 };

const net = TEZOS_SHADOWNET;
const account = (delegate: { address: string; alias?: string } | null, staked = 0, unstaked = 0) => ({ address: TZ_ME, balance: 100_000_000 + staked + unstaked, stakedBalance: staked, unstakedBalance: unstaked, delegate });

function routes(acct: unknown, requests: unknown[] = []): Route[] {
  return [
    ...NODE_ROUTES,
    [/\/context\/issuance\/current_yearly_rate$/, "3.057"],
    [/\/v1\/statistics\/current$/, STATS],
    [/\/v1\/delegates\?active=true/, BAKERS],
    [/\/v1\/delegates\/(tz[1-4]\w+)$/, (url: string) => BAKERS.find((b) => url.endsWith(b.address)) ?? null],
    [new RegExp(`/v1/accounts/${TZ_ME}$`), acct],
    [/\/v1\/staking\/unstake_requests\?staker=/, requests],
    ...TZKT_DEFAULTS,
  ];
}

function setup(acct: unknown, requests: unknown[] = []) {
  const { fetch, calls } = mockFetch(routes(acct, requests));
  return { ctx: tezosCtx(net, fetch), calls, staking: new TezosStaking({ now: () => NOW }) };
}

const req = (s: { request: DappRequest | (() => Promise<DappRequest>) }) => s.request as DappRequest;

describe("Tezos bakers", () => {
  it("reads limit (millionths) and edge (billionths); room = own stake × limit − external stake", () => {
    const k = bakerChoice(BAKERS[0]!, 7.758);
    expect(k).toMatchObject({ name: "Kraken Baker", acceptsStaking: true, edge: 0.1, overDelegated: false });
    expect(k.room).toBe(6547360892629n * 9n - 52872926613355n);
    expect(k.stakeApy).toBeCloseTo(6.982, 2);
    const c = bakerChoice(BAKERS[1]!, 7.758);
    expect(c).toMatchObject({ acceptsStaking: false, edge: 1, room: 0n });
    expect(c.stakeApy).toBeUndefined();
    expect(bakerChoice(BAKERS[3]!).name).toBe("Baker tz1S…a4X6");
  });

  it("ranks: staking with room, lowest edge first; full and delegation-only after; stale dropped", () => {
    const r = rankBakers(BAKERS, NOW, 7.758).map((c) => c.baker.address);
    expect(r).toEqual([KRAKEN, KILN, FULL, COINBASE]);
  });

  it("options: plain words, one recommended, APY from issuance × supply / baking power", async () => {
    const { ctx, calls, staking } = setup(account(null));
    const opts = await staking.options(ctx);
    expect(opts.map((o) => o.id)).toEqual([KRAKEN, KILN, FULL, COINBASE]);
    expect(opts.filter((o) => o.recommended).map((o) => o.id)).toEqual([KRAKEN]);
    expect(opts[0]!.title).toBe("Kraken Baker");
    expect(opts[0]!.detail).toBe("Staking earns about 6.98% a year · keeps 10% of staking rewards · room to stake 6,053,321 XTZ");
    expect(opts[0]!.apy).toBeCloseTo(6.98, 1);
    expect(opts[2]!.detail).toContain("full for staking, delegation only");
    expect(opts[3]!.detail).toBe("Delegation only (doesn't accept staking)");
    expect(opts[3]!.apy).toBeUndefined();
    expect(calls.some((c) => c.url.startsWith("https://api.shadownet.tzkt.io/v1/delegates?active=true"))).toBe(true);
    expect(await staking.rewardRate(ctx)).toBe("About 6.98% a year when staked");
  });

  it("no APY when the node can't answer", async () => {
    const { fetch } = mockFetch(routes(account(null)).filter(([re]) => !String(re).includes("yearly")));
    const s = new TezosStaking({ now: () => NOW });
    const opts = await s.options(tezosCtx(net, fetch));
    expect(opts[0]!.apy).toBeUndefined();
    expect(opts[0]!.detail.startsWith("keeps 10% of staking rewards")).toBe(true);
  });
});

describe("Tezos positions", () => {
  it("splits delegated, staked, unlocking and ready XTZ", async () => {
    const { ctx, staking } = setup(account({ address: KRAKEN, alias: "Kraken Baker" }, 30_000_000, 1_500_000), [
      { baker: { address: KRAKEN, alias: "Kraken Baker" }, requestedAmount: 1000000, actualAmount: 1000000, finalizedAmount: 0, status: "pending", unlockTime: "2026-10-06T10:00:00Z" },
      { baker: { address: KILN, alias: "Kiln" }, requestedAmount: 500000, actualAmount: 500000, finalizedAmount: 0, status: "finalizable" },
    ]);
    const p = await staking.positions(ctx);
    expect(p.map((x) => [x.id, x.amount, x.status, x.statusText, x.actions])).toEqual([
      [`delegated:${KRAKEN}`, "100000000", "active", "Delegated: still spendable, the baker pays out rewards", ["change", "unstake"]],
      [`staked:${KRAKEN}`, "30000000", "active", "Staked: earning rewards", ["unstake"]],
      [`unstaking:${KRAKEN}`, "1000000", "deactivating", "Unlocking. Ready in about 3 days", []],
      [`withdrawable:${KILN}`, "500000", "withdrawable", "Ready to move back to your balance", ["withdraw"]],
    ]);
    expect(p[1]).toMatchObject({ with: "Kraken Baker", amountDisplay: "30 XTZ", symbol: "XTZ", decimals: 6, partialUnstake: true, networkId: net.id });
  });

  it("nothing when not delegating", async () => {
    const { ctx, staking } = setup(account(null));
    expect(await staking.positions(ctx)).toEqual([]);
  });
});

describe("Tezos stake / unstake / withdraw", () => {
  it("0 = delegate only to the recommended baker (forged and parsed back)", async () => {
    const { ctx, staking } = setup(account(null));
    const b = await staking.buildStake({ amount: "0" }, ctx);
    expect(b.steps).toHaveLength(1);
    expect(b.steps[0]!.title).toBe("Delegate your XTZ to Kraken Baker");
    expect(b.steps[0]!.lines).toContainEqual({ label: "Your XTZ", value: "Stays in your account and spendable" });
    const ops = await forgeAndParse(req(b.steps[0]!), ctx);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "delegation", delegate: KRAKEN });
    expect((await decodeTitle(req(b.steps[0]!), ctx)).title).toBe("Delegate to Kraken Baker");
  });

  it("an amount delegates and stakes in one batch", async () => {
    const { ctx, staking } = setup(account(null));
    const b = await staking.buildStake({ amount: "50000000", optionId: KILN }, ctx);
    expect(b.steps[0]!.title).toBe("Stake 50 XTZ");
    expect(b.steps[0]!.lines).toEqual([
      { label: "With", value: "Kiln" },
      { label: "Baker keeps", value: "20% of staking rewards" },
      { label: "Unstaking", value: "Takes about 4 days" },
    ]);
    const ops = await forgeAndParse(req(b.steps[0]!), ctx);
    expect(ops.map((o) => o.kind)).toEqual(["delegation", "transaction"]);
    expect(ops[0]!.delegate).toBe(KILN);
    expect(ops[1]).toMatchObject({ destination: TZ_ME, amount: "50000000", parameters: { entrypoint: "stake", value: { prim: "Unit" } } });
    const d = await decodeTitle(req(b.steps[0]!), ctx);
    expect(d).toMatchObject({ title: "Stake 50 XTZ with Kiln", blind: false });
  });

  it("already delegated there: only the stake op", async () => {
    const { ctx, staking } = setup(account({ address: KRAKEN, alias: "Kraken Baker" }));
    const b = await staking.buildStake({ amount: "2000000", optionId: KRAKEN }, ctx);
    const ops = await forgeAndParse(req(b.steps[0]!), ctx);
    expect(ops.map((o) => (o.parameters as { entrypoint?: string } | undefined)?.entrypoint ?? o.kind)).toEqual(["stake"]);
  });

  it("refuses staking with a baker that doesn't accept it, one that's full, and bad amounts", async () => {
    const { ctx, staking } = setup(account(null));
    await expect(staking.buildStake({ amount: "1000000", optionId: COINBASE }, ctx)).rejects.toMatchObject({ code: "staking/baker-refuses-staking" });
    await expect(staking.buildStake({ amount: "1000000", optionId: FULL }, ctx)).rejects.toMatchObject({ code: "staking/baker-full" });
    await expect(staking.buildStake({ amount: "1.5" }, ctx)).rejects.toMatchObject({ code: "staking/bad-amount" });
    await expect(staking.buildStake({ amount: "0", optionId: "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GM" }, ctx)).rejects.toMatchObject({ code: "staking/unknown-option" });
    // Delegation-only with that baker is fine.
    const ok = await staking.buildStake({ amount: "0", optionId: COINBASE }, ctx);
    expect(ok.steps[0]!.title).toBe("Delegate your XTZ to Coinbase Baker");
  });

  it("partial and full unstake from the staked position", async () => {
    const { ctx, staking } = setup(account({ address: KRAKEN, alias: "Kraken Baker" }, 30_000_000));
    const part = await staking.buildUnstake({ positionId: `staked:${KRAKEN}`, amount: "20000000" }, ctx);
    expect(part.steps[0]!.title).toBe("Unstake 20 XTZ");
    const ops = await forgeAndParse(req(part.steps[0]!), ctx);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "transaction", destination: TZ_ME, amount: "20000000", parameters: { entrypoint: "unstake", value: { prim: "Unit" } } });
    expect((await decodeTitle(req(part.steps[0]!), ctx)).title).toBe("Unstake 20 XTZ from Kraken Baker");
    const all = await staking.buildUnstake({ positionId: `staked:${KRAKEN}` }, ctx);
    expect((await forgeAndParse(req(all.steps[0]!), ctx))[0]!.amount).toBe("30000000");
    await expect(staking.buildUnstake({ positionId: `staked:${KRAKEN}`, amount: "30000001" }, ctx)).rejects.toMatchObject({ code: "staking/too-much" });
    await expect(staking.buildUnstake({ positionId: "nonsense" }, ctx)).rejects.toMatchObject({ code: "staking/unknown-position" });
    // Stopping delegation while staked is refused in plain words.
    await expect(staking.buildUnstake({ positionId: `delegated:${KRAKEN}` }, ctx)).rejects.toMatchObject({ code: "tezos/still-staked" });
  });

  it("unstake on the delegated position stops delegating", async () => {
    const { ctx, staking } = setup(account({ address: KRAKEN, alias: "Kraken Baker" }));
    const b = await staking.buildUnstake({ positionId: `delegated:${KRAKEN}` }, ctx);
    expect(b.steps[0]!.title).toBe("Stop delegating your XTZ");
    const ops = await forgeAndParse(req(b.steps[0]!), ctx);
    expect(ops[0]!.kind).toBe("delegation");
    expect(ops[0]!.delegate).toBeUndefined();
    expect((await decodeTitle(req(b.steps[0]!), ctx)).title).toBe("Stop delegating");
  });

  it("withdraw = finalize_unstake, only when something is ready", async () => {
    const { ctx, staking } = setup(account({ address: KRAKEN, alias: "Kraken Baker" }), [
      { baker: { address: KRAKEN, alias: "Kraken Baker" }, requestedAmount: 2500000, actualAmount: 2500000, finalizedAmount: 0, status: "finalizable" },
    ]);
    const b = await staking.buildWithdraw({ positionId: `withdrawable:${KRAKEN}` }, ctx);
    expect(b.steps[0]!.title).toBe("Move 2.5 XTZ back to your balance");
    const ops = await forgeAndParse(req(b.steps[0]!), ctx);
    expect(ops[0]).toMatchObject({ kind: "transaction", destination: TZ_ME, amount: "0", parameters: { entrypoint: "finalize_unstake", value: { prim: "Unit" } } });
    expect((await decodeTitle(req(b.steps[0]!), ctx)).title).toBe("Withdraw your unstaked XTZ");
    await expect(staking.buildWithdraw({ positionId: `staked:${KRAKEN}` }, ctx)).rejects.toMatchObject({ code: "staking/not-withdrawable" });
  });

  it("supports only Tezos networks with a node and an indexer", () => {
    const s = new TezosStaking();
    expect(s.supports(net)).toBe(true);
    expect(s.supports({ ...net, indexerUrl: undefined })).toBe(false);
    expect(s).toMatchObject({ family: "tezos", assetKey: "xtz", wholeBalance: false });
  });
});
