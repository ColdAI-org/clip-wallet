import type { ChainContext, Family, Network } from "@clip-wallet/core";
import type { Step } from "../steps.js";
import type { StakeOptionView, StakePositionView } from "../views.js";

/**
 * One staking integration per family. Pure logic: reads public data and builds DappRequests that go through
 * the normal approval path (decode → approve → vault signs). Never touches keys.
 */
export interface StakingProvider {
  family: Family;
  /** Native coin's asset key ("hbar", "sol"). */
  assetKey: string;
  /** True when this provider can stake on that network (e.g. a cluster with an RPC). */
  supports(network: Network): boolean;
  /** Hedera stakes the whole balance in place; Solana stakes an amount into a stake account. */
  wholeBalance: boolean;
  /**
   * Amount may be left empty (Tezos: empty or 0 = delegate only, the whole balance counts and nothing is
   * locked; an amount = also stake that much).
   */
  amountOptional?: boolean;
  /** One-paragraph explanation in plain words. */
  howItWorks: string;

  positions(ctx: ChainContext): Promise<StakePositionView[]>;
  /** Where you can stake, best first; exactly one is `recommended`. */
  options(ctx: ChainContext): Promise<StakeOptionView[]>;
  /** "About 2.4% a year", if the network exposes enough to estimate it. */
  rewardRate?(ctx: ChainContext): Promise<string | undefined>;

  /** `amount` in base units (ignored when wholeBalance). `optionId` defaults to the recommended option. */
  buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild>;
  /**
   * `amount` (base units) is optional: partial unstake where the network allows it (Polkadot pools, NEAR);
   * absent means everything in that position.
   */
  buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild>;
  buildWithdraw?(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild>;
  /** `choice` is one of the position's `claimChoices` ids when it offers any (Cardano's vote delegation). */
  buildClaim?(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild>;
}

export interface StakeActionParams {
  positionId: string;
  /** Base units, decimal string. */
  amount?: string;
  choice?: string;
}

/** Requests to approve in order, each with the plain title the approval screen leads with. */
export interface StakeBuild {
  steps: Step[];
}

/** Families whose staking lands with other Phase 2 streams: interface fixed now, filled at integration. */
export interface PendingStakingFamily {
  family: Family;
  assetKey: string;
  /** What will be implemented and from which stream. */
  plan: string;
}
