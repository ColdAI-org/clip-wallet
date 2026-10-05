import { type ChainContext, ClipError, type DappRequest, type Network, msg, titled, say } from "@clip-wallet/core";
import {
  type Connection,
  Enum,
  type SubstrateModule,
  SUBSTRATE_SPECS,
  activeEra,
  connect,
  erasToText,
  existentialDeposit,
  poolUnbondingEras,
  readStorage,
  runtimeCall,
  specOf,
  spendableNative,
  storageEntries,
  substrateModule,
} from "@clip-wallet/chains-substrate";
import type { StakeOptionView, StakePositionView } from "../views.js";
import { formatUnits, percent } from "../util.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * Polkadot SDK nomination pools (pallet `NominationPools`). Since the 2025 Asset Hub migration, staking and
 * pools run on each Asset Hub (Polkadot, Kusama, Westend, Paseo); relay chains no longer have the pallets.
 *
 * Reads (all through live runtime metadata, polkadot-api dynamic codecs in chains-substrate):
 *  - options: `BondedPools` (state, commission, member_counter, points), `Metadata` (pool names),
 *    `MaxPoolMembersPerPool`, `NominationPoolsApi.pool_accounts` + `Staking.Nominators` (the pool is nominating).
 *  - positions: `PoolMembers(you)`, `NominationPoolsApi.points_to_balance` / `pending_rewards`, `Staking.ActiveEra`.
 *  - limits: `MinJoinBond`, `Balances.ExistentialDeposit`, `System.Account` (spendable while staying alive).
 * Calls: `join(amount, pool_id)`, `bond_extra(FreeBalance(amount))`, `unbond(member, points)`,
 * `withdraw_unbonded(member, 0)`, `claim_payout()`; built by `buildCall` and described by the module's decode().
 */

/** Native asset keys whose networks run nomination pools (their Asset Hub). */
export const POLKADOT_STAKING_KEYS = [...new Set(SUBSTRATE_SPECS.filter((s) => s.assetHub).map((s) => s.key))];

/** Pools whose operator keeps more than this share of rewards are not offered. */
const MAX_COMMISSION_PCT = 10;
const PERBILL = 1_000_000_000;
/** Pools checked for live nominations before options are shown. */
const CHECK_TOP = 12;
const SHOW = 10;

interface BondedPool {
  commission: { current?: [number, string] | undefined };
  member_counter: number;
  points: bigint;
  state: { type: string };
}

interface PoolMember {
  pool_id: number;
  points: bigint;
  unbonding_eras: [number, bigint][];
}

export interface RankedPool {
  id: number;
  commissionPct: number;
  members: number;
  points: bigint;
}

/** Open pools under the commission cap and member limit, lowest commission first, then most members, then most stake. */
export function rankPools(pools: [number, BondedPool][], maxMembers: number | null): RankedPool[] {
  return pools
    .filter(([, p]) => p.state.type === "Open" && p.points > 0n && (maxMembers === null || p.member_counter < maxMembers))
    .map(([id, p]) => ({ id, commissionPct: ((p.commission.current?.[0] ?? 0) / PERBILL) * 100, members: p.member_counter, points: p.points }))
    .filter((p) => p.commissionPct <= MAX_COMMISSION_PCT)
    .sort((a, b) => a.commissionPct - b.commissionPct || b.members - a.members || (b.points > a.points ? 1 : b.points < a.points ? -1 : 0) || a.id - b.id);
}

/** Pool names are free text set by the operator: printable, single line, short. */
export function poolName(bytes: unknown): string | null {
  let s: string | null = null;
  try {
    if (bytes instanceof Uint8Array) s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    else if (bytes && typeof (bytes as { asText?: () => string }).asText === "function") s = (bytes as { asText(): string }).asText();
  } catch {
    return null;
  }
  const clean = s?.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
}

function amountOf(v: string | undefined, symbol: string): bigint {
  if (!v || !/^\d+$/.test(v) || BigInt(v) <= 0n) throw new ClipError(msg("bg.err.enterHowMuchToStake", { symbol }), "staking/bad-amount");
  return BigInt(v);
}

export class PolkadotStaking implements StakingProvider {
  readonly family = "substrate" as const;
  readonly wholeBalance = false;
  readonly assetKey: string;
  readonly howItWorks: string;
  private readonly module: SubstrateModule;

  /**
   * One instance per native key: "dot" (Polkadot), "ksm" (Kusama), "wnd" (Westend), "pas" (Paseo). Register the
   * keys your networks use (see `polkadotStakingProviders`).
   */
  constructor(opts: { assetKey?: string; module?: SubstrateModule } = {}) {
    this.assetKey = opts.assetKey ?? "dot";
    this.module = opts.module ?? substrateModule;
    const sym = SUBSTRATE_SPECS.find((s) => s.key === this.assetKey)?.symbol ?? this.assetKey.toUpperCase();
    this.howItWorks =
      `You add ${sym} to a staking pool. The pool picks validators for you and your share of the rewards collects in the pool; claim it whenever you like. ` +
      `Your ${sym} stays in your account but is locked while staked. When you unstake, it unlocks after a waiting period (Clip Wallet shows how long before you confirm), then you move it back to your balance.`;
  }

