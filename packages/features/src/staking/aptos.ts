import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import { MIN_DELEGATION_OCTAS, delegationPayload } from "@clip-wallet/chains-aptos";
import { fetchJson } from "../http.js";
import { formatUnits, percent, randomId, shortAddress } from "../util.js";
import type { StakeOptionView, StakePositionView } from "../views.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * Aptos delegated staking (0x1::delegation_pool), keyless reads only. Verified 2026-10-03 against testnet and mainnet:
 *  - pools: Aptos indexer GraphQL `current_delegated_staking_pool_balances { staking_pool_address total_coins
 *    operator_commission_percentage }` (anonymous), then views `0x1::stake::get_validator_state(pool)` (2 = active) and
 *    `0x1::delegation_pool::allowlisting_enabled(pool)` (allow-listed pools are skipped).
 *  - your pools: indexer `delegator_distinct_pool(where: { delegator_address })`; amounts: view
 *    `0x1::delegation_pool::get_stake(pool, you)` → [active, inactive, pending_inactive]; unlock time: view
 *    `0x1::stake::get_lockup_secs(pool)`.
 *  - yearly rate: `0x1::staking_config::StakingRewardsConfig.rewards_rate` (FixedPoint64, per epoch; falls back to
 *    `StakingConfig.rewards_rate / rewards_rate_denominator`) × epochs per year (`0x1::block::BlockResource.epoch_interval`, µs),
 *    minus the pool's commission (hundredths of a percent, MAX_FEE 10000 in delegation_pool.move).
 *  - lockup: `StakingConfig.recurring_lockup_duration_secs` (1,209,600 s = 14 days on both networks).
 * Transactions: `aptos:signAndSubmitTransaction` with the delegation_pool payload from chains-aptos `delegationPayload`;
 * chains-aptos builds, simulates and describes it ("Stake 10 APT").
 */

const APT = 8;
const MAX_FEE = 10_000;

export interface AptosPool {
  address: string;
  totalCoins: bigint;
  /** Hundredths of a percent (1200 = 12 %). */
  commission: number;
  apy?: number;
}

interface RewardsInfo {
  /** Per-epoch rate (fraction). */
  perEpoch?: number;
  epochSecs?: number;
  lockupSecs: number;
}

function rest(ctx: ChainContext): string {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("Staking isn't available right now.", "staking/no-rpc");
  return url.replace(/\/+$/, "");
}

function indexer(ctx: ChainContext): string {
  if (!ctx.network.indexerUrl) throw new ClipError("Staking isn't available right now.", "staking/no-indexer");
  return ctx.network.indexerUrl;
}

async function view<T extends unknown[]>(ctx: ChainContext, fn: string, args: unknown[], typeArgs: string[] = []): Promise<T> {
  return fetchJson<T>(ctx.fetch, `${rest(ctx)}/view`, "Aptos", { body: { function: fn, type_arguments: typeArgs, arguments: args } });
}

async function gql<T>(ctx: ChainContext, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetchJson<{ data?: T; errors?: { message: string }[] }>(ctx.fetch, indexer(ctx), "Aptos", { body: { query, variables } });
  if (!r.data || r.errors?.length) throw new ClipError("Aptos couldn't answer that right now. Try again in a moment.", "staking/aptos-indexer");
  return r.data;
}

