import { ClipError, type DappRequest } from "@clip-wallet/core";
import { clearTokenCache, createNearModule, decodeTransaction, encodeTransaction, parsePublicKey } from "@clip-wallet/chains-near";
import { beforeEach, describe, expect, it } from "vitest";
import { NearStaking, nearBaseApy, poolCandidates, rankPools, uptimeOf, type NearValidatorInfo } from "../src/staking/near.js";
import { ME_NEAR, NEAR_PK, YOCTO, decodeBasics, mockNearRpc, nearCtx, viewAccount } from "./near-fixtures.js";

const S = ".pool.f863973.m0";
const TGAS = 10n ** 12n;
const M = 1_000_000n * YOCTO;
const nearMod = createNearModule();

function v(id: string, stakeM: bigint, produced = 100, expected = 100): NearValidatorInfo {
  return {
    account_id: id,
    stake: (stakeM * M).toString(),
    is_slashed: false,
    num_produced_blocks: produced,
    num_expected_blocks: expected,
    num_produced_chunks: 500,
    num_expected_chunks: 500,
    num_produced_endorsements: 0,
    num_expected_endorsements: 0,
  };
}

const CURRENT = [
  v(`big${S}`, 200n),
  v(`stakely${S}`, 50n),
  v(`cheap${S}`, 40n, 80, 100), // (0.8 + 1) / 2 = 90 % online: below 95 %
  v(`aurora${S}`, 30n),
  v(`ts${S}`, 20n),
  v(`greedy${S}`, 15n),
  v(`paused${S}`, 12n),
  v(`kicked${S}`, 10n),
  v(`leaving${S}`, 9n),
  v("node0", 8n),
];
const VALIDATORS = {
  current_validators: CURRENT,
  next_validators: CURRENT.filter((x) => x.account_id !== `leaving${S}`).map((x) => ({ account_id: x.account_id, stake: x.stake })),
  prev_epoch_kickout: [{ account_id: `kicked${S}`, reason: { NotEnoughChunkEndorsements: { expected: 10, produced: 0 } } }],
  epoch_height: 5300,
};
const FEES: Record<string, number> = { big: 2, stakely: 3, cheap: 1, aurora: 9, ts: 5, greedy: 99, paused: 1, kicked: 1, leaving: 1 };
const CONFIG = { max_inflation_rate: [1, 40], protocol_reward_rate: [1, 10], epoch_length: 43200 };
const TOTAL_STAKE = 394n * M;
const SUPPLY = 2_672_652_659n * YOCTO;

function poolHandlers(accounts: Record<string, { staked_balance: string; unstaked_balance: string; can_withdraw: boolean }> = {}) {
  const h: Record<string, unknown> = { ...decodeBasics, validators: VALIDATORS, EXPERIMENTAL_protocol_config: CONFIG };
  for (const [name, fee] of Object.entries(FEES)) {
    h[`call:${name}${S}:get_reward_fee_fraction`] = { numerator: fee, denominator: 100 };
    h[`call:${name}${S}:is_staking_paused`] = name === "paused";
  }
  for (const [pool, acct] of Object.entries(accounts)) h[`call:${pool}:get_account`] = { account_id: ME_NEAR, ...acct };
  return h;
}

/** Normalise like the module does, encode with the borsh codec, decode it back. */
function borsh(request: DappRequest) {
  const n = nearMod.normalize(request, ME_NEAR, parsePublicKey(NEAR_PK));
  if (n.kind !== "build") throw new Error("expected a built transaction");
  return n.txs.map((t, i) => decodeTransaction(encodeTransaction({ signerId: t.signerId, publicKey: parsePublicKey(NEAR_PK), nonce: BigInt(i + 6), receiverId: t.receiverId, blockHash: new Uint8Array(32).fill(9), actions: t.actions })));
}

function onlyCall(request: DappRequest) {
  const [tx] = borsh(request);
  expect(tx!.actions).toHaveLength(1);
  const a = tx!.actions[0]!;
  if (a.kind !== "FunctionCall") throw new Error("expected a function call");
  return { receiverId: tx!.receiverId, signerId: tx!.signerId, method: a.methodName, args: JSON.parse(new TextDecoder().decode(a.args)) as Record<string, unknown>, gas: a.gas, deposit: a.deposit };
}

async function rejects(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
}

beforeEach(() => clearTokenCache());

