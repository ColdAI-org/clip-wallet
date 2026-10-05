import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN, msg, titled, say } from "@clip-wallet/core";
import { MIN_STAKE_MIST, STAKED_SUI_TYPE, SuiGraphQL, buildStakeTransaction, buildUnstakeTransaction, normalizeSuiAddress } from "@clip-wallet/chains-sui";
import { formatUnits, percent, randomId, shortAddress } from "../util.js";
import type { StakeOptionView, StakePositionView } from "../views.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * Sui native staking (0x3::sui_system), read over Sui GraphQL RPC (public fullnodes no longer serve JSON-RPC, so
 * suix_getLatestSuiSystemState / suix_getStakes / suix_getValidatorsApy are not used). Verified live 2026-10-03:
 *  - validators: `epoch { validatorSet { activeValidators { nodes { atRisk contents { json } } } } }`; the json is the
 *    Move `Validator` (metadata.name, metadata.sui_address, commission_rate in bps, staking_pool { id, sui_balance,
 *    exchange_rates.id }).
 *  - yearly rate: last finished epoch's `totalStakeRewards` / total stake × epochs per year, minus each validator's commission.
 *  - positions: the account's `0x3::staking_pool::StakedSui` objects ({ pool_id, stake_activation_epoch, principal }).
 *  - estimated rewards: the pool's exchange-rate table (`address(table).multiGetDynamicFields(keys: [{ literal: "<epoch>u64" }])`)
 *    at the activation epoch and now, as staking_pool.move `calculate_rewards` does.
 * Transactions are built in chains-sui (`buildStakeTransaction` / `buildUnstakeTransaction`) and resolved by its module.
 */

const SUI = 9;

export interface SuiValidator {
  address: string;
  name: string;
  /** Basis points (1200 = 12 %). */
  commissionBps: number;
  poolId: string;
  ratesTable: string;
  /** MIST staked in the pool. */
  stake: bigint;
  atRisk: number;
  apy?: number;
}

interface ValidatorJson {
  metadata?: { sui_address?: string; name?: string };
  commission_rate?: string | number;
  staking_pool?: { id?: string; sui_balance?: string | number; exchange_rates?: { id?: string } };
}

interface StakedJson {
  pool_id?: string;
  stake_activation_epoch?: string | number;
  principal?: string | number | { value?: string };
}

const Q_VALIDATORS = /* GraphQL */ `query clipSuiValidators($after: String) {
  epoch { epochId startTimestamp validatorSet { activeValidators(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor } nodes { atRisk contents { json } }
  } } }
}`;
const Q_EPOCH = /* GraphQL */ `query clipSuiEpoch($id: UInt53!) {
  epoch(epochId: $id) { epochId totalStakeRewards startTimestamp endTimestamp }
}`;
const Q_STAKES = /* GraphQL */ `query clipSuiStakes($owner: SuiAddress!, $after: String, $type: String) {
  address(address: $owner) { objects(first: 50, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor } nodes { address contents { json } }
  } }
}`;
const Q_RATES = /* GraphQL */ `query clipSuiRates($table: SuiAddress!, $keys: [DynamicFieldName!]!) {
  address(address: $table) { multiGetDynamicFields(keys: $keys) { value { ... on MoveValue { json } } } }
}`;
const Q_BALANCE = /* GraphQL */ `query clipSuiBalance($owner: SuiAddress!) {
  address(address: $owner) { balance(coinType: "0x2::sui::SUI") { totalBalance } }
}`;

function gql(ctx: ChainContext): SuiGraphQL {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("Staking isn't available right now.", "staking/no-rpc");
  return new SuiGraphQL(url, ctx.fetch);
}

async function q<T>(g: SuiGraphQL, query: string, vars: Record<string, unknown> = {}): Promise<T> {
  try {
    return await g.query<T>(query, vars);
  } catch (e) {
    if (e instanceof ClipError) throw e;
    throw new ClipError("Sui couldn't answer that right now. Try again in a moment.", "staking/sui-read-failed", e);
  }
}

