import { PASEO_ASSET_HUB, POLKADOT_ASSET_HUB, WESTEND, WESTEND_ASSET_HUB, Enum, createSubstrateModule } from "@clip-wallet/chains-substrate";
import { describe, expect, it } from "vitest";
import { StakingService } from "../src/staking/service.js";
import { POLKADOT_STAKING_KEYS, PolkadotStaking, poolName, polkadotStakingProviders, rankPools } from "../src/staking/polkadot.js";
import { fakeHost, flush } from "./helpers.js";
import { BOB, ME, WND, callOf, ctxFor, enc, mockRpc, seed, ss58, systemAccount } from "./polkadot-fixtures.js";

const PERBILL = 1_000_000_000;
const NOMINATING_BONDED = ss58("11".repeat(32));
const IDLE_BONDED = ss58("22".repeat(32));

function pool(p: { members: number; commissionPct?: number; state?: string; points?: bigint }) {
  return {
    commission: {
      current: p.commissionPct ? [Math.round((p.commissionPct / 100) * PERBILL), BOB] : undefined,
      max: undefined,
      change_rate: undefined,
      throttle_from: undefined,
      claim_permission: undefined,
    },
    member_counter: p.members,
    points: p.points ?? WND(1000),
    roles: { depositor: BOB, root: BOB, nominator: BOB, bouncer: BOB },
    state: Enum(p.state ?? "Open"),
  };
}

const member = (poolId: number, points: bigint, unbonding: [number, bigint][] = []) => ({ pool_id: poolId, points, last_recorded_reward_counter: 0n, unbonding_eras: unbonding });

/** Westend Asset Hub world: 5 pools, eras at 120, 100 WND free, MinJoinBond 1 WND. */
function world(over: { member?: ReturnType<typeof member>; free?: bigint; pending?: bigint; minJoin?: bigint } = {}) {
  seed();
  const storage: Record<string, string> = {
    [enc.key("NominationPools", "BondedPools", 1)]: enc.value("NominationPools", "BondedPools", pool({ members: 40, commissionPct: 2 })),
    [enc.key("NominationPools", "BondedPools", 2)]: enc.value("NominationPools", "BondedPools", pool({ members: 10 })),
    [enc.key("NominationPools", "BondedPools", 3)]: enc.value("NominationPools", "BondedPools", pool({ members: 900, state: "Blocked" })),
    [enc.key("NominationPools", "BondedPools", 4)]: enc.value("NominationPools", "BondedPools", pool({ members: 500, commissionPct: 25 })),
    [enc.key("NominationPools", "BondedPools", 5)]: enc.value("NominationPools", "BondedPools", pool({ members: 70 })), // not nominating
    [enc.key("NominationPools", "Metadata", 1)]: enc.value("NominationPools", "Metadata", new TextEncoder().encode("Good‮ Pool\n one")),
    [enc.key("NominationPools", "MinJoinBond")]: enc.value("NominationPools", "MinJoinBond", over.minJoin ?? WND(1)),
    [enc.key("Staking", "Nominators", NOMINATING_BONDED)]: enc.value("Staking", "Nominators", { targets: [BOB], submitted_in: 1, suppressed: false }),
    [enc.key("Staking", "ActiveEra")]: enc.value("Staking", "ActiveEra", { index: 120, start: 1n }),
    [enc.key("Staking", "CurrentEra")]: enc.value("Staking", "CurrentEra", 121),
    [enc.key("Staking", "AreNominatorsSlashable")]: enc.value("Staking", "AreNominatorsSlashable", false),
    [enc.key("System", "Account", ME)]: enc.value("System", "Account", systemAccount(over.free ?? WND(100))),
  };
  if (over.member) storage[enc.key("NominationPools", "PoolMembers", ME)] = enc.value("NominationPools", "PoolMembers", over.member);
  const rpc = mockRpc(storage, {
    NominationPoolsApi_pool_accounts: ([id]) => enc.api("NominationPoolsApi", "pool_accounts", id === 5 ? [IDLE_BONDED, BOB] : [NOMINATING_BONDED, BOB]),
    NominationPoolsApi_points_to_balance: ([, points]) => enc.api("NominationPoolsApi", "points_to_balance", ((points as bigint) * 102n) / 100n),
    NominationPoolsApi_balance_to_points: ([, bal]) => enc.api("NominationPoolsApi", "balance_to_points", ((bal as bigint) * 100n) / 102n),
    NominationPoolsApi_pending_rewards: enc.api("NominationPoolsApi", "pending_rewards", over.pending ?? 0n),
    TransactionPaymentApi_query_info: enc.api("TransactionPaymentApi", "query_info", { weight: { ref_time: 1n, proof_size: 1n }, class: Enum("Normal"), partial_fee: 15_000_000_000n }),
  });
  return { ctx: ctxFor(rpc.fetch), rpc };
}