  supports(network: Network): boolean {
    const spec = specOf(network.id);
    return network.family === "substrate" && !!spec?.assetHub && spec.key === this.assetKey && network.rpcUrls.length > 0;
  }

  private async conn(ctx: ChainContext): Promise<Connection> {
    const c = await connect(ctx);
    if (!c.rt.pallets.has("NominationPools")) throw new ClipError(`Staking ${c.spec.symbol} isn't available right now.`, "staking/no-pools");
    return c;
  }

  private fmt(c: Connection, v: bigint | string): string {
    return `${formatUnits(v, c.spec.decimals, 4)} ${c.spec.symbol}`;
  }

  private async waitText(c: Connection): Promise<string> {
    const eras = await poolUnbondingEras(c);
    return (eras !== null && erasToText(c.spec, eras)) || "a waiting period";
  }

  /** Ranked open pools that are actually nominating (checked for the top few). */
  async pools(ctx: ChainContext): Promise<(RankedPool & { name: string | null })[]> {
    const c = await this.conn(ctx);
    const entries = await storageEntries<BondedPool>(c.rpc, c.rt, "NominationPools", "BondedPools");
    const maxMembers = await readStorage<number | undefined>(c.rpc, c.rt, "NominationPools", "MaxPoolMembersPerPool").catch(() => null);
    const ranked = rankPools(
      entries.map(([k, v]) => [Number(k[0]), v]),
      typeof maxMembers === "number" ? maxMembers : null,
    );
    const canCheck = c.rt.hasApi("NominationPoolsApi", "pool_accounts");
    const checked = await Promise.all(
      ranked.slice(0, CHECK_TOP).map(async (p) => {
        if (canCheck) {
          const nominating = await runtimeCall<[string, string]>(c.rpc, c.rt, "NominationPoolsApi", "pool_accounts", [p.id])
            .then(([bonded]) => readStorage<{ targets: unknown[] } | null>(c.rpc, c.rt, "Staking", "Nominators", bonded))
            .then((n) => !!n && Array.isArray(n.targets) && n.targets.length > 0)
            .catch(() => false);
          if (!nominating) return null;
        }
        const name = poolName(await readStorage(c.rpc, c.rt, "NominationPools", "Metadata", p.id).catch(() => null));
        return { ...p, name };
      }),
    );
    const out = checked.filter((p): p is RankedPool & { name: string | null } => p !== null).slice(0, SHOW);
    return out;
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const pools = await this.pools(ctx);
    if (!pools.length) throw new ClipError("No staking pool meets Clip Wallet's checks right now. Try again later.", "staking/no-pools");
    return pools.map((p, i) => {
      const v: StakeOptionView = {
        id: String(p.id),
        title: p.name ? `Pool ${p.id} · ${p.name}` : say("bg.staking.pool", { address: p.id }),
        detail: `Keeps ${percent(p.commissionPct)} of rewards · ${p.members} member${p.members === 1 ? "" : "s"}`,
      };
      if (i === 0) v.recommended = true;
      return v;
    });
  }

  private async member(c: Connection): Promise<PoolMember | null> {
    const m = await readStorage<PoolMember>(c.rpc, c.rt, "NominationPools", "PoolMembers", c.me);
    return m ? { pool_id: Number(m.pool_id), points: BigInt(m.points), unbonding_eras: (m.unbonding_eras ?? []).map(([e, a]) => [Number(e), BigInt(a)]) } : null;
  }

  private async bonded(c: Connection, m: PoolMember): Promise<bigint> {
    if (m.points === 0n) return 0n;
    if (!c.rt.hasApi("NominationPoolsApi", "points_to_balance")) return m.points;
    return runtimeCall<bigint>(c.rpc, c.rt, "NominationPoolsApi", "points_to_balance", [m.pool_id, m.points]).catch(() => m.points);
  }

