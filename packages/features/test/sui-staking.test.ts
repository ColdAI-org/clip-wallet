import type { Account, ChainContext } from "@clip-wallet/core";
import { SUI_TESTNET, inspectTransaction, normalizeSuiAddress, pureAddressOf, pureU64Of } from "@clip-wallet/chains-sui";
import { describe, expect, it } from "vitest";
import { SuiStaking, rankSuiValidators, suiBaseApy, suiRewards } from "../src/staking/sui.js";
import { ME_SUI, SUI_PUBKEY } from "./sui-fixtures.js";
import { json } from "./helpers.js";

const ACCOUNT: Account = { id: "sui:0", family: "sui", index: 0, curve: "ed25519", derivationPath: "m/44'/784'/0'/0'/0'", publicKey: SUI_PUBKEY, address: ME_SUI };

const hex = (b: string) => `0x${b.repeat(64 / b.length)}`;
const VAL = { a: hex("a1"), b: hex("b2"), c: hex("c3"), d: hex("d4") };
const POOL = { a: hex("01"), b: hex("02"), c: hex("03"), d: hex("04") };
const TABLE = { a: hex("11"), b: hex("12"), c: hex("13"), d: hex("14") };

function validator(k: "a" | "b" | "c" | "d", name: string, commission: number, stake: string, atRisk = 0) {
  return {
    atRisk,
    contents: {
      json: {
        metadata: { sui_address: VAL[k], name },
        commission_rate: String(commission),
        staking_pool: { id: POOL[k], sui_balance: stake, pool_token_balance: stake, exchange_rates: { id: TABLE[k], size: "1242" } },
      },
    },
  };
}

const VALIDATORS = [
  validator("a", "Alpha", 500, "100000000000000000"),
  validator("b", "Bravo", 1200, "100000000000000000"),
  validator("c", "Charlie", 100, "100000000000000000", 1),
  validator("d", "Delta", 200, "200000000000000000"),
];

type Ops = Record<string, (v: Record<string, unknown>) => unknown>;

/** Mock Sui GraphQL routed by operation name; records every call. */
function suiGql(extra: Ops = {}) {
  const calls: { op: string; v: Record<string, unknown> }[] = [];
  const ops: Ops = {
    clipSuiValidators: () => ({
      epoch: { epochId: 1241, startTimestamp: "2026-10-02T21:24:41.280Z", validatorSet: { activeValidators: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: VALIDATORS } } },
    }),
    clipSuiEpoch: (v) => {
      expect(v.id).toBe(1240);
      // 13,700 SUI over 500M SUI staked in a 24 h epoch: 2.74e-5 a day ≈ 1.0001 % a year.
      return { epoch: { epochId: 1240, totalStakeRewards: "13700000000000", startTimestamp: "2026-10-01T21:24:41.280Z", endTimestamp: "2026-10-02T21:24:41.280Z" } };
    },
    clipSuiBalance: () => ({ address: { balance: { totalBalance: "10000000000" } } }),
    clipSuiStakes: (v) => {
      expect(v.type).toBe("0x3::staking_pool::StakedSui");
      return {
        address: {
          objects: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { address: hex("5a"), contents: { json: { id: hex("5a"), pool_id: POOL.a, stake_activation_epoch: "100", principal: "2000000000" } } },
              { address: hex("5b"), contents: { json: { id: hex("5b"), pool_id: POOL.d, stake_activation_epoch: "1242", principal: "5000000000" } } },
            ],
          },
        },
      };
    },
    clipSuiRates: (v) => {
      expect(v.table).toBe(TABLE.a);
      expect(v.keys).toEqual([{ literal: "100u64" }, { literal: "1241u64" }, { literal: "1240u64" }]);
      return {
        address: {
          multiGetDynamicFields: [
            { value: { json: { sui_amount: "1000", pool_token_amount: "1000" } } },
            { value: { json: { sui_amount: "1100", pool_token_amount: "1000" } } },
            { value: { json: { sui_amount: "1090", pool_token_amount: "1000" } } },
          ],
        },
      };
    },
    ...extra,
  };
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables?: Record<string, unknown> };
    const op = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "?";
    calls.push({ op, v: body.variables ?? {} });
    const h = ops[op];
    if (!h) return json({ errors: [{ message: `no mock for ${op}` }] });
    return json({ data: h(body.variables ?? {}) });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const ctxWith = (f: typeof fetch): ChainContext => ({ network: SUI_TESTNET, account: ACCOUNT, fetch: f });