function big(v: unknown): bigint {
  if (typeof v === "object" && v && "value" in v) return big((v as { value: unknown }).value);
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
}

/** One yearly rate in percent from a finished epoch: rewards / stake × epochs per year. */
export function suiBaseApy(rewards: bigint, totalStake: bigint, epochMs: number): number | undefined {
  if (totalStake <= 0n || rewards <= 0n || !(epochMs > 0)) return undefined;
  const perEpoch = Number((rewards * 1_000_000_000n) / totalStake) / 1e9;
  return perEpoch * ((365 * 24 * 3600 * 1000) / epochMs) * 100;
}

/** Rewards so far for a StakedSui (staking_pool.move calculate_rewards). Rates are { sui_amount, pool_token_amount }. */
export function suiRewards(principal: bigint, atStake: { sui: bigint; tokens: bigint }, now: { sui: bigint; tokens: bigint }): bigint {
  if (atStake.sui <= 0n || now.tokens <= 0n) return 0n;
  const tokens = atStake.tokens === 0n ? principal : (principal * atStake.tokens) / atStake.sui;
  const value = (tokens * now.sui) / now.tokens;
  return value > principal ? value - principal : 0n;
}

/** Rank: not at risk, commission ≤ 10 % when any are, outside the biggest 10 % by stake (spreads stake), cheapest first. */
export function rankSuiValidators(all: SuiValidator[]): SuiValidator[] {
  const healthy = all.filter((v) => v.atRisk === 0);
  const bySize = [...healthy].sort((a, b) => (b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0));
  const tooBig = new Set(bySize.slice(0, Math.floor(bySize.length / 10)).map((v) => v.address));
  let pool = healthy.filter((v) => !tooBig.has(v.address));
  const cheap = pool.filter((v) => v.commissionBps <= 1000);
  if (cheap.length) pool = cheap;
  return pool.sort((a, b) => a.commissionBps - b.commissionBps || (b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0));
}

export class SuiStaking implements StakingProvider {
  readonly family = "sui" as const;
  readonly assetKey = "sui";
  readonly wholeBalance = false;
  readonly howItWorks =
    "You stake an amount of SUI with a validator. It starts earning at the next epoch, in about a day, and rewards build up on your stake automatically. Unstake any time: your SUI and its rewards come straight back to your balance.";

  supports(network: Network): boolean {
    return network.family === "sui" && network.rpcUrls.length > 0;
  }