  private async pending(c: Connection): Promise<bigint> {
    if (!c.rt.hasApi("NominationPoolsApi", "pending_rewards")) return 0n;
    return BigInt(await runtimeCall<bigint>(c.rpc, c.rt, "NominationPoolsApi", "pending_rewards", [c.me]).catch(() => 0n));
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const c = await this.conn(ctx);
    const m = await this.member(c);
    if (!m) return [];
    const [bonded, pending, era, name] = await Promise.all([
      this.bonded(c, m),
      this.pending(c),
      activeEra(c),
      readStorage(c.rpc, c.rt, "NominationPools", "Metadata", m.pool_id)
        .then(poolName)
        .catch(() => null),
    ]);
    const base = { assetKey: this.assetKey, symbol: c.spec.symbol, decimals: c.spec.decimals, networkId: ctx.network.id, with: name ? `Pool ${m.pool_id} · ${name}` : say("bg.staking.pool", { address: m.pool_id }) };
    const out: StakePositionView[] = [];
    if (bonded > 0n || pending > 0n) {
      const p: StakePositionView = {
        ...base,
        id: `pool:${m.pool_id}`,
        amount: bonded.toString(),
        amountDisplay: this.fmt(c, bonded),
        status: "active",
        statusText: "Earning rewards",
        actions: bonded > 0n ? ["unstake"] : [],
        partialUnstake: true,
      };
      if (pending > 0n) {
        p.pendingReward = { amount: pending.toString(), display: this.fmt(c, pending) };
        p.actions.push("claim");
      }
      out.push(p);
    }
    const ready = m.unbonding_eras.filter(([e]) => era !== null && e <= era);
    const readyAmount = ready.reduce((t, [, a]) => t + a, 0n);
    if (readyAmount > 0n) {
      out.push({ ...base, id: `pool:${m.pool_id}:ready`, amount: readyAmount.toString(), amountDisplay: this.fmt(c, readyAmount), status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"] });
    }
    for (const [e, a] of m.unbonding_eras.filter(([e]) => era === null || e > era).sort((x, y) => x[0] - y[0])) {
      const left = era === null ? null : erasToText(c.spec, e - era);
      out.push({
        ...base,
        id: `pool:${m.pool_id}:era:${e}`,
        amount: a.toString(),
        amountDisplay: this.fmt(c, a),
        status: "deactivating",
        statusText: left ? `Unlocks in ${left}` : "Unlocking",
        actions: [],
      });
    }
    return out;
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    const c = await this.conn(ctx);
    const amount = amountOf(p.amount, c.spec.symbol);
    const spendable = await spendableNative(c);
    const feeBuffer = 10n ** BigInt(Math.max(0, c.spec.decimals - 2)); // 0.01 of the coin for the network fee
    if (amount + feeBuffer > spendable) {
      const max = spendable > feeBuffer ? spendable - feeBuffer : 0n;
      throw new ClipError(
        max > 0n
          ? `You can stake up to ${this.fmt(c, max)}. Clip Wallet keeps ${this.fmt(c, existentialDeposit(c.rt))} in your account (the network's minimum) plus a little for the fee.`
          : `You don't have enough ${c.spec.symbol} to stake. Your account must keep ${this.fmt(c, existentialDeposit(c.rt))} plus a little for the fee.`,
        "staking/insufficient",
      );
    }
    const wait = await this.waitText(c);
    const m = await this.member(c);
    if (m) {
      // You can be in one pool at a time: add to it.
      const name = poolName(await readStorage(c.rpc, c.rt, "NominationPools", "Metadata", m.pool_id).catch(() => null));
      const request = await this.call(ctx, "bond_extra", { extra: Enum("FreeBalance", amount) });
      return {
        steps: [
          {
            ...titled(msg("bg.req.stakeMore", { amount: this.fmt(c, amount) })),
            request,
            lines: [
              { label: "Pool", value: name ? `Pool ${m.pool_id} · ${name}` : say("bg.staking.pool", { address: m.pool_id }) },
              ...(p.optionId && p.optionId !== String(m.pool_id) ? [{ label: "Note", value: "You're already in this pool, and you can only be in one at a time, so this adds to it." }] : []),
              { label: "Unstaking takes", value: wait },
            ],
          },
        ],
      };
    }
    const min = BigInt((await readStorage<bigint>(c.rpc, c.rt, "NominationPools", "MinJoinBond")) ?? 0n);
    if (amount < min) throw new ClipError(`Stake at least ${this.fmt(c, min)} to join a pool.`, "staking/below-minimum");
    let poolId = p.optionId !== undefined ? Number(p.optionId) : undefined;
    let label: string;
    if (poolId === undefined) {
      const best = (await this.pools(ctx))[0];
      if (!best) throw new ClipError("No staking pool meets Clip Wallet's checks right now. Try again later.", "staking/no-pools");
      poolId = best.id;
      label = best.name ? `Pool ${best.id} · ${best.name}` : say("bg.staking.pool", { address: best.id });
    } else {
      if (!Number.isSafeInteger(poolId) || poolId < 0) throw new ClipError("That staking pool couldn't be found.", "staking/unknown-option");
      const pool = await readStorage<BondedPool>(c.rpc, c.rt, "NominationPools", "BondedPools", poolId);
      if (!pool) throw new ClipError("That staking pool couldn't be found.", "staking/unknown-option");
      if (pool.state.type !== "Open") throw new ClipError("That pool isn't taking new members. Pick another one.", "staking/pool-closed");
      const name = poolName(await readStorage(c.rpc, c.rt, "NominationPools", "Metadata", poolId).catch(() => null));
      label = name ? `Pool ${poolId} · ${name}` : say("bg.staking.pool", { address: poolId });
    }
    const request = await this.call(ctx, "join", { amount, pool_id: poolId });
    return {
      steps: [
        {
          ...titled(msg("bg.req.stake", { amount: this.fmt(c, amount) })),
          request,
          lines: [
            { label: "Pool", value: label },
            { label: "Starts earning", value: "From the next reward period" },
            { label: "Unstaking takes", value: wait },
          ],
        },
      ],
    };
  }

  private async ownPool(c: Connection, positionId: string): Promise<PoolMember> {
    const m = await this.member(c);
    const id = /^pool:(\d+)/.exec(positionId)?.[1];
    if (!m || id === undefined || Number(id) !== m.pool_id) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    return m;
  }

  async buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const c = await this.conn(ctx);
    const m = await this.ownPool(c, p.positionId);
    const bonded = await this.bonded(c, m);
    if (m.points === 0n || bonded === 0n) throw new ClipError(`You have no ${c.spec.symbol} staked in this pool.`, "staking/nothing-staked");
    let points = m.points;
    let amount = bonded;
    if (p.amount !== undefined) {
      amount = amountOf(p.amount, c.spec.symbol);
      if (amount > bonded) throw new ClipError(`You have ${this.fmt(c, bonded)} staked. Enter that or less.`, "staking/too-much");
      if (amount < bonded) {
        const min = BigInt((await readStorage<bigint>(c.rpc, c.rt, "NominationPools", "MinJoinBond")) ?? 0n);
        if (bonded - amount < min) throw new ClipError(`Leave at least ${this.fmt(c, min)} staked, or unstake everything.`, "staking/below-minimum");
        points = c.rt.hasApi("NominationPoolsApi", "balance_to_points")
          ? BigInt(await runtimeCall<bigint>(c.rpc, c.rt, "NominationPoolsApi", "balance_to_points", [m.pool_id, amount]))
          : amount;
        if (points > m.points) points = m.points;
      }
    }
    const wait = await this.waitText(c);
    const pending = await this.pending(c);
    const request = await this.call(ctx, "unbond", { member_account: Enum("Id", c.me), unbonding_points: points });
    return {
      steps: [
        {
          ...titled(msg("bg.req.unstake", { amount: this.fmt(c, amount) })),
          request,
          lines: [
            { label: "Ready", value: `In ${wait}, then move it back to your balance` },
            ...(pending > 0n ? [{ label: "Rewards", value: `Your ${this.fmt(c, pending)} of rewards are paid to you now` }] : []),
          ],
        },
      ],
    };
  }

  async buildWithdraw(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const c = await this.conn(ctx);
    const m = await this.ownPool(c, p.positionId);
    const era = await activeEra(c);
    const ready = m.unbonding_eras.filter(([e]) => era !== null && e <= era).reduce((t, [, a]) => t + a, 0n);
    if (ready === 0n) throw new ClipError(`This ${c.spec.symbol} is still unlocking. Try again once it's ready.`, "staking/not-withdrawable");
    const request = await this.call(ctx, "withdraw_unbonded", { member_account: Enum("Id", c.me), num_slashing_spans: 0 });
    return { steps: [{ ...titled(msg("bg.req.moveBack", { amount: this.fmt(c, ready) })), request }] };
  }

  async buildClaim(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const c = await this.conn(ctx);
    await this.ownPool(c, p.positionId);
    const pending = await this.pending(c);
    if (pending === 0n) throw new ClipError("There are no rewards to claim yet.", "staking/nothing-to-claim");
    const request = await this.call(ctx, "claim_payout", undefined);
    return { steps: [{ ...titled(msg("bg.req.claimRewards", { amount: this.fmt(c, pending) })), request, lines: [{ label: "Goes to", value: "Your balance" }] }] };
  }

  private call(ctx: ChainContext, call: string, args: unknown): Promise<DappRequest> {
    return this.module.buildCall({ pallet: "NominationPools", call, args }, ctx);
  }
}

/** One provider per native key present on these networks' Asset Hubs ("wnd" and "pas" on testnets, "dot"/"ksm" on mainnet). */
export function polkadotStakingProviders(networks: Network[], module?: SubstrateModule): PolkadotStaking[] {
  const keys = new Set(networks.filter((n) => n.family === "substrate" && specOf(n.id)?.assetHub).map((n) => n.nativeAsset.key));
  return POLKADOT_STAKING_KEYS.filter((k) => keys.has(k)).map((assetKey) => new PolkadotStaking({ assetKey, ...(module ? { module } : {}) }));
}
