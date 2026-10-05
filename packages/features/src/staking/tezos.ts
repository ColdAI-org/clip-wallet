import { type ChainContext, ClipError, type DappRequest, type Network, msg, titled, say } from "@clip-wallet/core";
import { type StakePosition, type TezosModule, rpcFor, tezosModule, tzktFor } from "@clip-wallet/chains-tezos";
import type { StakeOptionView, StakePositionView } from "../views.js";
import { formatUnits, percent, shortAddress } from "../util.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * Tezos (protocol Ushuaia, PsUshuai9…, live on mainnet and shadownet on 2026-10-03), two ways to earn
 * (octez docs, "Staking mechanism"):
 *  - Delegation: a `delegation` operation. Nothing is locked or moved; the baker's rights grow by your whole balance.
 *    The protocol pays those rewards to the baker; bakers share them with delegators off-chain, at their discretion.
 *  - Staking: pseudo-operations (transactions to yourself with entrypoint stake / unstake / finalize_unstake). Needs a
 *    delegate that accepts external stake (limit_of_staking_over_baking > 0). Rewards are paid by the protocol,
 *    minus the baker's edge (edge_of_baking_over_staking, billionths). Staked tez weigh 3× delegated tez.
 *    Unstaked XTZ is finalizable after unstake_finalization_delay + 1 = 4 cycles; a cycle is 14 400 blocks × 6 s =
 *    1 day on both networks (GET …/context/constants on 2026-10-03).
 *
 * UX: one amount field. 0 = only delegate (whole balance, nothing locked); more than 0 = delegate if needed, then
 * stake that amount. Builders are chains-tezos `module.staking` (tezos_send DappRequests on the normal approval path).
 *
 * Reads (keyless): TzKT /v1/delegates (baker list), /v1/statistics/current (supply, baking power),
 * node RPC …/context/issuance/current_yearly_rate (issuance in % of supply per year).
 */
export const UNSTAKE_DAYS = 4;
const MAX_OPTIONS = 20;
/** limit_of_delegation_over_baking (constants, both networks): delegated XTZ beyond 9 × the baker's own stake earns nothing. */
const DELEGATION_OVER_BAKING = 9n;
/** A baker that hasn't done anything for this long is likely offline. */
const STALE_MS = 2 * 24 * 3600_000;

export interface TzktBaker {
  address: string;
  alias?: string | null;
  active?: boolean;
  stakedBalance?: number;
  externalStakedBalance?: number;
  ownDelegatedBalance?: number;
  externalDelegatedBalance?: number;
  /** Millionths. */
  limitOfStakingOverBaking?: number | null;
  /** Billionths. */
  edgeOfBakingOverStaking?: number | null;
  bakingPower?: number;
  stakersCount?: number;
  numDelegators?: number;
  lastActivityTime?: string;
}

const BAKER_FIELDS =
  "address,alias,active,stakedBalance,externalStakedBalance,ownDelegatedBalance,externalDelegatedBalance,limitOfStakingOverBaking,edgeOfBakingOverStaking,bakingPower,stakersCount,numDelegators,lastActivityTime";

export interface BakerChoice {
  baker: TzktBaker;
  name: string;
  acceptsStaking: boolean;
  /** Share of staking rewards the baker keeps (0..1). */
  edge: number;
  /** Mutez of external stake the baker can still take. */
  room: bigint;
  overDelegated: boolean;
  /** Yearly % for staked XTZ (after the edge), when the network rate is known. */
  stakeApy?: number;
}

const big = (v: number | null | undefined) => BigInt(Math.max(0, Math.floor(v ?? 0)));

