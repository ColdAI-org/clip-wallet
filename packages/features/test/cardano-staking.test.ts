import { CARDANO_METHODS, parseTransaction, poolIdToHex } from "@clip-wallet/chains-cardano";
import type { DappRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { CLAIM_CHOICES, CardanoStaking, networkRate, poolApy, rankPools } from "../src/staking/cardano.js";
import type { Route } from "./helpers.js";
import { ADDR_TEST, CARDANO_PREPROD, REWARD_TEST, SKH, cardanoCtx, koiosBase, poolId } from "./cardano-fixtures.js";

const GOOD = poolId(1);
const CHEAPER_BUT_TINY = poolId(2);
const PRICIER = poolId(3);
const SATURATED = poolId(4);
const PLEDGE_SHORT = poolId(5);
const RETIRING = poolId(6);

const listRow = (id: string, ticker: string, margin: number, fixed: string, stake: string, retiring: number | null = null) => ({
  pool_id_bech32: id,
  ticker,
  margin,
  fixed_cost: fixed,
  pledge: "1000000000",
  active_stake: stake,
  retiring_epoch: retiring,
});

const POOL_LIST = [
  listRow(GOOD, "GOOD", 0.01, "340000000", "40000000000000"),
  listRow(CHEAPER_BUT_TINY, "TINY", 0, "170000000", "500000000000"),
  listRow(PRICIER, "PRCY", 0.03, "340000000", "30000000000000"),
  listRow(SATURATED, "FULL", 0, "170000000", "80000000000000"),
  listRow(PLEDGE_SHORT, "SHRT", 0, "170000000", "35000000000000"),
  listRow(RETIRING, "BYE", 0, "170000000", "36000000000000", 700),
];

const info = (id: string, name: string, margin: number, fixed: string, stake: string, sat: number, extra: Record<string, unknown> = {}) => ({
  pool_id_bech32: id,
  pool_status: "registered",
  retiring_epoch: null,
  margin,
  fixed_cost: fixed,
  pledge: "1000000000",
  live_pledge: "5000000000",
  live_stake: stake,
  active_stake: stake,
  live_saturation: sat,
  meta_json: { name, ticker: name.slice(0, 4).toUpperCase() },
  ...extra,
});

const POOL_INFO: Record<string, unknown> = {
  [GOOD]: info(GOOD, "Good Pool", 0.01, "340000000", "40000000000000", 62),
  [CHEAPER_BUT_TINY]: info(CHEAPER_BUT_TINY, "Tiny", 0, "170000000", "500000000000", 0.8),
  [PRICIER]: info(PRICIER, "Pricy", 0.03, "340000000", "30000000000000", 47),
  [SATURATED]: info(SATURATED, "Full", 0, "170000000", "80000000000000", 104.2),
  [PLEDGE_SHORT]: info(PLEDGE_SHORT, "Short", 0, "170000000", "35000000000000", 50, { live_pledge: "10" }),
  [RETIRING]: info(RETIRING, "Bye", 0, "170000000", "36000000000000", 51, { retiring_epoch: 700 }),
};

/** Mainnet-like epoch: 6.15M ADA rewards on 21.36B ADA staked, 5-day epochs. */
const EPOCH = { epoch_no: 657, active_stake: "21357778069987000", total_rewards: "6145709532459", start_time: 1_789_000_000, end_time: 1_789_432_000 };

function body(init?: RequestInit): any {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

function koios(account: () => Record<string, unknown>): Route[] {
  return [
    [/\/pool_list\?/, POOL_LIST],
    [/\/pool_info$/, (_u: string, init?: RequestInit) => (body(init)._pool_bech32_ids as string[]).map((id) => POOL_INFO[id]).filter(Boolean)],
    [/\/epoch_info\?/, [EPOCH]],
    [/\/account_info$/, () => [{ stake_address: REWARD_TEST, total_balance: "23000000", ...account() }]],
    ...koiosBase(ADDR_TEST),
  ];
}

const ctxWith = (account: () => Record<string, unknown>) => cardanoCtx(CARDANO_PREPROD, koios(account));
const txOf = (r: DappRequest) => parseTransaction(Uint8Array.from((r.params as { tx: string }).tx.match(/../g)!.map((h) => parseInt(h, 16))));
const resolve = async (s: { request: DappRequest | (() => Promise<DappRequest>) }) => (typeof s.request === "function" ? s.request() : s.request);

const DELEGATED = { status: "registered", delegated_pool: GOOD, rewards_available: "4200000", deposit: "2000000" };

describe("Cardano staking: pools", () => {
  it("estimates the network rate from the last paid epoch and a pool's rate after its fees", () => {
    const rate = networkRate(EPOCH)!;
    expect(rate.epochsPerYear).toBeCloseTo(73.05, 1);
    expect(rate.perEpoch * rate.epochsPerYear * 100).toBeCloseTo(2.1, 1);
    const apy = poolApy(POOL_INFO[GOOD] as never, rate)!;
    expect(apy).toBeGreaterThan(2.0);
    expect(apy).toBeLessThan(2.1);
    // a tiny pool's fixed fee eats its rewards
    expect(poolApy(POOL_INFO[CHEAPER_BUT_TINY] as never, rate)).toBeUndefined();
  });

  it("drops saturated, retiring and under-pledged pools and prefers moderate saturation and low cost", () => {
    const ranked = rankPools(Object.values(POOL_INFO) as never, networkRate(EPOCH));
    expect(ranked.map((c) => c.pool.pool_id_bech32)).toEqual([GOOD, PRICIER, CHEAPER_BUT_TINY]);
  });

  it("lists options in plain words with exactly one recommended", async () => {
    const ctx = ctxWith(() => DELEGATED);
    const opts = await new CardanoStaking().options(ctx);
    expect(opts.map((o) => o.id)).toEqual([GOOD, PRICIER, CHEAPER_BUT_TINY]);
    expect(opts.filter((o) => o.recommended).map((o) => o.id)).toEqual([GOOD]);
    expect(opts[0]).toMatchObject({ title: "GOOD · Good Pool" });
    expect(opts[0]!.detail).toMatch(/^Earns about 2(\.\d)?% a year · keeps 1% of rewards · 340 ADA fixed fee · 62% full$/);
    expect(opts[2]!.detail).toBe("Keeps 0% of rewards · 170 ADA fixed fee · under 1% full");
    // pool_list is queried with PostgREST filters, pool_info only for the shortlist
    const list = ctx.calls.find((c) => c.url.includes("/pool_list?"))!.url;
    expect(list).toContain("pool_status=eq.registered");
    expect(list).toContain("margin=lte.0.1");
    await expect(new CardanoStaking().rewardRate(ctx)).resolves.toMatch(/^About 2(\.\d)?% a year$/);
  });
});

describe("Cardano staking: positions", () => {
  it("shows the delegation, rewards and the vote choice needed to claim", async () => {
    const [p] = await new CardanoStaking().positions(ctxWith(() => ({ ...DELEGATED, delegated_drep: null })));
    expect(p).toMatchObject({
      id: REWARD_TEST,
      amount: "23000000",
      amountDisplay: "23 ADA",
      with: "GOOD · Good Pool",
      status: "active",
      statusText: "Earning rewards",
      actions: ["change", "claim", "unstake"],
      pendingReward: { amount: "4200000", display: "4.2 ADA" },
    });
    expect(p!.claimChoices).toEqual(CLAIM_CHOICES);
    expect(p!.claimChoices!.map((c) => c.id)).toEqual(["abstain", "no-confidence"]);
  });

  it("no choices once a vote delegation exists; nothing when not staking; rewards-off when the pool closed", async () => {
    const [a] = await new CardanoStaking().positions(ctxWith(() => ({ ...DELEGATED, delegated_drep: "drep_always_abstain" })));
    expect(a!.claimChoices).toBeUndefined();
    expect(await new CardanoStaking().positions(ctxWith(() => ({ status: "not registered", delegated_pool: null, rewards_available: "0" })))).toEqual([]);
    const [c] = await new CardanoStaking().positions(ctxWith(() => ({ ...DELEGATED, delegated_pool: SATURATED, rewards_available: "0" })));
    expect(c!.actions).toEqual(["change", "unstake"]);
    POOL_INFO[poolId(9)] = info(poolId(9), "Gone", 0, "1", "1", 0, { pool_status: "retired" });
    const [d] = await new CardanoStaking().positions(ctxWith(() => ({ ...DELEGATED, delegated_pool: poolId(9) })));
    expect(d).toMatchObject({ status: "rewards-off", statusText: "Your pool closed. Pick another to keep earning" });
  });
});

describe("Cardano staking: building", () => {
  it("stakes with the recommended pool: registration + delegation certificates", async () => {
    const build = await new CardanoStaking().buildStake({}, ctxWith(() => ({ status: "not registered", delegated_pool: null, rewards_available: "0" })));
    const [step] = build.steps;
    expect(step!.title).toBe("Stake your ADA with GOOD · Good Pool");
    expect(step!.lines).toContainEqual({ label: "Deposit", value: "2 ADA, returned when you stop staking" });
    const r = await resolve(step!);
    expect(r.method).toBe(CARDANO_METHODS.signAndSubmitTx);
    const tx = txOf(r);
    expect(tx.body.certs.map((c) => c.type)).toEqual([0, 2]);
    expect(tx.body.certs[1]!.cred!.hash).toEqual(SKH);
    expect(Buffer.from(tx.body.certs[1]!.pool!).toString("hex")).toBe(poolIdToHex(GOOD));
  });

  it("refuses a picked pool that is saturated", async () => {
    await expect(new CardanoStaking().buildStake({ optionId: SATURATED }, ctxWith(() => DELEGATED))).rejects.toMatchObject({ code: "staking/bad-option" });
  });

  it("claims in one step when a vote delegation exists", async () => {
    const build = await new CardanoStaking().buildClaim({ positionId: REWARD_TEST }, ctxWith(() => ({ ...DELEGATED, delegated_drep: "drep_always_no_confidence" })));
    expect(build.steps).toHaveLength(1);
    expect(build.steps[0]!.title).toBe("Move 4.2 ADA rewards to your balance");
    const tx = txOf(await resolve(build.steps[0]!));
    expect(tx.body.certs).toEqual([]);
    expect(tx.body.withdrawals.map((w) => w.amount)).toEqual([4_200_000n]);
  });

  it("without a vote delegation: needs a choice, then votes first and withdraws once that is on chain", async () => {
    let drep: string | null = null;
    let polls = 0;
    const ctx = ctxWith(() => ({ ...DELEGATED, delegated_drep: drep }));
    const staking = new CardanoStaking({ sleep: async () => void (polls++, (drep = "drep_always_abstain")), pollMs: 1, maxWaitMs: 10 });
    await expect(staking.buildClaim({ positionId: REWARD_TEST }, ctx)).rejects.toMatchObject({ code: "staking/choice-needed" });
    await expect(staking.buildClaim({ positionId: REWARD_TEST, choice: "maybe" }, ctx)).rejects.toMatchObject({ code: "staking/bad-choice" });
    const build = await staking.buildClaim({ positionId: REWARD_TEST, choice: "abstain" }, ctx);
    expect(build.steps.map((s) => s.title)).toEqual(["Set your voting choice: Abstain from votes", "Move 4.2 ADA rewards to your balance"]);
    const vote = txOf(await resolve(build.steps[0]!));
    expect(vote.body.certs).toHaveLength(1);
    expect(vote.body.certs[0]).toMatchObject({ type: 9, drep: { kind: "abstain" } });
    expect(vote.body.withdrawals).toEqual([]);
    const claim = txOf(await resolve(build.steps[1]!));
    expect(polls).toBe(1);
    expect(claim.body.withdrawals.map((w) => w.amount)).toEqual([4_200_000n]);
  });

  it("gives up with a plain message if the vote delegation never shows up", async () => {
    const ctx = ctxWith(() => ({ ...DELEGATED, delegated_drep: null }));
    const staking = new CardanoStaking({ sleep: async () => undefined, pollMs: 1, maxWaitMs: 3 });
    const build = await staking.buildClaim({ positionId: REWARD_TEST, choice: "no-confidence" }, ctx);
    expect(txOf(await resolve(build.steps[0]!)).body.certs[0]!.drep).toEqual({ kind: "no-confidence" });
    await expect(resolve(build.steps[1]!)).rejects.toMatchObject({ code: "staking/not-confirmed" });
  });

  it("unstakes with certificate 8 and the rewards in the same transaction", async () => {
    const build = await new CardanoStaking().buildUnstake({ positionId: REWARD_TEST }, ctxWith(() => ({ ...DELEGATED, delegated_drep: "drep_always_abstain" })));
    expect(build.steps).toHaveLength(1);
    expect(build.steps[0]!.lines).toEqual([
      { label: "Deposit back", value: "2 ADA" },
      { label: "Rewards", value: "4.2 ADA move to your balance" },
    ]);
    const tx = txOf(await resolve(build.steps[0]!));
    expect(tx.body.certs[0]).toMatchObject({ type: 8, deposit: 2_000_000n });
    expect(tx.body.withdrawals.map((w) => w.amount)).toEqual([4_200_000n]);
  });

  it("unstake with rewards but no vote delegation adds the vote step (abstain by default)", async () => {
    let drep: string | null = null;
    const ctx = ctxWith(() => ({ ...DELEGATED, delegated_drep: drep }));
    const build = await new CardanoStaking({ sleep: async () => void (drep = "drep_always_abstain"), pollMs: 1 }).buildUnstake({ positionId: REWARD_TEST }, ctx);
    expect(build.steps.map((s) => s.title)).toEqual(["Set your voting choice: Abstain from votes", "Stop staking ADA"]);
    expect(txOf(await resolve(build.steps[0]!)).body.certs[0]).toMatchObject({ type: 9, drep: { kind: "abstain" } });
    expect(txOf(await resolve(build.steps[1]!)).body.certs[0]).toMatchObject({ type: 8 });
  });

  it("refuses positions that aren't this wallet's", async () => {
    await expect(new CardanoStaking().buildUnstake({ positionId: "stake_test1other" }, ctxWith(() => DELEGATED))).rejects.toMatchObject({ code: "staking/unknown-position" });
  });
});
