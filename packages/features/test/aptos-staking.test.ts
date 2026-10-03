import type { Account, ChainContext, DappRequest } from "@clip-wallet/core";
import { APTOS_TESTNET, type EntryAbi, bcsAddress, bcsU64, createAptosModule, decodeEntryPayload, encodeEntryPayload } from "@clip-wallet/chains-aptos";
import { describe, expect, it } from "vitest";
import { AptosStaking, aptosBaseApy, rankAptosPools } from "../src/staking/aptos.js";
import { mockFetch } from "./helpers.js";

/** chains-aptos fixture account (public key and address only). */
export const ME_APT = "0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf";
const ACCOUNT: Account = { id: "aptos:0", family: "aptos", index: 0, curve: "ed25519", derivationPath: "m/44'/637'/0'/0'/0'", publicKey: "a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60", address: ME_APT };

/** 0x1::delegation_pool entry ABIs as GET /v1/accounts/0x1/module/delegation_pool returned them (testnet, 2026-10-03). */
export const DELEGATION_ABI: Record<"add_stake" | "unlock" | "withdraw", EntryAbi> = {
  add_stake: { generic_type_params: [], params: ["&signer", "address", "u64"] },
  unlock: { generic_type_params: [], params: ["&signer", "address", "u64"] },
  withdraw: { generic_type_params: [], params: ["&signer", "address", "u64"] },
};

const P = (b: string) => `0x${b.repeat(32)}`;
const P1 = P("a1");
const P2 = P("a2");
const P3 = P("a3");
const P4 = P("a4");
const P5 = P("a5");
const NOW_S = Math.floor(Date.now() / 1000);

type ViewFn = (args: unknown[]) => unknown[];

function aptosFetch(views: Record<string, ViewFn> = {}, myPools: string[] = [P1, P3]) {
  const baseViews: Record<string, ViewFn> = {
    "0x1::stake::get_validator_state": ([pool]) => [pool === P5 ? "1" : "2"],
    "0x1::delegation_pool::allowlisting_enabled": ([pool]) => [pool === P4],
    "0x1::delegation_pool::get_stake": ([pool, who]) => {
      expect(who).toBe(ME_APT);
      return pool === P1 ? ["2000000000", "0", "500000000"] : pool === P3 ? ["0", "300000000", "0"] : ["0", "0", "0"];
    },
    "0x1::stake::get_lockup_secs": () => [String(NOW_S + 3 * 86_400 + 100)],
    "0x1::delegation_pool::get_add_stake_fee": ([, amount]) => [amount === "2500000000" ? "1234" : "0"],
    "0x1::delegation_pool::operator_commission_percentage": () => ["700"],
    ...views,
  };
  return mockFetch([
    [
      /\/v1\/graphql$/,
      (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body)) as { query: string; variables: Record<string, unknown> };
        if (body.query.includes("clipAptosPools")) {
          return {
            data: {
              current_delegated_staking_pool_balances: [
                { staking_pool_address: P1, total_coins: 500000000000000, operator_commission_percentage: 500 },
                { staking_pool_address: P2, total_coins: 300000000000000, operator_commission_percentage: 1200 },
                { staking_pool_address: P3, total_coins: 200000000000000, operator_commission_percentage: 800 },
                { staking_pool_address: P4, total_coins: 1000000000000, operator_commission_percentage: 300 },
                { staking_pool_address: P5, total_coins: 50000000000, operator_commission_percentage: 0 },
              ],
            },
          };
        }
        if (body.query.includes("clipAptosMyPools")) {
          expect(body.variables.me).toBe(ME_APT);
          return { data: { delegator_distinct_pool: myPools.map((pool_address) => ({ pool_address })) } };
        }
        return { errors: [{ message: "unknown" }] };
      },
    ],
    [
      /\/v1\/view$/,
      (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body)) as { function: string; arguments: unknown[] };
        const fn = views[body.function] ?? baseViews[body.function];
        return fn ? fn(body.arguments) : undefined;
      },
    ],
    [/resource\/0x1::staking_config::StakingConfig$/, { type: "0x1::staking_config::StakingConfig", data: { rewards_rate: "15981", rewards_rate_denominator: "1000000000", recurring_lockup_duration_secs: "1209600" } }],
    // 1e-5 per epoch as FixedPoint64.
    [/resource\/0x1::staking_config::StakingRewardsConfig$/, { type: "0x1::staking_config::StakingRewardsConfig", data: { rewards_rate: { value: "184467440737096" } } }],
    [/resource\/0x1::block::BlockResource$/, { type: "0x1::block::BlockResource", data: { epoch_interval: "7200000000" } }],
  ]);
}

