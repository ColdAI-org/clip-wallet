import { type ChainContext, ClipError, type Network } from "@clip-wallet/core";
import {
  type CardanoModule,
  type DrepChoice,
  Koios,
  type KoiosEpochRewards,
  type KoiosPool,
  type KoiosPoolListItem,
  type StakingInfo,
  createCardanoModule,
} from "@clip-wallet/chains-cardano";
import type { Step } from "../steps.js";
import { formatUnits, percent } from "../util.js";
import type { StakeOptionView, StakePositionView } from "../views.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * Cardano stake-pool delegation. Nothing is locked: the stake key is registered (2 ADA deposit, refunded on
 * deregistration) and delegated to a pool; the whole balance at the address earns.
 *
 * Reads (Koios public tier, no key): GET /pool_list (PostgREST filters), POST /pool_info (live_saturation,
 * live_pledge, margin, fixed_cost, retiring_epoch), GET /epoch_info (total_rewards / active_stake → yearly rate),
 * POST /account_info (via chains-cardano getStaking: pool, rewards_available, delegated_drep, deposit).
 *
 * Builds: chains-cardano buildDelegate (cert 0 + 2), buildVoteDelegate (cert 9), buildWithdrawRewards
 * (withdrawal), buildDeregister (cert 8 + withdrawal). Each is a cardano_signAndSubmitTx request the module
 * decodes in plain words (not blind) and signs with the payment + stake keys.
 *
 * Plomin rule (protocol version 10+): a key-hash stake credential can only withdraw rewards if it is already
 * delegated to a DRep, judged on the ledger state BEFORE the transaction's certificates (cardano-ledger
 * Conway LEDGER rule, validateWithdrawalsDelegated). So "claim" without a vote delegation is two approvals:
 * first the vote delegation, then (after it is on chain) the withdrawal.
 */

/** Pools the wallet considers: saturation (percent of the saturation point) below this. */
export const MAX_SATURATION = 100;
/** "Moderate" saturation band the recommendation prefers (percent). */
export const GOOD_SATURATION: readonly [number, number] = [5, 90];
const OPTIONS_TTL_MS = 5 * 60_000;
const CANDIDATES = 40;

export const CLAIM_CHOICES: NonNullable<StakePositionView["claimChoices"]> = [
  {
    id: "abstain",
    title: "Abstain from votes",
    detail: "Your ADA doesn't count in Cardano's community votes. Nothing else changes, and you can change this later.",
  },
  {
    id: "no-confidence",
    title: "No confidence",
    detail: "Your ADA counts as a vote of no confidence in Cardano's current leadership, and against other proposals. You can change this later.",
  },
];

export interface PoolChoice {
  pool: KoiosPool;
  ticker?: string;
  /** Yearly rate for delegators, percent, after the pool's fixed fee and margin. */
  apy?: number;
  saturation: number;
  margin: number;
  fixedCost: bigint;
}

export interface NetworkRate {
  /** Rewards paid per lovelace staked in one epoch (all pools, before fees). */
  perEpoch: number;
  epochsPerYear: number;
}

export function networkRate(e: KoiosEpochRewards | undefined): NetworkRate | undefined {
  if (!e?.total_rewards || !e.active_stake) return undefined;
  const stake = Number(e.active_stake);
  const len = e.end_time - e.start_time;
  if (!(stake > 0) || !(len > 0)) return undefined;
  return { perEpoch: Number(e.total_rewards) / stake, epochsPerYear: (365.25 * 86_400) / len };
}

/** Delegators' yearly rate for a pool, percent: (expected pool rewards − fixed fee) × (1 − margin) / stake. */
export function poolApy(p: KoiosPool, rate: NetworkRate | undefined): number | undefined {
  const stake = Number(p.live_stake ?? p.active_stake ?? 0);
  if (!rate || !(stake > 0)) return undefined;
  const perEpoch = rate.perEpoch * stake;
  const toDelegators = Math.max(0, perEpoch - Number(p.fixed_cost ?? 0)) * (1 - (p.margin ?? 0));
  const apy = (toDelegators / stake) * rate.epochsPerYear * 100;
  return apy > 0 ? apy : undefined;
}