describe("Sui staking math", () => {
  it("estimates a yearly rate from one finished epoch", () => {
    expect(suiBaseApy(13_700_000_000_000n, 500_000_000_000_000_000n, 86_400_000)).toBeCloseTo(1.0001, 3);
    expect(suiBaseApy(0n, 1n, 1)).toBeUndefined();
  });

  it("computes rewards like staking_pool::calculate_rewards", () => {
    expect(suiRewards(2_000_000_000n, { sui: 1000n, tokens: 1000n }, { sui: 1100n, tokens: 1000n })).toBe(200_000_000n);
    expect(suiRewards(2_000_000_000n, { sui: 1000n, tokens: 1000n }, { sui: 900n, tokens: 1000n })).toBe(0n);
  });

  it("ranks: skips validators at risk, prefers ≤ 10 % commission, cheapest first", () => {
    const vs = [
      { address: "a", name: "A", commissionBps: 500, poolId: "", ratesTable: "", stake: 1n, atRisk: 0 },
      { address: "b", name: "B", commissionBps: 1200, poolId: "", ratesTable: "", stake: 1n, atRisk: 0 },
      { address: "c", name: "C", commissionBps: 100, poolId: "", ratesTable: "", stake: 1n, atRisk: 2 },
      { address: "d", name: "D", commissionBps: 200, poolId: "", ratesTable: "", stake: 2n, atRisk: 0 },
    ];
    expect(rankSuiValidators(vs).map((v) => v.address)).toEqual(["d", "a"]);
  });
});