const ctxWith = (f: typeof fetch): ChainContext => ({ network: APTOS_TESTNET, account: ACCOUNT, fetch: f });

type Payload = { function: `${string}::${string}::${string}`; typeArguments: string[]; functionArguments: unknown[] };
function payloadOf(r: DappRequest): Payload {
  expect(r).toMatchObject({ family: "aptos", networkId: "aptos:2", method: "aptos:signAndSubmitTransaction", origin: "clip-wallet" });
  const input = (r.params as { inputs: { account: string; payload: Payload }[] }).inputs[0]!;
  expect(input.account).toBe(ME_APT);
  // The chains-aptos module accepts it as a wallet-built payload request.
  expect(createAptosModule().normalize(r, ME_APT)).toMatchObject({ kind: "build", payload: input.payload });
  return input.payload;
}

/** Encode with the SDK's ABI encoder (what chains-aptos does before signing), then read the BCS back. */
function parsed(p: Payload, abi: EntryAbi) {
  const d = decodeEntryPayload(encodeEntryPayload(p, abi));
  return { fn: d.function, typeArgs: d.typeArguments, pool: bcsAddress(d.args[0]!), amount: bcsU64(d.args[1]!) };
}

describe("Aptos staking math", () => {
  it("turns a per-epoch rate into a yearly one", () => {
    expect(aptosBaseApy(1e-5, 7200)).toBeCloseTo(4.38, 6);
  });

  it("ranks: ≥ 1,000 APT, ≤ 10 % commission when any, cheapest first", () => {
    const r = rankAptosPools([
      { address: "a", totalCoins: 500_000_000_000_000n, commission: 500 },
      { address: "b", totalCoins: 300_000_000_000_000n, commission: 1200 },
      { address: "c", totalCoins: 50_000_000_000n, commission: 0 },
      { address: "d", totalCoins: 200_000_000_000_000n, commission: 800 },
    ]);
    expect(r.map((p) => p.address)).toEqual(["a", "d"]);
  });
});