function long(a: string): string {
  return `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

const Q_POOLS = /* GraphQL */ `query clipAptosPools($limit: Int!) {
  current_delegated_staking_pool_balances(limit: $limit, order_by: { total_coins: desc }) {
    staking_pool_address total_coins operator_commission_percentage
  }
}`;
const Q_MY_POOLS = /* GraphQL */ `query clipAptosMyPools($me: String!) {
  delegator_distinct_pool(where: { delegator_address: { _eq: $me } }) { pool_address }
}`;

/** Yearly rate in percent before commission. */
export function aptosBaseApy(perEpoch: number, epochSecs: number): number {
  return perEpoch * ((365 * 24 * 3600) / epochSecs) * 100;
}

/**
 * Rank: commission ≤ 10 % when any are, outside the biggest 10 % by stake (spreads stake), cheapest first, then bigger.
 * Pools under 1,000 APT are left out (often test or abandoned pools).
 */
export function rankAptosPools(pools: AptosPool[]): AptosPool[] {
  const sized = pools.filter((p) => p.totalCoins >= 100_000_000_000n);
  const bySize = [...sized].sort((a, b) => (b.totalCoins > a.totalCoins ? 1 : b.totalCoins < a.totalCoins ? -1 : 0));
  const tooBig = new Set(bySize.slice(0, Math.floor(bySize.length / 10)).map((p) => p.address));
  let pool = sized.filter((p) => !tooBig.has(p.address));
  const cheap = pool.filter((p) => p.commission <= 1000);
  if (cheap.length) pool = cheap;
  return pool.sort((a, b) => a.commission - b.commission || (b.totalCoins > a.totalCoins ? 1 : b.totalCoins < a.totalCoins ? -1 : 0));
}

function days(secs: number): string {
  const d = Math.max(1, Math.round(secs / 86_400));
  return d === 1 ? "about a day" : `about ${d} days`;
}

export class AptosStaking implements StakingProvider {
  readonly family = "aptos" as const;
  readonly assetKey = "apt";
  readonly wholeBalance = false;
  readonly howItWorks =
    "You add APT to a staking pool run by a validator (at least 10 APT). Rewards are added to your stake automatically. Unstaking unlocks at the end of the pool's 14-day lockup cycle, then you move it back to your balance.";

  supports(network: Network): boolean {
    return network.family === "aptos" && network.rpcUrls.length > 0 && !!network.indexerUrl;
  }

  private async rewards(ctx: ChainContext): Promise<RewardsInfo> {
    const base = rest(ctx);
    const res = <T>(type: string) => fetchJson<{ data: T }>(ctx.fetch, `${base}/accounts/0x1/resource/${type}`, "Aptos").then((r) => r.data);
    const cfg = await res<{ rewards_rate: string; rewards_rate_denominator: string; recurring_lockup_duration_secs: string }>("0x1::staking_config::StakingConfig");
    const out: RewardsInfo = { lockupSecs: Number(cfg.recurring_lockup_duration_secs) || 14 * 86_400 };
    const rc = await res<{ rewards_rate: { value: string } }>("0x1::staking_config::StakingRewardsConfig").catch(() => undefined);
    if (rc) out.perEpoch = Number((BigInt(rc.rewards_rate.value) * 1_000_000_000_000n) >> 64n) / 1e12;
    else if (Number(cfg.rewards_rate_denominator) > 0) out.perEpoch = Number(cfg.rewards_rate) / Number(cfg.rewards_rate_denominator);
    const block = await res<{ epoch_interval: string }>("0x1::block::BlockResource").catch(() => undefined);
    if (block) out.epochSecs = Number(block.epoch_interval) / 1e6;
    return out;
  }

  /** Active, open pools with an estimated yearly rate, best first. */
  async pools(ctx: ChainContext): Promise<{ ranked: AptosPool[]; info: RewardsInfo }> {
    const [r, info] = await Promise.all([
      gql<{ current_delegated_staking_pool_balances: { staking_pool_address: string; total_coins: number | string; operator_commission_percentage: number | string }[] }>(ctx, Q_POOLS, { limit: 60 }),
      this.rewards(ctx).catch((): RewardsInfo => ({ lockupSecs: 14 * 86_400 })),
    ]);
    const base = info.perEpoch !== undefined && info.epochSecs ? aptosBaseApy(info.perEpoch, info.epochSecs) : undefined;
    const all: AptosPool[] = r.current_delegated_staking_pool_balances.map((p) => {
      const pool: AptosPool = { address: long(p.staking_pool_address), totalCoins: BigInt(String(p.total_coins).split(".")[0] ?? "0"), commission: Number(p.operator_commission_percentage) };
      if (base !== undefined) pool.apy = base * (1 - pool.commission / MAX_FEE);
      return pool;
    });
    const candidates = rankAptosPools(all).slice(0, 15);
    const checked = await Promise.all(
      candidates.map(async (p) => {
        try {
          const [[state], [allowlisted]] = await Promise.all([
            view<[string]>(ctx, "0x1::stake::get_validator_state", [p.address]),
            view<[boolean]>(ctx, "0x1::delegation_pool::allowlisting_enabled", [p.address]),
          ]);
          return String(state) === "2" && !allowlisted ? p : null;
        } catch {
          return null;
        }
      }),
    );
    return { ranked: checked.filter((p): p is AptosPool => p !== null), info };
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const { ranked } = await this.pools(ctx);
    if (!ranked.length) throw new ClipError("No staking pool meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    return ranked.slice(0, 10).map((p, i) => {
      const o: StakeOptionView = {
        id: p.address,
        title: `Pool ${shortAddress(p.address)}`,
        detail: `${p.apy !== undefined ? `Earns about ${percent(p.apy)} a year · ` : ""}keeps ${percent(p.commission / 100)} of rewards · holds ${formatUnits(p.totalCoins, APT, 0)} APT`,
      };
      if (p.apy !== undefined) o.apy = p.apy;
      if (i === 0) o.recommended = true;
      return o;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.options(ctx).catch(() => []))[0];
    return best?.apy !== undefined ? `About ${percent(best.apy)} a year` : undefined;
  }

  private async stakeIn(ctx: ChainContext, pool: string): Promise<{ active: bigint; inactive: bigint; pendingInactive: bigint }> {
    const [a, i, p] = await view<[string, string, string]>(ctx, "0x1::delegation_pool::get_stake", [pool, long(ctx.account.address)]);
    return { active: BigInt(a), inactive: BigInt(i), pendingInactive: BigInt(p) };
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const me = long(ctx.account.address);
    const r = await gql<{ delegator_distinct_pool: { pool_address: string }[] }>(ctx, Q_MY_POOLS, { me });
    const pools = [...new Set(r.delegator_distinct_pool.map((p) => long(p.pool_address)))];
    const now = Math.floor(Date.now() / 1000);
    const out: StakePositionView[] = [];
    for (const pool of pools) {
      const s = await this.stakeIn(ctx, pool);
      const base = { assetKey: "apt", symbol: "APT", decimals: APT, with: `Pool ${shortAddress(pool)}`, networkId: ctx.network.id };
      const disp = (v: bigint) => `${formatUnits(v, APT, 4)} APT`;
      if (s.active > 0n) {
        out.push({ ...base, id: `${pool}:active`, amount: s.active.toString(), amountDisplay: disp(s.active), status: "active", statusText: "Earning rewards", actions: ["unstake"], partialUnstake: true });
      }
      if (s.pendingInactive > 0n) {
        const [lockup] = await view<[string]>(ctx, "0x1::stake::get_lockup_secs", [pool]).catch((): [string] => ["0"]);
        const left = Number(lockup) - now;
        out.push({
          ...base,
          id: `${pool}:unlocking`,
          amount: s.pendingInactive.toString(),
          amountDisplay: disp(s.pendingInactive),
          status: "deactivating",
          statusText: left > 0 ? `Unlocking. Ready in ${days(left)}` : "Unlocking. Ready soon",
          actions: [],
        });
      }
      if (s.inactive > 0n) {
        out.push({ ...base, id: `${pool}:withdrawable`, amount: s.inactive.toString(), amountDisplay: disp(s.inactive), status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"] });
      }
    }
    return out;
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    if (!p.amount || !/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much APT to stake.", "staking/bad-amount");
    const amount = BigInt(p.amount);
    if (amount < MIN_DELEGATION_OCTAS) throw new ClipError(`Stake at least ${formatUnits(MIN_DELEGATION_OCTAS, APT)} APT.`, "staking/below-minimum");
    const { ranked, info } = await this.pools(ctx);
    let pool: AptosPool | undefined;
    if (p.optionId) {
      const want = long(p.optionId);
      pool = ranked.find((x) => x.address === want);
      if (!pool) {
        // Not in the shortlist: accept any active, open delegation pool the user picked.
        const [[state], [allowlisted]] = await Promise.all([
          view<[string]>(ctx, "0x1::stake::get_validator_state", [want]),
          view<[boolean]>(ctx, "0x1::delegation_pool::allowlisting_enabled", [want]),
        ]).catch(() => [["0"], [true]] as [[string], [boolean]]);
        if (String(state) !== "2" || allowlisted) throw new ClipError("That pool isn't taking stake right now. Pick another one.", "staking/unknown-validator");
        const [commission] = await view<[string]>(ctx, "0x1::delegation_pool::operator_commission_percentage", [want]);
        pool = { address: want, totalCoins: 0n, commission: Number(commission) };
      }
    } else {
      pool = ranked[0];
      if (!pool) throw new ClipError("No staking pool meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    }
    const lines = [
      { label: "With", value: `Pool ${shortAddress(pool.address)} (keeps ${percent(pool.commission / 100)} of rewards)` },
      { label: "Lockup", value: `Unstaking takes up to ${days(info.lockupSecs)}` },
    ];
    const [fee] = await view<[string]>(ctx, "0x1::delegation_pool::get_add_stake_fee", [pool.address, amount.toString()]).catch((): [string] => ["0"]);
    if (BigInt(fee) > 0n) lines.push({ label: "Held back this epoch", value: `${formatUnits(BigInt(fee), APT, 8)} APT, added back to your stake when the epoch ends` });
    return { steps: [{ title: `Stake ${formatUnits(amount, APT)} APT`, request: this.request(delegationPayload("add_stake", pool.address, amount), ctx), lines }] };
  }

  private poolOf(positionId: string): string {
    const m = /^(0x[0-9a-f]{64}):(active|unlocking|withdrawable)$/.exec(positionId.toLowerCase());
    if (!m) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    return m[1]!;
  }

  async buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const pool = this.poolOf(p.positionId);
    const s = await this.stakeIn(ctx, pool);
    if (s.active <= 0n) throw new ClipError("There's nothing staked in that pool to unstake.", "staking/unknown-position");
    let amount = s.active;
    if (p.amount !== undefined) {
      if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much APT to unstake.", "staking/bad-amount");
      amount = BigInt(p.amount);
      if (amount > s.active) throw new ClipError(`You have ${formatUnits(s.active, APT, 4)} APT staked there.`, "staking/too-much");
    }
    const lines = [{ label: "Ready", value: "When the pool's lockup cycle ends (up to 14 days), then move it back to your balance" }];
    // delegation_pool.move moves everything when the rest would fall under 10 APT, and moves at least 10 APT.
    if (amount < s.active && s.active - amount < MIN_DELEGATION_OCTAS) lines.push({ label: "Note", value: "Less than 10 APT would stay staked, so all of it unstakes" });
    if (amount < MIN_DELEGATION_OCTAS && amount < s.active) lines.push({ label: "Note", value: "At least 10 APT unstakes at a time" });
    return { steps: [{ title: `Unstake ${formatUnits(amount, APT, 4)} APT`, request: this.request(delegationPayload("unlock", pool, amount), ctx), lines }] };
  }

  async buildWithdraw(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const pool = this.poolOf(p.positionId);
    const s = await this.stakeIn(ctx, pool);
    if (s.inactive <= 0n) throw new ClipError("This APT is still staked or unlocking. Try again once it's ready.", "staking/not-withdrawable");
    return { steps: [{ title: `Move ${formatUnits(s.inactive, APT, 4)} APT back to your balance`, request: this.request(delegationPayload("withdraw", pool, s.inactive), ctx) }] };
  }

  private request(payload: ReturnType<typeof delegationPayload>, ctx: ChainContext): DappRequest {
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "aptos",
      networkId: ctx.network.id,
      method: "aptos:signAndSubmitTransaction",
      params: { inputs: [{ account: long(ctx.account.address), payload }] },
    };
  }
}