export function bakerChoice(b: TzktBaker, baseApy?: number): BakerChoice {
  const own = big(b.stakedBalance);
  const limit = big(b.limitOfStakingOverBaking);
  const edgeRaw = b.edgeOfBakingOverStaking;
  const edge = edgeRaw == null ? 1 : Math.min(1, Math.max(0, edgeRaw / 1e9));
  const acceptsStaking = limit > 0n && edge < 1;
  const cap = (own * limit) / 1_000_000n;
  const ext = big(b.externalStakedBalance);
  const room = acceptsStaking && cap > ext ? cap - ext : 0n;
  const delegated = big(b.ownDelegatedBalance) + big(b.externalDelegatedBalance);
  const c: BakerChoice = {
    baker: b,
    name: b.alias?.trim() || `Baker ${shortAddress(b.address)}`,
    acceptsStaking,
    edge,
    room,
    overDelegated: delegated > own * DELEGATION_OVER_BAKING,
  };
  if (baseApy !== undefined && acceptsStaking) c.stakeApy = baseApy * (1 - edge);
  return c;
}

/**
 * Best first: accepts staking with room left, not over-delegated, lowest edge, most room, biggest baking power.
 * Bakers inactive in the protocol or silent for 2 days are dropped.
 */
export function rankBakers(list: TzktBaker[], now: number, baseApy?: number): BakerChoice[] {
  const fresh = list.filter((b) => b.active !== false && (!b.lastActivityTime || now - Date.parse(b.lastActivityTime) < STALE_MS));
  const score = (c: BakerChoice) => (c.acceptsStaking && c.room > 0n ? 0 : 2) + (c.overDelegated ? 1 : 0);
  return fresh
    .map((b) => bakerChoice(b, baseApy))
    .sort((a, b) => score(a) - score(b) || a.edge - b.edge || (b.room > a.room ? 1 : b.room < a.room ? -1 : 0) || (b.baker.bakingPower ?? 0) - (a.baker.bakingPower ?? 0));
}

const xtz = (mutez: bigint | string, max = 6) => `${formatUnits(mutez, 6, max)} XTZ`;

function daysUntil(iso: string | undefined, now: number): string {
  if (!iso) return `about ${UNSTAKE_DAYS} days`;
  const d = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  if (!Number.isFinite(d) || d <= 1) return "about a day";
  return `about ${d} days`;
}

type Kind = "delegated" | "staked" | "unstaking" | "withdrawable";
const positionId = (kind: Kind, baker: string) => `${kind}:${baker}`;
function parsePositionId(id: string): { kind: Kind; baker: string } {
  const m = /^(delegated|staked|unstaking|withdrawable):(tz[1-4][1-9A-HJ-NP-Za-km-z]{33})$/.exec(id);
  if (!m) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
  return { kind: m[1] as Kind, baker: m[2]! };
}

export class TezosStaking implements StakingProvider {
  readonly family = "tezos" as const;
  readonly assetKey = "xtz";
  readonly wholeBalance = false;
  readonly amountOptional = true;
  readonly howItWorks =
    "Pick a baker. Leave the amount empty (or 0) to only delegate: your whole XTZ balance counts with that baker, nothing is locked and you can spend it any time; the baker pays out delegation rewards (most do, but it's their choice). Stake an amount to earn more, paid automatically by the network. Staked XTZ is locked: unstaking takes about 4 days, then you move it back to your balance.";

  constructor(
    private readonly opts: { module?: Pick<TezosModule, "staking">; now?: () => number } = {},
  ) {}