describe("SuiStaking", () => {
  it("lists validators by name with an estimated rate; exactly one recommended", async () => {
    const m = suiGql();
    const opts = await new SuiStaking().options(ctxWith(m.fetch));
    expect(opts.map((o) => o.id)).toEqual([VAL.d, VAL.a]);
    expect(opts[0]).toMatchObject({ title: "Validator Delta", recommended: true });
    expect(opts[0]!.apy).toBeCloseTo(1.0001 * 0.98, 3);
    expect(opts[0]!.detail).toBe("Earns about 0.98% a year · keeps 2% of rewards");
    expect(opts.filter((o) => o.recommended)).toHaveLength(1);
    expect(await new SuiStaking().rewardRate(ctxWith(m.fetch))).toBe("About 0.98% a year");
  });

  it("shows StakedSui positions with estimated rewards; a new stake says when it starts", async () => {
    const m = suiGql();
    const ps = await new SuiStaking().positions(ctxWith(m.fetch));
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ id: hex("5a"), amount: "2000000000", amountDisplay: "2 SUI", with: "Validator Alpha", status: "active", statusText: "Earning rewards", actions: ["unstake"] });
    expect(ps[0]!.pendingReward).toEqual({ amount: "200000000", display: "0.2 SUI" });
    expect(ps[1]).toMatchObject({ id: hex("5b"), with: "Validator Delta", status: "activating", statusText: "Starts earning in about a day" });
    expect(ps[1]!.pendingReward).toBeUndefined();
  });

  it("builds request_add_stake(0x5, SplitCoins(gas, amount), validator), parsed back with @mysten/sui", async () => {
    const m = suiGql();
    const ctx = ctxWith(m.fetch);
    const { steps } = await new SuiStaking().buildStake({ amount: "2000000000", optionId: VAL.a }, ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe("Stake 2 SUI");
    expect(steps[0]!.lines).toContainEqual({ label: "With", value: "Validator Alpha" });
    const req = steps[0]!.request as Exclude<(typeof steps)[0]["request"], () => unknown>;
    expect(req).toMatchObject({ family: "sui", networkId: "sui:testnet", method: "sui:signAndExecuteTransaction", origin: "clip-wallet" });
    const input = (req.params as { inputs: { account: string; transaction: string; chain: string }[] }).inputs[0]!;
    expect(input).toMatchObject({ account: ME_SUI, chain: "sui:testnet" });

    const data = inspectTransaction(input.transaction);
    expect(normalizeSuiAddress(data.sender!)).toBe(ME_SUI);
    expect(data.commands).toHaveLength(2);
    const split = data.commands[0]!;
    expect(split.$kind).toBe("SplitCoins");
    expect(split.SplitCoins!.coin.$kind).toBe("GasCoin");
    expect(pureU64Of(data.inputs[(split.SplitCoins!.amounts[0] as { Input: number }).Input])).toBe(2_000_000_000n);
    const call = data.commands[1]!.MoveCall!;
    expect(normalizeSuiAddress(call.package)).toBe(normalizeSuiAddress("0x3"));
    expect(call.module).toBe("sui_system");
    expect(call.function).toBe("request_add_stake");
    const [sys, coin, validatorArg] = call.arguments as { $kind: string; Input?: number; NestedResult?: [number, number] }[];
    const sysInput = data.inputs[sys!.Input!] as { Object?: { SharedObject?: { objectId: string; mutable: boolean } }; UnresolvedObject?: { objectId: string } };
    const sysId = sysInput.Object?.SharedObject?.objectId ?? sysInput.UnresolvedObject?.objectId;
    expect(normalizeSuiAddress(sysId!)).toBe(normalizeSuiAddress("0x5"));
    if (sysInput.Object?.SharedObject) expect(sysInput.Object.SharedObject.mutable).toBe(true);
    expect(coin).toMatchObject({ $kind: "NestedResult", NestedResult: [0, 0] });
    expect(pureAddressOf(data.inputs[validatorArg!.Input!])).toBe(VAL.a);
  });

  it("recommends a validator when none is picked, and refuses bad stakes in plain words", async () => {
    const m = suiGql();
    const ctx = ctxWith(m.fetch);
    const { steps } = await new SuiStaking().buildStake({ amount: "1000000000" }, ctx);
    const tx = inspectTransaction(((steps[0]!.request as { params: { inputs: { transaction: string }[] } }).params.inputs[0]!).transaction);
    const v = tx.commands[1]!.MoveCall!.arguments[2] as { Input: number };
    expect(pureAddressOf(tx.inputs[v.Input])).toBe(VAL.d);

    await expect(new SuiStaking().buildStake({ amount: "999999999" }, ctx)).rejects.toMatchObject({ code: "staking/below-minimum", userMessage: "Stake at least 1 SUI." });
    await expect(new SuiStaking().buildStake({ amount: "9995000000" }, ctx)).rejects.toMatchObject({ code: "staking/insufficient" });
    await expect(new SuiStaking().buildStake({ amount: "2000000000", optionId: hex("ee") }, ctx)).rejects.toMatchObject({ code: "staking/unknown-validator" });
  });

  it("unstakes a whole StakedSui with request_withdraw_stake(0x5, stake)", async () => {
    const m = suiGql();
    const ctx = ctxWith(m.fetch);
    const { steps } = await new SuiStaking().buildUnstake({ positionId: hex("5a") }, ctx);
    expect(steps[0]!.title).toBe("Unstake 2 SUI");
    const data = inspectTransaction(((steps[0]!.request as { params: { inputs: { transaction: string }[] } }).params.inputs[0]!).transaction);
    expect(data.commands).toHaveLength(1);
    const call = data.commands[0]!.MoveCall!;
    expect([normalizeSuiAddress(call.package), call.module, call.function]).toEqual([normalizeSuiAddress("0x3"), "sui_system", "request_withdraw_stake"]);
    const stakeInput = data.inputs[(call.arguments[1] as { Input: number }).Input] as { UnresolvedObject?: { objectId: string }; Object?: { ImmOrOwnedObject?: { objectId: string } } };
    expect(normalizeSuiAddress((stakeInput.UnresolvedObject ?? stakeInput.Object?.ImmOrOwnedObject)!.objectId)).toBe(hex("5a"));

    await expect(new SuiStaking().buildUnstake({ positionId: hex("99") }, ctx)).rejects.toMatchObject({ code: "staking/unknown-position" });
    await expect(new SuiStaking().buildUnstake({ positionId: hex("5a"), amount: "1" }, ctx)).rejects.toMatchObject({ code: "staking/partial-not-supported" });
  });

  it("turns GraphQL failures into plain errors", async () => {
    const m = suiGql({
      clipSuiValidators: () => {
        throw new Error("boom");
      },
    });
    const f = (async (u: string, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}")) as { query: string };
      if (body.query.includes("clipSuiValidators")) return json({ errors: [{ message: "internal" }] });
      return m.fetch(u, i);
    }) as typeof fetch;
    await expect(new SuiStaking().options(ctxWith(f))).rejects.toMatchObject({ code: "staking/sui-read-failed" });
  });
});