describe("NEAR staking: picking a pool", () => {
  it("measures uptime over the work a validator was expected to do", () => {
    expect(uptimeOf(v("a", 1n, 80, 100))).toBeCloseTo(0.9);
    expect(uptimeOf({ account_id: "a", stake: "1", num_expected_blocks: 0, num_expected_chunks: 0, num_produced_endorsements: 97, num_expected_endorsements: 100 })).toBeCloseTo(0.97);
    expect(uptimeOf({ account_id: "a", stake: "1" })).toBe(1);
  });

  it("keeps only healthy pool contracts and spreads stake away from the biggest", () => {
    const c = poolCandidates(VALIDATORS, "near:testnet").map((x) => x.pool);
    expect(c).toEqual([`stakely${S}`, `aurora${S}`, `ts${S}`, `greedy${S}`, `paused${S}`]);
    const ranked = rankPools([
      { pool: "a", stake: 1n, uptime: 1, fee: 0.05 },
      { pool: "b", stake: 1n, uptime: 1, fee: 0.03 },
      { pool: "c", stake: 1n, uptime: 1, fee: 0.2 },
      { pool: "d", stake: 1n, uptime: 1, fee: 0.01, paused: true },
      { pool: "e", stake: 1n, uptime: 1 },
    ]);
    expect(ranked.map((x) => x.pool)).toEqual(["b", "a"]);
  });

  it("estimates the yearly rate from inflation, the protocol's share and how much is staked", () => {
    expect(nearBaseApy({ max_inflation_rate: [1, 40], protocol_reward_rate: [0, 1] }, 1_307_978_211n * YOCTO, 545_308_757n * YOCTO)).toBeCloseTo(5.996, 2);
    expect(nearBaseApy({ max_inflation_rate: [1, 40], protocol_reward_rate: [0, 1] }, 1n, 0n)).toBeUndefined();
  });

  it("lists pools best first in plain words, exactly one recommended", async () => {
    const { fetch } = mockNearRpc(poolHandlers());
    const p = new NearStaking();
    const opts = await p.options(nearCtx(fetch));
    expect(opts.map((o) => o.id)).toEqual([`stakely${S}`, `ts${S}`, `aurora${S}`]);
    expect(opts.filter((o) => o.recommended).map((o) => o.id)).toEqual([`stakely${S}`]);
    const base = nearBaseApy(CONFIG as never, SUPPLY, TOTAL_STAKE)!;
    expect(opts[0]!.apy).toBeCloseTo(base * 0.97, 6);
    expect(opts[0]!.title).toBe("Validator stakely");
    expect(opts[0]!.detail).toMatch(/^Earns about [\d.]+% a year · keeps 3% of rewards · online 100%$/);
    expect(await p.rewardRate(nearCtx(fetch))).toMatch(/^About [\d.]+% a year$/);
  });

  it("says so plainly when no pool qualifies", async () => {
    const { fetch } = mockNearRpc({ ...poolHandlers(), validators: { current_validators: [v("node0", 1n)], next_validators: [] } });
    await rejects(new NearStaking().options(nearCtx(fetch)), "staking/no-validators");
  });
});

describe("NEAR staking: positions", () => {
  const accounts = {
    [`stakely${S}`]: { staked_balance: (50n * YOCTO).toString(), unstaked_balance: (5n * YOCTO).toString(), can_withdraw: false },
    [`ts${S}`]: { staked_balance: "0", unstaked_balance: (2n * YOCTO).toString(), can_withdraw: true },
    [`old${S}`]: { staked_balance: "0", unstaked_balance: "3", can_withdraw: true },
  };

  it("reads pools from FastNEAR and splits staked, unlocking and ready NEAR", async () => {
    const { fetch, calls } = mockNearRpc(poolHandlers(accounts), [
      [/fastnear-testnet\.test\/v1\/account\/[0-9a-f]+\/staking$/, { account_id: ME_NEAR, pools: [{ pool_id: `stakely${S}` }, { pool_id: `ts${S}` }, { pool_id: `old${S}` }, { pool_id: "evil.testnet" }] }],
    ]);
    const pos = await new NearStaking().positions(nearCtx(fetch));
    expect(pos.map((p) => [p.id, p.status, p.amountDisplay, p.actions, p.partialUnstake ?? false])).toEqual([
      [`stakely${S}`, "active", "50 NEAR", ["unstake"], true],
      [`stakely${S}#unstaking`, "deactivating", "5 NEAR", [], false],
      [`ts${S}#withdrawable`, "withdrawable", "2 NEAR", ["withdraw"], false],
    ]);
    expect(pos[0]).toMatchObject({ with: "Validator stakely", statusText: "Earning rewards", assetKey: "near", symbol: "NEAR", decimals: 24, networkId: "near:testnet" });
    expect(pos[1]!.statusText).toBe("Unlocking. Ready in about 1–2 days");
    // Not a staking pool: never queried.
    expect(calls.some((c) => c.key === "call:evil.testnet:get_account")).toBe(false);
  });

  it("falls back to the current validators' pools when FastNEAR is down", async () => {
    const { fetch, calls } = mockNearRpc(poolHandlers(accounts), [[/fastnear/, { error: "down" }, 503]]);
    const pos = await new NearStaking().positions(nearCtx(fetch));
    expect(pos.map((p) => p.id)).toEqual([`stakely${S}`, `stakely${S}#unstaking`, `ts${S}#withdrawable`]);
    expect(calls.filter((c) => c.key.endsWith(":get_account")).length).toBe(9);
  });
});