describe("Polkadot nomination pools", () => {
  it("stakes on Asset Hubs for its own native key only", () => {
    expect(POLKADOT_STAKING_KEYS).toEqual(["dot", "ksm", "wnd", "pas"]);
    const wnd = new PolkadotStaking({ assetKey: "wnd" });
    expect(wnd.supports(WESTEND_ASSET_HUB)).toBe(true);
    expect(wnd.supports(WESTEND)).toBe(false); // relay chain: no pools since the Asset Hub migration
    expect(wnd.supports(PASEO_ASSET_HUB)).toBe(false);
    expect(polkadotStakingProviders([WESTEND, WESTEND_ASSET_HUB, PASEO_ASSET_HUB]).map((p) => p.assetKey)).toEqual(["wnd", "pas"]);
    expect(polkadotStakingProviders([POLKADOT_ASSET_HUB]).map((p) => p.assetKey)).toEqual(["dot"]);
    expect(wnd.howItWorks).toMatch(/WND/);
    expect(wnd.howItWorks).not.toMatch(/Westend|Asset Hub/);
  });

  it("ranks open, nominating pools by commission then members, with exactly one recommended", async () => {
    const { ctx } = world();
    const opts = await new PolkadotStaking({ assetKey: "wnd" }).options(ctx);
    expect(opts.map((o) => o.id)).toEqual(["2", "1"]); // 3 blocked, 4 over 10 %, 5 not nominating
    expect(opts.filter((o) => o.recommended)).toEqual([opts[0]]);
    expect(opts[0]).toEqual({ id: "2", title: "Pool 2", detail: "Keeps 0% of rewards · 10 members", recommended: true });
    expect(opts[1]).toEqual({ id: "1", title: "Pool 1 · Good Pool one", detail: "Keeps 2% of rewards · 40 members" });
  });

  it("ranks and cleans names without RPC", () => {
    const ranked = rankPools(
      [
        [1, { commission: {}, member_counter: 5, points: 1n, state: { type: "Open" } }],
        [2, { commission: {}, member_counter: 9, points: 1n, state: { type: "Open" } }],
        [3, { commission: {}, member_counter: 99, points: 1n, state: { type: "Open" } }],
        [4, { commission: {}, member_counter: 9, points: 0n, state: { type: "Open" } }],
      ],
      50,
    );
    expect(ranked.map((r) => r.id)).toEqual([2, 1]); // 3 is full, 4 has nothing bonded
    expect(poolName(new TextEncoder().encode("x".repeat(60)))).toHaveLength(40);
    expect(poolName(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });

  it("shows staked, ready and unlocking amounts with era timing", async () => {
    const { ctx } = world({ member: member(1, WND(50), [[118, WND(2)], [120, WND(3)], [122, WND(4)]]), pending: WND(0.25) });
    const pos = await new PolkadotStaking({ assetKey: "wnd" }).positions(ctx);
    expect(pos).toEqual([
      expect.objectContaining({ id: "pool:1", amount: WND(51).toString(), amountDisplay: "51 WND", with: "Pool 1 · Good Pool one", status: "active", actions: ["unstake", "claim"], partialUnstake: true, pendingReward: { amount: WND(0.25).toString(), display: "0.25 WND" } }),
      expect.objectContaining({ id: "pool:1:ready", amount: WND(5).toString(), status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"] }),
      expect.objectContaining({ id: "pool:1:era:122", amount: WND(4).toString(), status: "deactivating", statusText: "Unlocks in about 12 hours", actions: [] }),
    ]);
    expect(pos.every((p) => p.assetKey === "wnd" && p.symbol === "WND" && p.decimals === 12 && p.networkId === WESTEND_ASSET_HUB.id)).toBe(true);
  });

  it("has no positions when you're not in a pool", async () => {
    const { ctx } = world();
    await expect(new PolkadotStaking({ assetKey: "wnd" }).positions(ctx)).resolves.toEqual([]);
  });

  it("joins the recommended pool, checks the minimum and what you can spend", async () => {
    const { ctx } = world();
    const s = new PolkadotStaking({ assetKey: "wnd" });
    const b = await s.buildStake({ amount: WND(10).toString() }, ctx);
    expect(b.steps).toHaveLength(1);
    expect(b.steps[0]!.title).toBe("Stake 10 WND");
    expect(b.steps[0]!.lines).toContainEqual({ label: "Pool", value: "Pool 2" });
    expect(b.steps[0]!.lines).toContainEqual({ label: "Unstaking takes", value: "about 12 hours" });
    const r = b.steps[0]!.request as Exclude<typeof b.steps[0]["request"], () => unknown>;
    expect(r).toMatchObject({ method: "substrate_signAndSubmit", family: "substrate", networkId: WESTEND_ASSET_HUB.id });
    expect(callOf(r)).toEqual({ pallet: "NominationPools", call: "join", args: { amount: WND(10), pool_id: 2 } });

    const picked = await s.buildStake({ amount: WND(10).toString(), optionId: "1" }, ctx);
    expect(callOf(picked.steps[0]!.request as never).args).toEqual({ amount: WND(10), pool_id: 1 });

    await expect(s.buildStake({ amount: WND(0.5).toString() }, ctx)).rejects.toMatchObject({ code: "staking/below-minimum", userMessage: "Stake at least 1 WND to join a pool." });
    await expect(s.buildStake({ amount: WND(100).toString() }, ctx)).rejects.toMatchObject({ code: "staking/insufficient" });
    await expect(s.buildStake({ amount: WND(10).toString(), optionId: "3" }, ctx)).rejects.toMatchObject({ code: "staking/pool-closed" });
    await expect(s.buildStake({ amount: WND(10).toString(), optionId: "77" }, ctx)).rejects.toMatchObject({ code: "staking/unknown-option" });
    await expect(s.buildStake({}, ctx)).rejects.toMatchObject({ code: "staking/bad-amount" });
  });

  it("adds to your pool with bond_extra when you're already a member", async () => {
    const { ctx } = world({ member: member(1, WND(50)) });
    const b = await new PolkadotStaking({ assetKey: "wnd" }).buildStake({ amount: WND(5).toString(), optionId: "2" }, ctx);
    expect(b.steps[0]!.title).toBe("Stake 5 WND more");
    expect(b.steps[0]!.lines).toContainEqual(expect.objectContaining({ label: "Note" }));
    const c = callOf(b.steps[0]!.request as never);
    expect(c.pallet).toBe("NominationPools");
    expect(c.call).toBe("bond_extra");
    expect(c.args).toEqual({ extra: { type: "FreeBalance", value: WND(5) } });
  });

  it("unstakes part (points from balance_to_points) or everything", async () => {
    const { ctx } = world({ member: member(1, WND(50)), pending: WND(1) });
    const s = new PolkadotStaking({ assetKey: "wnd" });
    const part = await s.buildUnstake({ positionId: "pool:1", amount: WND(10.2).toString() }, ctx);
    expect(part.steps[0]!.title).toBe("Unstake 10.2 WND");
    expect(part.steps[0]!.lines).toContainEqual({ label: "Ready", value: "In about 12 hours, then move it back to your balance" });
    expect(part.steps[0]!.lines).toContainEqual({ label: "Rewards", value: "Your 1 WND of rewards are paid to you now" });
    const c = callOf(part.steps[0]!.request as never);
    expect([c.pallet, c.call]).toEqual(["NominationPools", "unbond"]);
    expect(c.args).toEqual({ member_account: { type: "Id", value: ME }, unbonding_points: WND(10) });

    const all = await s.buildUnstake({ positionId: "pool:1" }, ctx);
    expect(all.steps[0]!.title).toBe("Unstake 51 WND");
    expect(callOf(all.steps[0]!.request as never).args).toEqual({ member_account: { type: "Id", value: ME }, unbonding_points: WND(50) });

    await expect(s.buildUnstake({ positionId: "pool:1", amount: WND(50.5).toString() }, ctx)).rejects.toMatchObject({ code: "staking/below-minimum" });
    await expect(s.buildUnstake({ positionId: "pool:1", amount: WND(60).toString() }, ctx)).rejects.toMatchObject({ code: "staking/too-much" });
    await expect(s.buildUnstake({ positionId: "pool:9" }, ctx)).rejects.toMatchObject({ code: "staking/unknown-position" });
  });

  it("withdraws unlocked chunks and claims rewards", async () => {
    const s = new PolkadotStaking({ assetKey: "wnd" });
    const { ctx } = world({ member: member(1, WND(50), [[119, WND(2)], [125, WND(1)]]), pending: WND(0.5) });
    const w = await s.buildWithdraw({ positionId: "pool:1:ready" }, ctx);
    expect(w.steps[0]!.title).toBe("Move 2 WND back to your balance");
    expect(callOf(w.steps[0]!.request as never)).toEqual({ pallet: "NominationPools", call: "withdraw_unbonded", args: { member_account: { type: "Id", value: ME }, num_slashing_spans: 0 } });
    const cl = await s.buildClaim({ positionId: "pool:1" }, ctx);
    expect(cl.steps[0]!.title).toBe("Claim 0.5 WND of rewards");
    expect(callOf(cl.steps[0]!.request as never)).toEqual({ pallet: "NominationPools", call: "claim_payout", args: undefined });

    const none = world({ member: member(1, WND(50), [[125, WND(1)]]) });
    await expect(s.buildWithdraw({ positionId: "pool:1:era:125" }, none.ctx)).rejects.toMatchObject({ code: "staking/not-withdrawable" });
    await expect(s.buildClaim({ positionId: "pool:1" }, none.ctx)).rejects.toMatchObject({ code: "staking/nothing-to-claim" });
  });

  it("builds requests the chain module describes in plain words (not blind)", async () => {
    const { ctx } = world({ member: member(1, WND(50)) });
    const m = createSubstrateModule();
    const s = new PolkadotStaking({ assetKey: "wnd", module: m });
    const r = (await s.buildStake({ amount: WND(5).toString() }, ctx)).steps[0]!.request as never;
    const d = await m.decode(r, ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Stake 5 WND more in your pool");
  });

  it("works through StakingService by asset (\"Stake WND\")", async () => {
    const { ctx, rpc } = world();
    const base = fakeHost({ networks: [WESTEND_ASSET_HUB], fetch: rpc.fetch, balances: [{ asset: WESTEND_ASSET_HUB.nativeAsset, amount: WND(100).toString() }] });
    const host = { ...base, ctx: async () => ctx };
    const svc = new StakingService(host, polkadotStakingProviders([WESTEND_ASSET_HUB]));
    const [view] = await svc.overview();
    expect(view).toMatchObject({ assetKey: "wnd", symbol: "WND", positions: [], networkId: WESTEND_ASSET_HUB.id });
    expect(view!.unavailable).toBeUndefined();
    const q = await svc.stake({ assetKey: "wnd", amount: "12.5" });
    expect(q.steps).toEqual(["Stake 12.5 WND"]);
    await flush();
    expect(callOf(base.enqueued[0]!.request)).toEqual({ pallet: "NominationPools", call: "join", args: { amount: WND(12.5), pool_id: 2 } });
  });
});