  /** Active validators with their estimated yearly rate, plus the current epoch. */
  async validators(ctx: ChainContext): Promise<{ epoch: number; validators: SuiValidator[] }> {
    const g = gql(ctx);
    const out: SuiValidator[] = [];
    let epoch = 0;
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r: {
        epoch: { epochId: number; validatorSet: { activeValidators: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { atRisk?: number | null; contents?: { json?: ValidatorJson } | null }[] } } | null } | null;
      } = await q(g, Q_VALIDATORS, { after });
      const set = r.epoch?.validatorSet?.activeValidators;
      if (!r.epoch || !set) break;
      epoch = Number(r.epoch.epochId);
      for (const n of set.nodes) {
        const j = n.contents?.json;
        const address = j?.metadata?.sui_address;
        const poolId = j?.staking_pool?.id;
        const ratesTable = j?.staking_pool?.exchange_rates?.id;
        if (!address || !poolId || !ratesTable) continue;
        out.push({
          address: normalizeSuiAddress(address),
          name: (j.metadata?.name ?? "").trim() || shortAddress(address),
          commissionBps: Number(j.commission_rate ?? 0),
          poolId: normalizeSuiAddress(poolId),
          ratesTable: normalizeSuiAddress(ratesTable),
          stake: big(j.staking_pool?.sui_balance),
          atRisk: Number(n.atRisk ?? 0),
        });
      }
      if (!set.pageInfo.hasNextPage) break;
      after = set.pageInfo.endCursor;
    }
    if (!out.length) throw new ClipError("Sui didn't list any validators right now. Try again later.", "staking/no-validators");
    const base = await this.baseApy(g, epoch, out).catch(() => undefined);
    if (base !== undefined) for (const v of out) v.apy = base * (1 - v.commissionBps / 10_000);
    return { epoch, validators: out };
  }

  private async baseApy(g: SuiGraphQL, epoch: number, validators: SuiValidator[]): Promise<number | undefined> {
    if (epoch < 1) return undefined;
    const r = await q<{ epoch: { totalStakeRewards?: string | null; startTimestamp?: string; endTimestamp?: string | null } | null }>(g, Q_EPOCH, { id: epoch - 1 });
    const e = r.epoch;
    if (!e?.totalStakeRewards || !e.startTimestamp || !e.endTimestamp) return undefined;
    const ms = Date.parse(e.endTimestamp) - Date.parse(e.startTimestamp);
    const total = validators.reduce((t, v) => t + v.stake, 0n);
    return suiBaseApy(BigInt(e.totalStakeRewards), total, ms);
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const ranked = rankSuiValidators((await this.validators(ctx)).validators);
    if (!ranked.length) throw new ClipError("No validator meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    return ranked.slice(0, 10).map((v, i) => {
      const o: StakeOptionView = {
        id: v.address,
        title: say("bg.staking.validator", { name: v.name }),
        detail: `${v.apy !== undefined ? `Earns about ${percent(v.apy)} a year · ` : ""}keeps ${percent(v.commissionBps / 100)} of rewards`,
      };
      if (v.apy !== undefined) o.apy = v.apy;
      if (i === 0) o.recommended = true;
      return o;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.options(ctx).catch(() => []))[0];
    return best?.apy !== undefined ? `About ${percent(best.apy)} a year` : undefined;
  }

  private async stakedObjects(ctx: ChainContext): Promise<{ id: string; poolId: string; activation: number; principal: bigint }[]> {
    const g = gql(ctx);
    const owner = normalizeSuiAddress(ctx.account.address);
    const out: { id: string; poolId: string; activation: number; principal: bigint }[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r: { address: { objects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { address: string; contents?: { json?: StakedJson } | null }[] } } | null } =
        await q(g, Q_STAKES, { owner, after, type: STAKED_SUI_TYPE });
      const objs = r.address?.objects;
      if (!objs) break;
      for (const n of objs.nodes) {
        const j = n.contents?.json ?? {};
        out.push({ id: normalizeSuiAddress(n.address), poolId: normalizeSuiAddress(String(j.pool_id ?? "0x0")), activation: Number(j.stake_activation_epoch ?? 0), principal: big(j.principal) });
      }
      if (!objs.pageInfo.hasNextPage) break;
      after = objs.pageInfo.endCursor;
    }
    return out;
  }

  private async rewardsFor(g: SuiGraphQL, table: string, activation: number, epoch: number, principal: bigint): Promise<bigint | undefined> {
    const r = await q<{ address: { multiGetDynamicFields: ({ value?: { json?: { sui_amount?: string; pool_token_amount?: string } } | null } | null)[] } | null }>(g, Q_RATES, {
      table,
      keys: [{ literal: `${activation}u64` }, { literal: `${epoch}u64` }, { literal: `${Math.max(0, epoch - 1)}u64` }],
    });
    const [at, now, prev] = (r.address?.multiGetDynamicFields ?? []).map((f) => f?.value?.json);
    const cur = now ?? prev;
    if (!at || !cur) return undefined;
    return suiRewards(principal, { sui: big(at.sui_amount), tokens: big(at.pool_token_amount) }, { sui: big(cur.sui_amount), tokens: big(cur.pool_token_amount) });
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const stakes = await this.stakedObjects(ctx);
    if (!stakes.length) return [];
    const { epoch, validators } = await this.validators(ctx);
    const byPool = new Map(validators.map((v) => [v.poolId, v]));
    const g = gql(ctx);
    return Promise.all(
      stakes.map(async (s) => {
        const v = byPool.get(s.poolId);
        const activating = s.activation > epoch;
        const p: StakePositionView = {
          id: s.id,
          assetKey: "sui",
          symbol: "SUI",
          decimals: SUI,
          amount: s.principal.toString(),
          amountDisplay: `${formatUnits(s.principal, SUI, 4)} SUI`,
          with: v ? say("bg.staking.validator", { name: v.name }) : "A validator that has left",
          status: activating ? "activating" : "active",
          statusText: activating ? "Starts earning in about a day" : v ? "Earning rewards" : "Not earning: unstake to get it back",
          actions: ["unstake"],
          networkId: ctx.network.id,
        };
        if (!activating && v) {
          const reward = await this.rewardsFor(g, v.ratesTable, s.activation, epoch, s.principal).catch(() => undefined);
          if (reward !== undefined && reward > 0n) p.pendingReward = { amount: reward.toString(), display: `${formatUnits(reward, SUI, 4)} SUI` };
        }
        return p;
      }),
    );
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    if (!p.amount || !/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much SUI to stake.", "staking/bad-amount");
    const amount = BigInt(p.amount);
    if (amount < MIN_STAKE_MIST) throw new ClipError(msg("bg.err.stakeAtLeast", { amount: `${formatUnits(MIN_STAKE_MIST, SUI)} SUI` }), "staking/below-minimum");
    const { validators } = await this.validators(ctx);
    let v: SuiValidator | undefined;
    if (p.optionId) {
      const want = normalizeSuiAddress(p.optionId);
      v = validators.find((x) => x.address === want);
      if (!v) throw new ClipError("That validator isn't taking stake right now. Pick another one.", "staking/unknown-validator");
    } else {
      v = rankSuiValidators(validators)[0];
      if (!v) throw new ClipError("No validator meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    }
    const bal = await q<{ address: { balance: { totalBalance: string } | null } | null }>(gql(ctx), Q_BALANCE, { owner: normalizeSuiAddress(ctx.account.address) });
    const balance = big(bal.address?.balance?.totalBalance);
    const feeBuffer = 10_000_000n; // 0.01 SUI, well above a staking transaction's gas
    if (amount + feeBuffer > balance) {
      throw new ClipError(`You need about ${formatUnits(amount + feeBuffer, SUI)} SUI for this, including the network fee.`, "staking/insufficient");
    }
    const transaction = await buildStakeTransaction({ sender: ctx.account.address, validator: v.address, amount });
    const lines = [
      { label: "With", value: say("bg.staking.validator", { name: v.name }) },
      { label: "Starts earning", value: "In about a day" },
    ];
    if (v.apy !== undefined) lines.push({ label: "Earns", value: `About ${percent(v.apy)} a year` });
    return { steps: [{ ...titled(msg("bg.req.stake", { amount: `${formatUnits(amount, SUI)} SUI` })), request: this.request(transaction, ctx), lines }] };
  }

  async buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    if (p.amount !== undefined) throw new ClipError("Sui unstakes a whole stake at a time.", "staking/partial-not-supported");
    const id = normalizeSuiAddress(p.positionId);
    const s = (await this.stakedObjects(ctx)).find((x) => x.id === id);
    if (!s) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    const transaction = await buildUnstakeTransaction({ sender: ctx.account.address, stakedSuiId: s.id });
    return {
      steps: [
        {
          ...titled(msg("bg.req.unstake", { amount: `${formatUnits(s.principal, SUI, 4)} SUI` })),
          request: this.request(transaction, ctx),
          lines: [{ label: "Back in your balance", value: "Right away, with its rewards" }],
        },
      ],
    };
  }

  private request(transaction: string, ctx: ChainContext): DappRequest {
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "sui",
      networkId: ctx.network.id,
      method: "sui:signAndExecuteTransaction",
      params: { inputs: [{ account: normalizeSuiAddress(ctx.account.address), transaction, chain: ctx.network.id }] },
    };
  }
}