describe("AptosStaking", () => {
  it("lists active, open delegation pools with a yearly rate; one recommended", async () => {
    const m = aptosFetch();
    const opts = await new AptosStaking().options(ctxWith(m.fetch));
    expect(opts.map((o) => o.id)).toEqual([P1, P3]); // P4 allow-listed, P2 too expensive, P5 too small and inactive
    expect(opts[0]).toMatchObject({ title: "Pool 0xa1a1…a1a1", recommended: true });
    expect(opts[0]!.apy).toBeCloseTo(4.38 * 0.95, 3);
    expect(opts[0]!.detail).toBe("Earns about 4.16% a year · keeps 5% of rewards · holds 5,000,000 APT");
    expect(await new AptosStaking().rewardRate(ctxWith(m.fetch))).toBe("About 4.16% a year");
  });

  it("shows active, unlocking and withdrawable stake per pool", async () => {
    const m = aptosFetch();
    const ps = await new AptosStaking().positions(ctxWith(m.fetch));
    expect(ps.map((p) => [p.id, p.status, p.amountDisplay, p.actions])).toEqual([
      [`${P1}:active`, "active", "20 APT", ["unstake"]],
      [`${P1}:unlocking`, "deactivating", "5 APT", []],
      [`${P3}:withdrawable`, "withdrawable", "3 APT", ["withdraw"]],
    ]);
    expect(ps[0]!.partialUnstake).toBe(true);
    expect(ps[1]!.statusText).toBe("Unlocking. Ready in about 3 days");
  });

  it("stakes with delegation_pool::add_stake(pool, amount), parsed back with the Aptos SDK", async () => {
    const m = aptosFetch();
    const { steps } = await new AptosStaking().buildStake({ amount: "2500000000", optionId: P1 }, ctxWith(m.fetch));
    expect(steps[0]!.title).toBe("Stake 25 APT");
    expect(steps[0]!.lines).toContainEqual({ label: "Lockup", value: "Unstaking takes up to about 14 days" });
    expect(steps[0]!.lines).toContainEqual({ label: "Held back this epoch", value: "0.00001234 APT, added back to your stake when the epoch ends" });
    const p = payloadOf(steps[0]!.request as DappRequest);
    expect(parsed(p, DELEGATION_ABI.add_stake)).toEqual({ fn: "0x1::delegation_pool::add_stake", typeArgs: [], pool: P1, amount: 2_500_000_000n });
  });

  it("picks the recommended pool, accepts another open pool, and refuses bad stakes", async () => {
    const m = aptosFetch();
    const ctx = ctxWith(m.fetch);
    const rec = await new AptosStaking().buildStake({ amount: "1000000000" }, ctx);
    expect(parsed(payloadOf(rec.steps[0]!.request as DappRequest), DELEGATION_ABI.add_stake).pool).toBe(P1);
    const other = await new AptosStaking().buildStake({ amount: "1000000000", optionId: P2 }, ctx);
    expect(parsed(payloadOf(other.steps[0]!.request as DappRequest), DELEGATION_ABI.add_stake).pool).toBe(P2);
    await expect(new AptosStaking().buildStake({ amount: "999999999" }, ctx)).rejects.toMatchObject({ code: "staking/below-minimum", userMessage: "Stake at least 10 APT." });
    await expect(new AptosStaking().buildStake({ amount: "1000000000", optionId: P5 }, ctx)).rejects.toMatchObject({ code: "staking/unknown-validator" });
    await expect(new AptosStaking().buildStake({ amount: "1000000000", optionId: P4 }, ctx)).rejects.toMatchObject({ code: "staking/unknown-validator" });
  });

  it("unstakes part or all with unlock(pool, amount), and withdraws with withdraw(pool, amount)", async () => {
    const m = aptosFetch();
    const ctx = ctxWith(m.fetch);
    const all = await new AptosStaking().buildUnstake({ positionId: `${P1}:active` }, ctx);
    expect(all.steps[0]!.title).toBe("Unstake 20 APT");
    expect(parsed(payloadOf(all.steps[0]!.request as DappRequest), DELEGATION_ABI.unlock)).toEqual({ fn: "0x1::delegation_pool::unlock", typeArgs: [], pool: P1, amount: 2_000_000_000n });

    const part = await new AptosStaking().buildUnstake({ positionId: `${P1}:active`, amount: "500000000" }, ctx);
    expect(part.steps[0]!.title).toBe("Unstake 5 APT");
    expect(part.steps[0]!.lines).toContainEqual({ label: "Note", value: "At least 10 APT unstakes at a time" });
    expect(parsed(payloadOf(part.steps[0]!.request as DappRequest), DELEGATION_ABI.unlock).amount).toBe(500_000_000n);

    await expect(new AptosStaking().buildUnstake({ positionId: `${P1}:active`, amount: "2000000001" }, ctx)).rejects.toMatchObject({ code: "staking/too-much" });
    await expect(new AptosStaking().buildUnstake({ positionId: `${P3}:withdrawable` }, ctx)).rejects.toMatchObject({ code: "staking/unknown-position" });

    const w = await new AptosStaking().buildWithdraw({ positionId: `${P3}:withdrawable` }, ctx);
    expect(w.steps[0]!.title).toBe("Move 3 APT back to your balance");
    expect(parsed(payloadOf(w.steps[0]!.request as DappRequest), DELEGATION_ABI.withdraw)).toEqual({ fn: "0x1::delegation_pool::withdraw", typeArgs: [], pool: P3, amount: 300_000_000n });
    await expect(new AptosStaking().buildWithdraw({ positionId: `${P1}:unlocking` }, ctx)).rejects.toMatchObject({ code: "staking/not-withdrawable" });
    await expect(new AptosStaking().buildWithdraw({ positionId: "nonsense" }, ctx)).rejects.toMatchObject({ code: "staking/unknown-position" });
  });

  it("says plainly when the indexer is down", async () => {
    const m = mockFetch([[/graphql/, { errors: [{ message: "down" }] }]]);
    await expect(new AptosStaking().options(ctxWith(m.fetch))).rejects.toMatchObject({ code: "staking/aptos-indexer" });
  });
});