  private get m(): Pick<TezosModule, "staking"> {
    return this.opts.module ?? tezosModule;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  supports(network: Network): boolean {
    return network.family === "tezos" && network.rpcUrls.length > 0 && !!network.indexerUrl;
  }

  /**
   * Yearly % earned per unit of baking power: issuance rate × total supply / total baking power. Staked XTZ earns
   * this (minus the edge); delegated XTZ a third of it, paid to the baker.
   */
  async baseApy(ctx: ChainContext): Promise<number | undefined> {
    try {
      const [rate, stats] = await Promise.all([
        rpcFor(ctx).get<string>("/chains/main/blocks/head/context/issuance/current_yearly_rate"),
        tzktFor(ctx).get<{ totalSupply?: number; totalBakingPower?: number } | null>("/v1/statistics/current"),
      ]);
      const r = Number(rate);
      if (!Number.isFinite(r) || r <= 0 || !stats?.totalSupply || !stats.totalBakingPower) return undefined;
      return (r * stats.totalSupply) / stats.totalBakingPower;
    } catch {
      return undefined;
    }
  }

  async bakers(ctx: ChainContext): Promise<BakerChoice[]> {
    const [list, base] = await Promise.all([
      tzktFor(ctx).get<TzktBaker[]>(`/v1/delegates?active=true&sort.desc=bakingPower&limit=300&select=${BAKER_FIELDS}`),
      this.baseApy(ctx),
    ]);
    return rankBakers(list ?? [], this.now(), base);
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const ranked = (await this.bakers(ctx)).slice(0, MAX_OPTIONS);
    if (!ranked.length) throw new ClipError("No baker is available right now. Try again later.", "staking/no-bakers");
    return ranked.map((c, i) => {
      const parts: string[] = [];
      if (c.acceptsStaking) {
        if (c.stakeApy !== undefined) parts.push(say("bg.staking.stakingEarnsAbout", { percent: percent(c.stakeApy) }));
        parts.push(`keeps ${percent(c.edge * 100, 0)} of staking rewards`);
        parts.push(c.room > 0n ? `room to stake ${xtz(c.room, 0)}` : "full for staking, delegation only");
      } else {
        parts.push("Delegation only (doesn't accept staking)");
      }
      if (c.overDelegated) parts.push("busy, delegation rewards may be lower");
      const v: StakeOptionView = { id: c.baker.address, title: c.name, detail: parts.join(" · ") };
      if (c.stakeApy !== undefined && c.room > 0n) v.apy = c.stakeApy;
      if (i === 0) v.recommended = true;
      return v;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.bakers(ctx).catch(() => [])).find((c) => c.stakeApy !== undefined && c.room > 0n);
    return best?.stakeApy !== undefined ? `About ${percent(best.stakeApy)} a year when staked` : undefined;
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const raw = await this.m.staking.getPositions(ctx);
    const now = this.now();
    const out: StakePositionView[] = [];
    const view = (p: StakePosition, kind: Kind, amount: string, rest: Pick<StakePositionView, "status" | "statusText" | "actions"> & { partialUnstake?: boolean }): StakePositionView => ({
      id: positionId(kind, p.validator),
      assetKey: "xtz",
      symbol: "XTZ",
      decimals: 6,
      amount,
      amountDisplay: xtz(amount, 4),
      with: p.validatorName ?? `Baker ${shortAddress(p.validator)}`,
      networkId: ctx.network.id,
      ...rest,
    });
    for (const p of raw) {
      if (p.delegated !== undefined) {
        out.push(view(p, "delegated", p.delegated, { status: "active", statusText: "Delegated: still spendable, the baker pays out rewards", actions: ["change", "unstake"] }));
      }
      if (BigInt(p.staked) > 0n) {
        out.push(view(p, "staked", p.staked, { status: "active", statusText: "Staked: earning rewards", actions: ["unstake"], partialUnstake: true }));
      }
      if (p.unstaking && BigInt(p.unstaking) > 0n) {
        out.push(view(p, "unstaking", p.unstaking, { status: "deactivating", statusText: `Unlocking. Ready in ${daysUntil(p.withdrawableAt, now)}`, actions: [] }));
      }
      if (p.withdrawable && BigInt(p.withdrawable) > 0n) {
        out.push(view(p, "withdrawable", p.withdrawable, { status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"] }));
      }
    }
    return out;
  }

  private async baker(ctx: ChainContext, address: string): Promise<BakerChoice> {
    const b = await tzktFor(ctx)
      .get<TzktBaker | null>(`/v1/delegates/${address}`)
      .catch(() => null);
    if (!b || b.active === false) throw new ClipError("That baker isn't available any more. Pick another.", "staking/unknown-option");
    return bakerChoice(b);
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    const raw = p.amount ?? "0";
    if (!/^\d+$/.test(raw)) throw new ClipError("Enter how much XTZ to stake, or 0 to only delegate.", "staking/bad-amount");
    const amount = BigInt(raw);
    let address = p.optionId;
    if (!address) address = (await this.bakers(ctx))[0]?.baker.address;
    if (!address) throw new ClipError("No baker is available right now. Try again later.", "staking/no-bakers");
    const c = await this.baker(ctx, address);
    if (amount > 0n) {
      if (!c.acceptsStaking) {
        throw new ClipError(`${c.name} doesn't accept staking. Pick another baker, or enter 0 to only delegate.`, "staking/baker-refuses-staking");
      }
      if (amount > c.room) {
        throw new ClipError(
          c.room > 0n ? `${c.name} has room for only ${xtz(c.room, 0)} more staked XTZ. Stake less or pick another baker.` : `${c.name} is full for staking. Pick another baker, or enter 0 to only delegate.`,
          "staking/baker-full",
        );
      }
    }
    const request = await this.m.staking.buildStake({ validator: address, amount: amount.toString() }, ctx);
    const lines = [{ label: "With", value: c.name }];
    if (amount > 0n) {
      lines.push({ label: "Baker keeps", value: `${percent(c.edge * 100, 0)} of staking rewards` });
      lines.push({ label: "Unstaking", value: `Takes about ${UNSTAKE_DAYS} days` });
      return { steps: [{ ...titled(msg("bg.req.stake", { amount: xtz(amount) })), request, lines }] };
    }
    lines.push({ label: "Your XTZ", value: "Stays in your account and spendable" });
    return { steps: [{ title: say("bg.tezos.delegateXtzTo", { name: c.name }), request, lines }] };
  }

  private async position(ctx: ChainContext, id: string): Promise<{ kind: Kind; baker: string; p: StakePosition }> {
    const { kind, baker } = parsePositionId(id);
    const p = (await this.m.staking.getPositions(ctx)).find((x) => x.validator === baker);
    if (!p) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    return { kind, baker, p };
  }

  async buildUnstake(a: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const { kind, baker, p } = await this.position(ctx, a.positionId);
    if (kind === "delegated") {
      const request: DappRequest = await this.m.staking.buildStopDelegating(ctx);
      return { steps: [{ title: "Stop delegating your XTZ", request, lines: [{ label: "From", value: p.validatorName ?? shortAddress(baker) }] }] };
    }
    if (kind !== "staked") throw new ClipError("This XTZ is already unstaking.", "staking/not-applicable");
    const staked = BigInt(p.staked);
    if (staked <= 0n) throw new ClipError("Nothing is staked with this baker any more.", "staking/unknown-position");
    const amount = a.amount !== undefined ? BigInt(a.amount) : staked;
    if (amount <= 0n) throw new ClipError("Enter how much XTZ to unstake.", "staking/bad-amount");
    if (amount > staked) throw new ClipError(`You have ${xtz(staked)} staked. Unstake that much or less.`, "staking/too-much");
    const request = await this.m.staking.buildUnstake({ validator: baker, amount: amount.toString() }, ctx);
    return {
      steps: [{ ...titled(msg("bg.req.unstake", { amount: xtz(amount) })), request, lines: [{ label: "Ready", value: `In about ${UNSTAKE_DAYS} days, then move it back to your balance` }] }],
    };
  }

  async buildWithdraw(a: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    const { kind, baker, p } = await this.position(ctx, a.positionId);
    const ready = BigInt(p.withdrawable ?? "0");
    if (kind !== "withdrawable" || ready <= 0n) throw new ClipError("This XTZ isn't ready yet. Try again once it's unlocked.", "staking/not-withdrawable");
    const request = await this.m.staking.buildWithdraw({ validator: baker }, ctx);
    return { steps: [{ ...titled(msg("bg.req.moveBack", { amount: xtz(ready, 4) })), request }] };
  }
}
