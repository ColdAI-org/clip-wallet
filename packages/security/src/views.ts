/**
 * What the security screens see. Plain JSON (no bigint, no classes) so it crosses the message bus.
 * Type-only module: `packages/ui` imports it as `@clip-wallet/security/views` without pulling in chain SDKs.
 * Speaks in assets and apps; `networkId` is for the network chip and Advanced mode only.
 */
import type { Family, NetworkId, Warning } from "@clip-wallet/core";

export interface Unavailable {
  code: string;
  message: string;
  /** The network's name, when the message is about one network (lets the UI say it in the user's language). */
  network?: string;
}

/* ------------------------------------------------------------------ standing permissions */

export type GrantKind =
  /** ERC-20 approve(spender, amount). */
  | "token-allowance"
  /** ERC-721 / ERC-1155 setApprovalForAll(operator, true). */
  | "nft-all"
  /** Uniswap Permit2 AllowanceTransfer allowance. */
  | "permit2"
  /** SPL Token / Token-2022 Approve (a delegate on one token account). */
  | "spl-delegate"
  /** Hedera CryptoApproveAllowance: HBAR. */
  | "hbar-allowance"
  /** Hedera CryptoApproveAllowance: a fungible HTS token. */
  | "hts-allowance"
  /** Hedera CryptoApproveAllowance: every serial of an NFT collection. */
  | "hts-nft-all";

export type GrantRiskCode = "unlimited" | "unknown-spender" | "old" | "unused" | "flagged-spender";

export interface GrantRisk {
  code: GrantRiskCode;
  /** "Can take all of it", "Unknown app", "Set 2 years ago", "Never used", "On a scam list". */
  label: string;
  level: "info" | "caution" | "danger";
}

export interface GrantView {
  /** Stable id, used to revoke. */
  id: string;
  kind: GrantKind;
  family: Family;
  /** "Uniswap can spend all your USDC". */
  title: string;
  asset: { symbol: string; name: string; address?: string };
  spender: { address: string; name?: string; known: boolean };
  /** "All your USDC", "Up to 100 USDC", "Every NFT in Pudgy Penguins". */
  amount: string;
  /** The limit as a number ("100"), when not unlimited and not an NFT permission (for translated titles). */
  limit?: string;
  unlimited: boolean;
  grantedAt?: number;
  /** Permit2 allowances expire on their own. */
  expiresAt?: number;
  risks: GrantRisk[];
  /** Highest risk, for sorting and the badge. */
  riskLevel: "high" | "medium" | "low";
  networkId: NetworkId;
}

export interface ApprovalsOverviewView {
  grants: GrantView[];
  /** Plain notes: "Aptos and Sui don't have spending permissions to remove." */
  notes: string[];
  /** Same notes as stable codes ("no-permissions:aptos", "not-yet:starknet"), in the same order. */
  noteCodes?: string[];
  /** Networks we couldn't fully check, in plain words. */
  partial: Unavailable[];
  scannedAt: number;
}

/* ------------------------------------------------------------------ scam protection */

export interface ThreatProviderStatusView {
  id: string;
  name: string;
  /** "Downloads the list. Nothing about you is sent." / "Sends the site, the transaction and your address to Blockaid." */
  privacy: string;
  sendsUserData: boolean;
  enabled: boolean;
  /** When a list was last refreshed. */
  updatedAt?: number;
  /** Entries loaded (lists). */
  entries?: number;
  unavailable?: Unavailable;
}

export interface SiteCheckView {
  origin: string;
  warnings: Warning[];
  safe: boolean;
}

/* ------------------------------------------------------------------ cleanup */

export type CleanupAction =
  /** Solana: close an empty token account and get its deposit back. */
  | "close"
  /** Solana: destroy the spam tokens / NFT in it, then close it and get its deposit back. */
  | "burn-close"
  /** Hedera: remove the token from your account (frees an association slot). */
  | "dissociate"
  /** Hide from your wallet. Nothing happens on the network. */
  | "hide";

/** Why a cleanup item is listed (CleanupItemView.reasonCode). */
export type CleanupReason =
  | "empty-account"
  | "spam-locked"
  | "spam-burn"
  | "spam-gone"
  | "unused-token"
  | "spam-deleted"
  | "spam-held-hedera"
  | "spam-hide"
  | "spam-nft-hide";

export interface CleanupItemView {
  id: string;
  family: Family;
  kind: "token" | "nft";
  symbol: string;
  name: string;
  /** "0", "1,000,000 SCAM", "1 NFT". */
  balance: string;
  action: CleanupAction;
  /** Why it's listed and what the action does, in plain words. */
  reason: string;
  /** `reason` as a stable code (the UI translates it with `symbol` and `reclaim.display`). */
  reasonCode?: CleanupReason;
  spam: boolean;
  /** Ticked by default (spam and empty accounts are; anything else isn't). */
  preselected: boolean;
  /** Solana: lamports the close returns, and "≈0.002 SOL". */
  reclaim?: { amount: string; display: string };
  hidden?: boolean;
  networkId: NetworkId;
}

export interface CleanupOverviewView {
  items: CleanupItemView[];
  /** Per-family explanations ("On Ethereum and similar networks spam can only be hidden: …"). */
  notes: string[];
  /** Same notes as stable codes ("hide-only:evm", "hide-only:other"), in the same order. */
  noteCodes?: string[];
  partial: Unavailable[];
}

export interface CleanupSummaryView {
  /** "Get back ~0.0102 SOL". */
  headline: string;
  /** "Close 3 empty accounts", "Destroy and close 2 spam tokens", "Remove 4 unused tokens", "Hide 5 tokens". */
  lines: string[];
  /** How many confirmations you'll see. */
  approvals: number;
  /** What the chosen items do, counted per action (for translated lines). */
  counts?: Record<CleanupAction, number>;
  /** Total lamports returned. */
  reclaimLamports: string;
}

/** Result of a revoke or cleanup run. `queued` is absent when nothing needed an approval (hide only). */
export interface SecurityRunResult {
  queued?: { approvalId: string; steps: string[] };
  hidden: number;
}
