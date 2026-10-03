import type { PendingStakingFamily } from "./types.js";

/**
 * Staking for families whose chain modules land in other Phase 2 streams. The StakingProvider interface is
 * fixed; each entry below says what fills it at integration. Until then the Stake screen shows the asset
 * as "coming soon" (plain words), never a network name.
 */
export const PENDING_STAKING: readonly PendingStakingFamily[] = [
  {
    family: "cardano",
    assetKey: "ada",
    plan: "Delegate to a stake pool: certificate (stake registration + delegation, Conway era) built by chains-cardano; options from a public pool list ranked by margin, pledge and saturation. Whole balance, nothing locked.",
  },
  {
    family: "substrate",
    assetKey: "dot",
    plan: "Nomination pools (pallet nominationPools: join / bondExtra / unbond / withdrawUnbonded / claimPayout) built by chains-substrate; options = open pools ranked by commission and member count. 28-day unbonding on Polkadot.",
  },
  {
    family: "near",
    assetKey: "near",
    plan: "Staking-pool contracts (deposit_and_stake / unstake_all / withdraw_all) built by chains-near; options from the validator set ranked by fee. Unstaked NEAR unlocks after 4 epochs.",
  },
  {
    family: "tezos",
    assetKey: "xtz",
    plan: "Delegation operation (and staking where the baker accepts it) built by chains-tezos; options = bakers ranked by fee and reliability. Whole balance, nothing locked for plain delegation.",
  },
];

export function pendingStakingFor(assetKey: string): PendingStakingFamily | undefined {
  return PENDING_STAKING.find((p) => p.assetKey === assetKey);
}