/**
 * Keep registered pools that aren't retiring, aren't saturated and meet their pledge (a pool below its pledge
 * earns nothing). Best first: inside the moderate saturation band, then highest delegator rate (which folds in
 * margin and fixed fee), then lowest margin and fixed fee, then saturation closest to the middle of the band.
 */
export function rankPools(pools: KoiosPool[], rate?: NetworkRate, tickers: Map<string, string> = new Map()): PoolChoice[] {
  const out: PoolChoice[] = [];
  for (const pool of pools) {
    if (pool.pool_status && pool.pool_status !== "registered") continue;
    if (pool.retiring_epoch != null) continue;
    const saturation = pool.live_saturation ?? 0;
    if (saturation >= MAX_SATURATION) continue;
    if (pool.pledge != null && pool.live_pledge != null && BigInt(pool.live_pledge) < BigInt(pool.pledge)) continue;
    const c: PoolChoice = { pool, saturation, margin: pool.margin ?? 0, fixedCost: BigInt(pool.fixed_cost ?? "0") };
    const t = pool.meta_json?.ticker ?? tickers.get(pool.pool_id_bech32);
    if (t) c.ticker = t;
    const apy = poolApy(pool, rate);
    if (apy !== undefined) c.apy = apy;
    out.push(c);
  }
  const inBand = (c: PoolChoice) => (c.saturation >= GOOD_SATURATION[0] && c.saturation <= GOOD_SATURATION[1] ? 0 : 1);
  const mid = (GOOD_SATURATION[0] + GOOD_SATURATION[1]) / 2;
  return out.sort(
    (a, b) =>
      inBand(a) - inBand(b) ||
      (b.apy ?? -1) - (a.apy ?? -1) ||
      a.margin - b.margin ||
      (a.fixedCost < b.fixedCost ? -1 : a.fixedCost > b.fixedCost ? 1 : 0) ||
      Math.abs(a.saturation - mid) - Math.abs(b.saturation - mid),
  );
}

/** From /pool_list rows, the ones worth a /pool_info look: larger half by stake, then cheapest first. */
export function shortlist(list: KoiosPoolListItem[], n = CANDIDATES): string[] {
  const live = list.filter((p) => p.retiring_epoch == null && p.active_stake && BigInt(p.active_stake) > 0n);
  const byStake = [...live].sort((a, b) => (BigInt(b.active_stake!) > BigInt(a.active_stake!) ? 1 : -1));
  const half = byStake.slice(0, Math.max(n, Math.ceil(byStake.length / 2)));
  const fee = (p: KoiosPoolListItem) => BigInt(p.fixed_cost ?? "0");
  return half
    .sort((a, b) => (a.margin ?? 1) - (b.margin ?? 1) || (fee(a) < fee(b) ? -1 : fee(a) > fee(b) ? 1 : 0))
    .slice(0, n)
    .map((p) => p.pool_id_bech32);
}

const ada = (lovelace: string | bigint, digits = 6) => `${formatUnits(lovelace, 6, digits)} ADA`;

function poolTitle(c: { ticker?: string; pool: KoiosPool }): string {
  const name = c.pool.meta_json?.name?.trim();
  if (c.ticker && name && name.toUpperCase() !== c.ticker.toUpperCase()) return `${c.ticker} · ${name}`;
  return c.ticker ?? name ?? `Pool ${c.pool.pool_id_bech32.slice(0, 12)}…`;
}

function poolDetail(c: PoolChoice): string {
  const parts: string[] = [];
  if (c.apy !== undefined) parts.push(`Earns about ${percent(c.apy, 1)} a year`);
  parts.push(`${parts.length ? "keeps" : "Keeps"} ${percent(c.margin * 100)} of rewards`);
  parts.push(`${formatUnits(c.fixedCost, 6, 0)} ADA fixed fee`);
  parts.push(c.saturation < 1 ? "under 1% full" : `${percent(c.saturation, 0)} full`);
  return parts.join(" · ");
}

