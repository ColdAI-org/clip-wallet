import { type ChainContext, ClipError, type Network } from "@clip-wallet/core";
import { NEAR_CHAINS, NearRpc, createNearModule, isPool, networkName, poolName, type NearModule } from "@clip-wallet/chains-near";
import { fetchJson } from "../http.js";
import type { StakeOptionView, StakePositionView } from "../views.js";
import { formatUnits, percent } from "../util.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * NEAR staking through staking-pool contracts (https://github.com/near/core-contracts/tree/master/staking-pool,
 * src/lib.rs): `deposit_and_stake` (attached NEAR), `unstake {amount}` / `unstake_all`, `withdraw {amount}` /
 * `withdraw_all`; views `get_account` (staked_balance, unstaked_balance, can_withdraw), `get_reward_fee_fraction`,
 * `is_staking_paused`. Unstaked NEAR unlocks NUM_EPOCHS_TO_UNLOCK = 4 epochs after the last unstake (an epoch is
 * 43,200 blocks, measured at about 7 hours on mainnet and testnet on 2026-10-03, so 3–4 epochs ≈ 21–28 h). Each
 * unstake resets the unlock time of everything unstaked in that pool (internal.rs inner_unstake).
 *
 * The requests are the chain module's own staking builders (chains-near `staking.buildStake/buildUnstake/
 * buildWithdraw`, 125 Tgas, `near_signAndSendTransaction`), which its decode() describes plainly
 * ("Stake 50 NEAR with kiln").
 *
 * Reads: RPC `validators` (current/next validators, produced vs expected blocks/chunks/endorsements, kickouts),
 * `EXPERIMENTAL_protocol_config` (max_inflation_rate, protocol_reward_rate), `block` (total_supply), pool views,
 * and FastNEAR `GET /v1/account/{id}/staking` (keyless) for which pools an account has used.
 */
const DUST = 1000n;
/** NEAR kept back for network fees when staking (125 Tgas at today's gas price is well under 0.02 NEAR). */
export const NEAR_FEE_RESERVE = 50_000_000_000_000_000_000_000n;
const MAX_FEE = 0.1;
const MIN_UPTIME = 0.95;
/** Pools whose fee is read per options() call (largest healthy first), and pools probed when FastNEAR is down. */
const FEE_LOOKUPS = 40;
const PROBE_LIMIT = 60;
const UNLOCK_TEXT = "about 1–2 days";

export interface NearValidatorInfo {
  account_id: string;
  stake: string;
  is_slashed?: boolean;
  num_produced_blocks?: number;
  num_expected_blocks?: number;
  num_produced_chunks?: number;
  num_expected_chunks?: number;
  num_produced_endorsements?: number;
  num_expected_endorsements?: number;
}

export interface NearValidatorsResult {
  current_validators: NearValidatorInfo[];
  next_validators?: { account_id: string; stake: string }[];
  prev_epoch_kickout?: { account_id: string }[];
}

export interface PoolChoice {
  pool: string;
  stake: bigint;
  uptime: number;
  /** Share of rewards the pool keeps (0..1). */
  fee?: number;
  paused?: boolean;
  apy?: number;
}

interface PoolAccount {
  staked_balance: string;
  unstaked_balance: string;
  can_withdraw: boolean;
}

/** Average of produced/expected over blocks, chunks and endorsements that were expected (nearcore counts none expected as fully online). */
export function uptimeOf(v: NearValidatorInfo): number {
  const pairs: [number | undefined, number | undefined][] = [
    [v.num_produced_blocks, v.num_expected_blocks],
    [v.num_produced_chunks, v.num_expected_chunks],
    [v.num_produced_endorsements, v.num_expected_endorsements],
  ];
  const ratios = pairs.filter(([, e]) => (e ?? 0) > 0).map(([p, e]) => Math.min(1, (p ?? 0) / e!));
  return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
}

/**
 * Staking pools worth recommending, before fees are known: pool contracts in the current validator set that
 * aren't slashed, weren't kicked out last epoch, stay in the next epoch, were online at least 95 %, and aren't
 * in the top 10 % by stake (spreads stake out).
 */
export function poolCandidates(v: NearValidatorsResult, networkId: string, extra: string[] = []): PoolChoice[] {
  const kicked = new Set((v.prev_epoch_kickout ?? []).map((k) => k.account_id));
  const next = v.next_validators?.length ? new Set(v.next_validators.map((n) => n.account_id)) : null;
  const byStake = [...v.current_validators].sort((a, b) => (BigInt(b.stake) > BigInt(a.stake) ? 1 : BigInt(b.stake) < BigInt(a.stake) ? -1 : 0));
  const tooBig = new Set(byStake.slice(0, Math.floor(byStake.length / 10)).map((x) => x.account_id));
  return byStake
    .filter((x) => isPool(networkId, x.account_id) || extra.includes(x.account_id))
    .filter((x) => !x.is_slashed && !kicked.has(x.account_id) && (!next || next.has(x.account_id)) && !tooBig.has(x.account_id))
    .map((x) => ({ pool: x.account_id, stake: BigInt(x.stake), uptime: uptimeOf(x) }))
    .filter((c) => c.uptime >= MIN_UPTIME);
}

/** Healthy pools best first: fee at most 10 %, not paused; lowest fee, then best uptime, then larger stake. */
export function rankPools(choices: PoolChoice[]): PoolChoice[] {
  return choices
    .filter((c) => c.fee !== undefined && c.fee <= MAX_FEE && !c.paused)
    .sort((a, b) => a.fee! - b.fee! || b.uptime - a.uptime || (b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0));
}

/** Network-wide yearly rate before pool fees, in percent: max_inflation × (1 − protocol share) × supply / stake. */
export function nearBaseApy(cfg: { max_inflation_rate: [number, number]; protocol_reward_rate: [number, number] }, totalSupply: bigint, totalStake: bigint): number | undefined {
  if (totalStake <= 0n) return undefined;
  const [mn, md] = cfg.max_inflation_rate;
  const [pn, pd] = cfg.protocol_reward_rate;
  if (!md || !pd) return undefined;
  const ratio = Number((totalSupply * 1_000_000n) / totalStake) / 1_000_000;
  return (mn / md) * (1 - pn / pd) * ratio * 100;
}

const near = (yocto: bigint, digits = 4) => `${formatUnits(yocto, 24, digits)} NEAR`;

/** Position ids: the pool for the staked part, `<pool>#unstaking` / `<pool>#withdrawable` for unstaked NEAR. */
function poolOf(positionId: string): string {
  return positionId.split("#")[0]!;
}

