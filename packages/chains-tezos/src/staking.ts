import { type AssetRef, type ChainContext, ClipError, type DappRequest } from "@clip-wallet/core";
import type { PartialTezosOperation } from "./build.js";
import { formatUnits, isTezosAddress, short } from "./encoding.js";
import { xtzAsset } from "./networks.js";
import type { Tzkt } from "./rpc.js";

/**
 * Native Tezos staking (octez docs, "Staking mechanism", Paris+ adaptive issuance):
 *  - delegation: liquid, no lockup, the baker gets your balance's weight.
 *  - stake / unstake / finalize_unstake: transactions to yourself with those entrypoints. Staking needs a delegate,
 *    and the baker must accept external stake (limit_of_staking_over_baking > 0). Unstaked XTZ becomes
 *    finalizable after unstake_finalization_delay + 1 cycles (3 + 1 = 4 on mainnet and shadownet, ~1 day each).
 *  Changing delegate triggers an implicit unstake of everything staked.
 * Amounts are mutez decimal strings.
 */
export interface StakePosition {
  validator: string;
  validatorName?: string;
  asset: AssetRef;
  staked: string;
  unstaking?: string;
  withdrawable?: string;
  withdrawableAt?: string;
  /** Spendable XTZ delegated to this baker (liquid, earns delegation rewards). */
  delegated?: string;
}

interface TzktAccount {
  balance?: number | string;
  stakedBalance?: number | string;
  unstakedBalance?: number | string;
  delegate?: { address: string; alias?: string; active?: boolean } | null;
}

interface TzktUnstakeRequest {
  baker: { address: string; alias?: string };
  actualAmount?: number | string;
  requestedAmount?: number | string;
  finalizedAmount?: number | string;
  status: "pending" | "finalizable" | "finalized";
  unlockTime?: string;
}

interface TzktDelegate {
  address: string;
  alias?: string;
  active?: boolean;
  limitOfStakingOverBaking?: number;
}

const big = (v: number | string | undefined) => BigInt(v ?? 0);

export function createStaking(h: {
  sendRequest: (ctx: ChainContext, ops: PartialTezosOperation[], notes?: string[]) => DappRequest;
  tzktFor: (ctx: ChainContext) => Tzkt;
  meOf: (ctx: ChainContext) => string;
}) {
  async function account(ctx: ChainContext): Promise<TzktAccount> {
    return (await h.tzktFor(ctx).get<TzktAccount | null>(`/v1/accounts/${h.meOf(ctx)}`)) ?? {};
  }

  async function getPositions(ctx: ChainContext): Promise<StakePosition[]> {
    const tzkt = h.tzktFor(ctx);
    const me = h.meOf(ctx);
    const [acct, requests] = await Promise.all([
      account(ctx),
      tzkt.get<TzktUnstakeRequest[]>(`/v1/staking/unstake_requests?staker=${me}&status.ne=finalized&limit=100`).then((r) => r ?? []),
    ]);
    const asset = xtzAsset(ctx.network.id);
    const byBaker = new Map<string, StakePosition & { _u: bigint; _w: bigint }>();
    const pos = (address: string, alias?: string) => {
      let p = byBaker.get(address);
      if (!p) {
        p = { validator: address, asset, staked: "0", _u: 0n, _w: 0n };
        if (alias) p.validatorName = alias;
        byBaker.set(address, p);
      }
      return p;
    };
    if (acct.delegate) {
      const p = pos(acct.delegate.address, acct.delegate.alias);
      p.staked = big(acct.stakedBalance).toString();
      const spendable = big(acct.balance) - big(acct.stakedBalance) - big(acct.unstakedBalance);
      p.delegated = (spendable > 0n ? spendable : 0n).toString();
    }
    for (const r of requests) {
      if (r.status === "finalized") continue;
      const p = pos(r.baker.address, r.baker.alias);
      const left = big(r.actualAmount ?? r.requestedAmount) - big(r.finalizedAmount);
      if (r.status === "finalizable") p._w += left;
      else {
        p._u += left;
        if (r.unlockTime && (!p.withdrawableAt || r.unlockTime < p.withdrawableAt)) p.withdrawableAt = r.unlockTime;
      }
    }
    return [...byBaker.values()].map(({ _u, _w, ...p }) => ({
      ...p,
      ...(_u > 0n ? { unstaking: _u.toString() } : {}),
      ...(_w > 0n ? { withdrawable: _w.toString() } : {}),
    }));
  }

  const self = (ctx: ChainContext, entrypoint: string, amount: string): PartialTezosOperation => ({
    kind: "transaction",
    amount,
    destination: h.meOf(ctx),
    parameters: { entrypoint, value: { prim: "Unit" } },
  });

  function checkAmount(amount: string, allowZero = false): void {
    if (!/^\d+$/.test(amount) || (!allowZero && BigInt(amount) <= 0n)) throw new ClipError("Enter an amount greater than zero.", "tezos/bad-amount");
  }

  function checkBaker(validator: string): void {
    if (!/^tz[1-4]/.test(validator) || !isTezosAddress(validator)) throw new ClipError("That isn't a Tezos baker address.", "tezos/bad-baker");
  }

  /** Delegates to `validator` if needed, then stakes `amount` if the baker accepts staking (otherwise it only delegates and says so). */
  async function buildStake(p: { validator: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    checkBaker(p.validator);
    checkAmount(p.amount, true);
    const tzkt = h.tzktFor(ctx);
    const [acct, baker] = await Promise.all([account(ctx), tzkt.get<TzktDelegate | null>(`/v1/delegates/${p.validator}`).catch(() => null)]);
    if (!baker || baker.active === false) throw new ClipError("That address isn't an active Tezos baker. Pick a baker from the list.", "tezos/not-a-baker");
    const name = baker.alias ?? short(p.validator);
    const ops: PartialTezosOperation[] = [];
    const notes: string[] = [];
    if (acct.delegate?.address !== p.validator) {
      ops.push({ kind: "delegation", delegate: p.validator });
      if (acct.delegate && big(acct.stakedBalance) > 0n) {
        notes.push(`Changing baker also starts unstaking your ${formatUnits(big(acct.stakedBalance), 6)} XTZ staked with ${acct.delegate.alias ?? short(acct.delegate.address)}.`);
      }
    }
    if (BigInt(p.amount) > 0n) {
      if ((baker.limitOfStakingOverBaking ?? 0) > 0) ops.push(self(ctx, "stake", p.amount));
      else notes.push(`${name} doesn't accept staking, so this only delegates. Your XTZ stays liquid and still earns delegation rewards.`);
    }
    if (!ops.length) throw new ClipError(`You're already delegating to ${name}.`, "tezos/already-delegated");
    return h.sendRequest(ctx, ops, notes);
  }

  async function currentBaker(ctx: ChainContext, validator: string): Promise<void> {
    checkBaker(validator);
    const acct = await account(ctx);
    if (acct.delegate?.address !== validator) {
      throw new ClipError("You can only unstake from your current baker.", "tezos/not-your-baker");
    }
  }

  async function buildUnstake(p: { validator: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    checkAmount(p.amount);
    await currentBaker(ctx, p.validator);
    return h.sendRequest(ctx, [self(ctx, "unstake", p.amount)]);
  }

  /** finalize_unstake moves every finalizable request back to your spendable balance (any baker). */
  async function buildWithdraw(p: { validator: string }, ctx: ChainContext): Promise<DappRequest> {
    checkBaker(p.validator);
    return h.sendRequest(ctx, [self(ctx, "finalize_unstake", "0")]);
  }

  return { getPositions, buildStake, buildUnstake, buildWithdraw };
}