describe("NEAR staking: building requests", () => {
  const funds = { [`view_account:${ME_NEAR}`]: viewAccount(100n * YOCTO) };

  it("stakes an amount with the recommended pool: deposit_and_stake, 125 Tgas, described plainly", async () => {
    const { fetch } = mockNearRpc({ ...poolHandlers(), ...funds });
    const ctx = nearCtx(fetch);
    const build = await new NearStaking().buildStake({ amount: (50n * YOCTO).toString() }, ctx);
    const step = build.steps[0]!;
    expect(step.title).toBe("Stake 50 NEAR");
    expect(step.lines?.[0]).toEqual({ label: "With", value: "Validator stakely" });
    const req = step.request as DappRequest;
    expect(req).toMatchObject({ family: "near", networkId: "near:testnet", method: "near_signAndSendTransaction", origin: "clip-wallet" });
    expect(onlyCall(req)).toEqual({ receiverId: `stakely${S}`, signerId: ME_NEAR, method: "deposit_and_stake", args: {}, gas: 125n * TGAS, deposit: 50n * YOCTO });
    const d = await nearMod.decode(req, ctx);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Stake 50 NEAR with stakely");
  });

  it("refuses an amount that leaves nothing for fees, and pools that aren't pools", async () => {
    const { fetch } = mockNearRpc({ ...poolHandlers(), ...funds });
    await rejects(new NearStaking().buildStake({ amount: (100n * YOCTO).toString(), optionId: `ts${S}` }, nearCtx(fetch)), "staking/insufficient");
    await rejects(new NearStaking().buildStake({ amount: "0" }, nearCtx(fetch)), "staking/bad-amount");
    await rejects(new NearStaking().buildStake({ amount: YOCTO.toString(), optionId: "bob.testnet" }, nearCtx(fetch)), "near/bad-validator");
  });

  it("unstakes part (unstake {amount}) or everything (unstake_all)", async () => {
    const acct = { [`stakely${S}`]: { staked_balance: (50n * YOCTO).toString(), unstaked_balance: (5n * YOCTO).toString(), can_withdraw: true } };
    const { fetch } = mockNearRpc(poolHandlers(acct));
    const ctx = nearCtx(fetch);
    const p = new NearStaking();
    const part = await p.buildUnstake({ positionId: `stakely${S}`, amount: (20n * YOCTO).toString() }, ctx);
    expect(part.steps[0]!.title).toBe("Unstake 20 NEAR");
    expect(part.steps[0]!.lines?.find((l) => l.label === "Note")?.value).toMatch(/Move the 5 NEAR that's ready back to your balance first/);
    expect(onlyCall(part.steps[0]!.request as DappRequest)).toEqual({ receiverId: `stakely${S}`, signerId: ME_NEAR, method: "unstake", args: { amount: (20n * YOCTO).toString() }, gas: 125n * TGAS, deposit: 0n });
    expect((await nearMod.decode(part.steps[0]!.request as DappRequest, ctx)).title).toBe("Unstake 20 NEAR from stakely");
    const all = await p.buildUnstake({ positionId: `stakely${S}` }, ctx);
    expect(all.steps[0]!.title).toBe("Unstake all 50 NEAR");
    expect(onlyCall(all.steps[0]!.request as DappRequest)).toMatchObject({ method: "unstake_all", args: {}, deposit: 0n });
    const exact = await p.buildUnstake({ positionId: `stakely${S}`, amount: (50n * YOCTO).toString() }, ctx);
    expect(onlyCall(exact.steps[0]!.request as DappRequest).method).toBe("unstake_all");
    await rejects(p.buildUnstake({ positionId: `stakely${S}`, amount: (51n * YOCTO).toString() }, ctx), "staking/too-much");
  });

  it("withdraws only when ready: withdraw_all, or withdraw {amount}", async () => {
    const ready = { [`ts${S}`]: { staked_balance: "0", unstaked_balance: (2n * YOCTO).toString(), can_withdraw: true } };
    const { fetch } = mockNearRpc(poolHandlers(ready));
    const ctx = nearCtx(fetch);
    const p = new NearStaking();
    const all = await p.buildWithdraw({ positionId: `ts${S}#withdrawable` }, ctx);
    expect(all.steps[0]!.title).toBe("Move 2 NEAR back to your balance");
    expect(onlyCall(all.steps[0]!.request as DappRequest)).toEqual({ receiverId: `ts${S}`, signerId: ME_NEAR, method: "withdraw_all", args: {}, gas: 125n * TGAS, deposit: 0n });
    expect((await nearMod.decode(all.steps[0]!.request as DappRequest, ctx)).title).toBe("Withdraw your unstaked NEAR from ts");
    const some = await p.buildWithdraw({ positionId: `ts${S}#withdrawable`, amount: YOCTO.toString() }, ctx);
    expect(onlyCall(some.steps[0]!.request as DappRequest)).toMatchObject({ method: "withdraw", args: { amount: YOCTO.toString() } });

    const locked = mockNearRpc(poolHandlers({ [`ts${S}`]: { staked_balance: "0", unstaked_balance: (2n * YOCTO).toString(), can_withdraw: false } }));
    await rejects(p.buildWithdraw({ positionId: `ts${S}#unstaking` }, nearCtx(locked.fetch)), "staking/not-withdrawable");
    await rejects(p.buildWithdraw({ positionId: "evil.testnet" }, ctx), "staking/unknown-position");
  });
});