export class NearStaking implements StakingProvider {
  readonly family = "near" as const;
  readonly assetKey = "near";
  readonly wholeBalance = false;
  readonly howItWorks =
    "You put an amount of NEAR in a staking pool run by a validator. Only you can take it out. Rewards are added to your stake automatically, a few times a day. You can unstake any part of it; it unlocks in about 1–2 days, then you move it back to your balance.";
  private readonly module: NearModule;
  private readonly pools: Record<string, string[]>;

  /** `pools`: extra staking pools per network id to check for positions and allow (e.g. ones you curate). */
  constructor(opts: { pools?: Record<string, string[]>; module?: NearModule } = {}) {
    this.pools = opts.pools ?? {};
    this.module = opts.module ?? createNearModule({ stakingPools: this.pools });
  }

  supports(network: Network): boolean {
    return network.family === "near" && network.rpcUrls.length > 0 && networkName(network.id) !== null;
  }

  private rpc(ctx: ChainContext): NearRpc {
    const url = ctx.network.rpcUrls[0];
    if (!url) throw new ClipError("Staking isn't available right now.", "staking/no-rpc");
    return new NearRpc(url, ctx.fetch);
  }

  private async read<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("Couldn't reach NEAR right now. Check your connection and try again.", "staking/unreachable", e);
    }
  }

  private validators(rpc: NearRpc): Promise<NearValidatorsResult> {
    return this.read(rpc.call<NearValidatorsResult>("validators", [null]));
  }

  private async baseApy(rpc: NearRpc, v: NearValidatorsResult): Promise<number | undefined> {
    try {
      const cfg = await rpc.call<{ max_inflation_rate: [number, number]; protocol_reward_rate: [number, number] }>("EXPERIMENTAL_protocol_config", { finality: "final" });
      const block = await rpc.call<{ header: { total_supply: string } }>("block", { finality: "final" });
      const stake = v.current_validators.reduce((t, x) => t + BigInt(x.stake), 0n);
      return nearBaseApy(cfg, BigInt(block.header.total_supply), stake);
    } catch {
      return undefined;
    }
  }

  async ranked(ctx: ChainContext): Promise<PoolChoice[]> {
    const rpc = this.rpc(ctx);
    const v = await this.validators(rpc);
    const candidates = poolCandidates(v, ctx.network.id, this.pools[ctx.network.id]).slice(0, FEE_LOOKUPS);
    const base = await this.baseApy(rpc, v);
    await Promise.all(
      candidates.map(async (c) => {
        try {
          const [f, paused] = await Promise.all([
            rpc.view<{ numerator: number; denominator: number }>(c.pool, "get_reward_fee_fraction", {}),
            rpc.view<boolean>(c.pool, "is_staking_paused", {}),
          ]);
          if (f.denominator > 0) c.fee = f.numerator / f.denominator;
          c.paused = paused === true;
          if (base !== undefined && c.fee !== undefined) c.apy = base * (1 - c.fee);
        } catch {
          // Unreadable pool: left without a fee, so it isn't offered.
        }
      }),
    );
    return rankPools(candidates);
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const ranked = await this.ranked(ctx);
    if (!ranked.length) throw new ClipError("No validator meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    return ranked.slice(0, 10).map((c, i) => {
      const o: StakeOptionView = {
        id: c.pool,
        title: `Validator ${poolName(c.pool)}`,
        detail: `${c.apy !== undefined ? `Earns about ${percent(c.apy)} a year · ` : ""}keeps ${percent(c.fee! * 100)} of rewards · online ${percent(c.uptime * 100, 0)}`,
      };
      if (c.apy !== undefined) o.apy = c.apy;
      if (i === 0) o.recommended = true;
      return o;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.options(ctx).catch(() => []))[0];
    return best?.apy !== undefined ? `About ${percent(best.apy)} a year` : undefined;
  }

  /** Pools this account has used: configured ones + FastNEAR; if FastNEAR is down, the current validator pools (bounded). */
  private async poolsFor(ctx: ChainContext): Promise<string[]> {
    const pools = new Set(this.pools[ctx.network.id] ?? []);
    const name = networkName(ctx.network.id);
    const api = (ctx.network.indexerUrl ?? (name ? NEAR_CHAINS[name].fastnear : "")).replace(/\/+$/, "");
    try {
      const r = await fetchJson<{ pools?: { pool_id?: unknown }[] }>(ctx.fetch, `${api}/v1/account/${encodeURIComponent(ctx.account.address)}/staking`, "FastNEAR", { timeoutMs: 6000 });
      for (const p of r.pools ?? []) if (typeof p.pool_id === "string") pools.add(p.pool_id);
    } catch {
      const v = await this.validators(this.rpc(ctx));
      const byStake = [...v.current_validators].filter((x) => isPool(ctx.network.id, x.account_id)).sort((a, b) => (BigInt(b.stake) > BigInt(a.stake) ? 1 : -1));
      for (const x of byStake.slice(0, PROBE_LIMIT)) pools.add(x.account_id);
    }
    return [...pools].filter((p) => isPool(ctx.network.id, p) || (this.pools[ctx.network.id] ?? []).includes(p));
  }

  private async poolAccount(rpc: NearRpc, pool: string, me: string): Promise<PoolAccount> {
    return this.read(rpc.view<PoolAccount>(pool, "get_account", { account_id: me }));
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const rpc = this.rpc(ctx);
    const me = ctx.account.address;
    const pools = await this.poolsFor(ctx);
    const accounts = await Promise.all(pools.map((p) => rpc.view<PoolAccount>(p, "get_account", { account_id: me }).then((a) => [p, a] as const, () => null)));
    const out: StakePositionView[] = [];
    const base = { assetKey: "near", symbol: "NEAR", decimals: 24, networkId: ctx.network.id };
    for (const entry of accounts) {
      if (!entry) continue;
      const [pool, a] = entry;
      const staked = BigInt(a.staked_balance ?? "0");
      const unstaked = BigInt(a.unstaked_balance ?? "0");
      const withValidator = `Validator ${poolName(pool)}`;
      if (staked > DUST) {
        out.push({ ...base, id: pool, amount: staked.toString(), amountDisplay: near(staked), with: withValidator, status: "active", statusText: "Earning rewards", actions: ["unstake"], partialUnstake: true });
      }
      if (unstaked > DUST) {
        out.push(
          a.can_withdraw
            ? { ...base, id: `${pool}#withdrawable`, amount: unstaked.toString(), amountDisplay: near(unstaked), with: withValidator, status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"] }
            : { ...base, id: `${pool}#unstaking`, amount: unstaked.toString(), amountDisplay: near(unstaked), with: withValidator, status: "deactivating", statusText: `Unlocking. Ready in ${UNLOCK_TEXT}`, actions: [] },
        );
      }
    }
    return out;
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    if (!p.amount || !/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much NEAR to stake.", "staking/bad-amount");
    const amount = BigInt(p.amount);
    const pool = p.optionId ?? (await this.ranked(ctx))[0]?.pool;
    if (!pool) throw new ClipError("No validator meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    const bal = await this.read(this.module.getNearBalance(ctx));
    if (amount + NEAR_FEE_RESERVE > bal.available) {
      throw new ClipError(`You don't have enough NEAR to stake that much. Keep about ${near(NEAR_FEE_RESERVE)} for network fees.`, "staking/insufficient");
    }
    const request = await this.module.staking.buildStake({ validator: pool, amount: amount.toString() }, ctx);
    return {
      steps: [
        {
          title: `Stake ${near(amount, 6)}`,
          request,
          lines: [
            { label: "With", value: `Validator ${poolName(pool)}` },
            { label: "Starts earning", value: "From the next epoch, within about 7 hours" },
            { label: "Unstaking later", value: `Takes ${UNLOCK_TEXT}` },
          ],
        },
      ],
    };
  }

  private async stakedIn(ctx: ChainContext, positionId: string): Promise<{ pool: string; account: PoolAccount }> {
    const pool = poolOf(positionId);
    if (!isPool(ctx.network.id, pool) && !(this.pools[ctx.network.id] ?? []).includes(pool)) {
      throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    }
    return { pool, account: await this.poolAccount(this.rpc(ctx), pool, ctx.account.address) };
  }

  async buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const { pool, account } = await this.stakedIn(ctx, p.positionId);
    const staked = BigInt(account.staked_balance ?? "0");
    if (staked <= DUST) throw new ClipError("There's no NEAR staked with this validator.", "staking/nothing-staked");
    let amount: bigint | undefined;
    if (p.amount !== undefined) {
      if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much NEAR to unstake.", "staking/bad-amount");
      amount = BigInt(p.amount);
      if (amount > staked) throw new ClipError(`You have ${near(staked)} staked with this validator.`, "staking/too-much");
      if (amount === staked) amount = undefined;
    }
    const request = await this.module.staking.buildUnstake(amount === undefined ? { validator: pool } : { validator: pool, amount: amount.toString() }, ctx);
    const lines = [
      { label: "From", value: `Validator ${poolName(pool)}` },
      { label: "Ready", value: `In ${UNLOCK_TEXT}, then move it back to your balance` },
    ];
    const unstaked = BigInt(account.unstaked_balance ?? "0");
    if (unstaked > DUST) {
      lines.push({
        label: "Note",
        value: account.can_withdraw
          ? `Move the ${near(unstaked)} that's ready back to your balance first, or it gets locked again together with this.`
          : `The ${near(unstaked)} already unlocking here will be ready at the same new time as this.`,
      });
    }
    return { steps: [{ title: amount === undefined ? `Unstake all ${near(staked)}` : `Unstake ${near(amount, 6)}`, request, lines }] };
  }

  async buildWithdraw(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const { pool, account } = await this.stakedIn(ctx, p.positionId);
    const unstaked = BigInt(account.unstaked_balance ?? "0");
    if (unstaked <= DUST) throw new ClipError("There's no unstaked NEAR to move back with this validator.", "staking/nothing-to-withdraw");
    if (!account.can_withdraw) throw new ClipError(`This NEAR is still unlocking. It's ready in ${UNLOCK_TEXT}.`, "staking/not-withdrawable");
    let amount: bigint | undefined;
    if (p.amount !== undefined) {
      if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much NEAR to move back.", "staking/bad-amount");
      amount = BigInt(p.amount);
      if (amount > unstaked) throw new ClipError(`You have ${near(unstaked)} ready to move back.`, "staking/too-much");
      if (amount === unstaked) amount = undefined;
    }
    const request = await this.module.staking.buildWithdraw(amount === undefined ? { validator: pool } : { validator: pool, amount: amount.toString() }, ctx);
    return { steps: [{ title: `Move ${near(amount ?? unstaked)} back to your balance`, request, lines: [{ label: "From", value: `Validator ${poolName(pool)}` }] }] };
  }
}
