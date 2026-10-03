import type { PendingStakingFamily } from "./types.js";

/**
 * Staking for families whose provider isn't built yet: the Stake screen shows the asset as "coming soon"
 * (plain words), never a network name. Empty since Phase 2.5: Cardano, Polkadot, NEAR and Tezos (and Sui,
 * Aptos, TON) have real providers. Kept so a future family can be listed here before its provider lands.
 */
export const PENDING_STAKING: readonly PendingStakingFamily[] = [];

export function pendingStakingFor(assetKey: string): PendingStakingFamily | undefined {
  return PENDING_STAKING.find((p) => p.assetKey === assetKey);
}
