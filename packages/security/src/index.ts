/**
 * @clip-wallet/security — the Phantom/MetaMask security gaps: a permission (approval) revoker, scam
 * detection (open lists, optional Blockaid, local heuristics) and spam cleanup. Pure logic, no keys:
 * every action is a DappRequest on the normal approval path.
 *
 * @module
 */
export * from "./views.js";
export * from "./host.js";
export * from "./messages.js";
export { SecurityService } from "./background.js";
export { ApprovalsService } from "./approvals/service.js";
export { EvmApprovals, PERMIT2, PERMIT2_ABI, TOPIC, pairsFromLogs, verifyLockdown, type RawLog } from "./approvals/evm.js";
export { SolanaApprovals } from "./approvals/solana.js";
export { HederaApprovals } from "./approvals/hedera.js";
export { type ApprovalScanner, type Grant, type RevokeSpec, risksFor } from "./approvals/types.js";
export { CleanupService, HIDE_NOTE, hideKey } from "./cleanup/service.js";
export { ThreatIntel, addressesOf } from "./threat/service.js";
export { LIST_SOURCES, ListProvider, Matcher, distance, type CompactList, type ListSource } from "./threat/lists.js";
export { BlockaidProvider } from "./threat/blockaid.js";
export { LocalHeuristics, isPoisoningEntry, lookalike, zeroValueSuspects } from "./threat/heuristics.js";
export type { ThreatCode, ThreatFinding, ThreatIntelProvider, TxCheckInput, ProviderStatus } from "./threat/types.js";
export { spenderName, EVM_SPENDERS } from "./labels.js";
export { RecipientLog } from "./history.js";