export interface CardanoStakingOptions {
  module?: CardanoModule;
  /** Waiting for the vote delegation to land before withdrawing: poll interval and limit (ms). */
  pollMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class CardanoStaking implements StakingProvider {
  readonly family = "cardano" as const;
  readonly assetKey = "ada";
  readonly wholeBalance = true;
  readonly howItWorks =
    "Your ADA stays in your wallet and you can spend it any time. You pick a stake pool and your whole balance earns with it. Starting needs a 2 ADA deposit that comes back when you stop. Rewards start after about 15 to 20 days, then arrive every few days.";

  private readonly module: CardanoModule;
  private cache = new Map<string, { at: number; list: PoolChoice[] }>();

  constructor(private readonly opts: CardanoStakingOptions = {}) {
    this.module = opts.module ?? createCardanoModule();
  }

  supports(network: Network): boolean {
    return network.family === "cardano" && !!(network.indexerUrl ?? network.rpcUrls[0]);
  }

  private koios(ctx: ChainContext): Koios {
    const url = ctx.network.indexerUrl ?? ctx.network.rpcUrls[0];
    if (!url) throw new ClipError("Staking isn't available right now.", "staking/no-rpc");
    return new Koios(url, ctx.fetch);
  }

  async pools(ctx: ChainContext): Promise<PoolChoice[]> {
    const hit = this.cache.get(ctx.network.id);
    if (hit && Date.now() - hit.at < OPTIONS_TTL_MS) return hit.list;
    const koios = this.koios(ctx);
    const list = await koios.poolList(0.1);
    const tickers = new Map(list.filter((p) => p.ticker).map((p) => [p.pool_id_bech32, p.ticker!] as const));
    const [info, epochs] = await Promise.all([koios.poolInfo(shortlist(list)), koios.epochRewards(1).catch(() => [])]);
    const ranked = rankPools(info, networkRate(epochs[0]), tickers);
    this.cache.set(ctx.network.id, { at: Date.now(), list: ranked });
    return ranked;
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const ranked = await this.pools(ctx);
    if (!ranked.length) throw new ClipError("No stake pool meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    return ranked.slice(0, 10).map((c, i) => {
      const v: StakeOptionView = { id: c.pool.pool_id_bech32, title: poolTitle(c), detail: poolDetail(c) };
      if (c.apy !== undefined) v.apy = c.apy;
      if (i === 0) v.recommended = true;
      return v;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.options(ctx).catch(() => []))[0];
    return best?.apy !== undefined ? `About ${percent(best.apy, 1)} a year` : undefined;
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const s = await this.module.getStaking(ctx);
    if (!s.registered) return [];
    const rewards = BigInt(s.rewardsAvailable || "0");
    let pool: KoiosPool | undefined;
    if (s.pool) pool = (await this.koios(ctx).poolInfo([s.pool.id]).catch(() => []))[0];
    const amount = s.totalBalance ?? "0";
    const v: StakePositionView = {
      id: s.rewardAddress,
      assetKey: "ada",
      symbol: "ADA",
      decimals: 6,
      amount,
      amountDisplay: ada(amount, 2),
      with: s.pool
        ? poolTitle({ ...(s.pool.ticker ? { ticker: s.pool.ticker } : {}), pool: { pool_id_bech32: s.pool.id, meta_json: s.pool.name ? { name: s.pool.name } : null } })
        : "No pool yet",
      status: "active",
      statusText: "Earning rewards",
      actions: ["change", "unstake"],
      networkId: ctx.network.id,
    };
    if (!s.pool) {
      v.status = "rewards-off";
      v.statusText = "Not earning. Pick a pool to start";
    } else if (pool?.pool_status === "retired") {
      v.status = "rewards-off";
      v.statusText = "Your pool closed. Pick another to keep earning";
    } else if (pool?.retiring_epoch != null || pool?.pool_status === "retiring") {
      v.statusText = "Your pool is closing soon. Pick another to keep earning";
    }
    if (rewards > 0n) {
      v.pendingReward = { amount: rewards.toString(), display: ada(rewards) };
      v.actions = ["change", "claim", "unstake"];
      if (!s.drep) v.claimChoices = CLAIM_CHOICES;
    }
    return [v];
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    let choice: PoolChoice | undefined;
    if (p.optionId) {
      const [info] = await this.koios(ctx).poolInfo([p.optionId]).catch(() => []);
      if (!info) throw new ClipError("That stake pool couldn't be found.", "staking/unknown-option");
      choice = rankPools([info])[0];
      if (!choice) throw new ClipError("That pool is closing, full or not meeting its promises, so Clip Wallet won't stake with it.", "staking/bad-option");
    } else {
      choice = (await this.pools(ctx))[0];
      if (!choice) throw new ClipError("No stake pool meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    }
    const staking = await this.module.getStaking(ctx);
    const request = await this.module.buildDelegate({ poolId: choice.pool.pool_id_bech32 }, ctx);
    const name = poolTitle(choice);
    const lines = [{ label: "With", value: name }];
    if (!staking.registered) lines.push({ label: "Deposit", value: "2 ADA, returned when you stop staking" });
    lines.push({ label: "Your ADA", value: "Stays in your wallet. Spend it any time" });
    return { steps: [{ title: staking.pool ? `Move your stake to ${name}` : `Stake your ADA with ${name}`, lines, request }] };
  }

  private async mine(ctx: ChainContext, positionId: string): Promise<StakingInfo> {
    const s = await this.module.getStaking(ctx);
    if (!s.registered || positionId !== s.rewardAddress) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    return s;
  }

  private drepChoice(choice: string | undefined): DrepChoice {
    if (choice === "abstain" || choice === "no-confidence") return choice;
    if (choice === undefined) throw new ClipError("Choose how your voting power counts first.", "staking/choice-needed");
    throw new ClipError("That choice isn't available.", "staking/bad-choice");
  }

  private voteStep(choice: DrepChoice, ctx: ChainContext, why: string): Step {
    const label = choice === "abstain" ? "Abstain from votes" : "No confidence";
    return {
      title: `Set your voting choice: ${label}`,
      lines: [{ label: "Why", value: why }],
      request: () => this.module.buildVoteDelegate({ drep: choice }, ctx),
    };
  }

  /** Waits until Koios shows the vote delegation (the withdrawal is judged on the ledger state before it). */
  private async waitForDrep(ctx: ChainContext): Promise<void> {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const step = this.opts.pollMs ?? 10_000;
    const max = this.opts.maxWaitMs ?? 6 * 60_000;
    for (let waited = 0; ; waited += step) {
      const s = await this.module.getStaking(ctx).catch(() => undefined);
      if (s?.drep) return;
      if (waited >= max) throw new ClipError("Cardano hasn't confirmed your voting choice yet. Try again in a few minutes.", "staking/not-confirmed");
      await sleep(step);
    }
  }

  async buildClaim(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const s = await this.mine(ctx, p.positionId);
    const rewards = BigInt(s.rewardsAvailable || "0");
    if (rewards <= 0n) throw new ClipError("There are no rewards to claim yet.", "staking/no-rewards");
    const claim: Step = {
      title: `Move ${ada(rewards)} rewards to your balance`,
      request: s.drep
        ? await this.module.buildWithdrawRewards(ctx)
        : async () => {
            await this.waitForDrep(ctx);
            return this.module.buildWithdrawRewards(ctx);
          },
    };
    if (s.drep) return { steps: [claim] };
    const choice = this.drepChoice(p.choice);
    return { steps: [this.voteStep(choice, ctx, "Cardano needs this choice before rewards can be taken out"), claim] };
  }

  async buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const s = await this.mine(ctx, p.positionId);
    const rewards = BigInt(s.rewardsAvailable || "0");
    const lines = [{ label: "Deposit back", value: ada(BigInt(s.deposit ?? "2000000")) }];
    if (rewards > 0n) lines.push({ label: "Rewards", value: `${ada(rewards)} move to your balance` });
    const stop: Step = { title: "Stop staking ADA", lines, request: () => this.module.buildDeregister(ctx) };
    if (rewards === 0n || s.drep) {
      stop.request = await this.module.buildDeregister(ctx);
      return { steps: [stop] };
    }
    // Rewards must leave in the same transaction, and that needs a vote delegation first.
    const choice = this.drepChoice(p.choice ?? "abstain");
    stop.request = async () => {
      await this.waitForDrep(ctx);
      return this.module.buildDeregister(ctx);
    };
    return { steps: [this.voteStep(choice, ctx, "Cardano needs this choice before your rewards can be paid out"), stop] };
  }
}
