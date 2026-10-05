import type { Family, Nft } from "@clip-wallet/core";
import type { FeatureHost } from "@clip-wallet/features";

/** One thing in your history, as far as security checks care. */
export interface HistoryEntry {
  family: Family;
  networkId: string;
  direction: "in" | "out";
  /** The other side of the transfer. */
  counterparty: string;
  /** Base units, decimal string. "0" for zero-value transfers. */
  amount: string;
  assetKey?: string;
  timestamp: number;
}

/**
 * What the security services need from the wallet background. It is the features host (approval path, chain
 * contexts, kv, fetch) plus a few optional reads. Nothing here exposes key material.
 */
export interface SecurityHost extends FeatureHost {
  /** Collectibles across networks (for spam NFT cleanup). */
  nfts?(): Promise<Nft[]>;
  /** Saved contacts (address book), any family. */
  addressBook?(): Promise<{ address: string; name?: string; family?: Family }[]>;
  /** Recent transfers in and out (activity), newest first. Used for look-alike checks, never sent anywhere. */
  history?(): Promise<HistoryEntry[]>;
}

/**
 * Switches and keys. Read from clip.config / build-time env by the background; never committed.
 */
export interface SecurityConfig {
  testnet: boolean;
  threat?: {
    /** Download the open phishing lists (default true). Only list files are downloaded; nothing about you is sent. */
    openLists?: boolean;
    /** Which open lists (default: all). */
    lists?: string[];
    /** Hours between list refreshes (default 24, ScamSniffer's update cadence). */
    refreshHours?: number;
    /**
     * Blockaid transaction and site scanning. OFF unless a key is set. When on, the site, the transaction and
     * YOUR ADDRESS are sent to api.blockaid.io for every request you review.
     */
    blockaid?: { apiKey: string; baseUrl?: string };
    /** A contract younger than this many days gets a caution (default 7). */
    newContractDays?: number;
  };
  approvals?: {
    /** eth_getLogs fallback (no Blockscout): how far back to look, in blocks (default 200 000). */
    lookbackBlocks?: number;
    /** eth_getLogs fallback: blocks per request (default 10 000; halves on "range too large"). */
    maxBlockRange?: number;
    /** Approvals older than this many days are flagged "old" (default 180). */
    oldAfterDays?: number;
  };
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = { testnet: true };

/** Longest gap between phishing-list refreshes a mainnet build may use, in hours. */
export const MAX_LIST_REFRESH_HOURS = 72;

/**
 * The security floor: what no mainnet build may switch off. The open phishing lists stay on, all of them, refreshed
 * at least every three days; new-contract cautions stay on. Returns the problems in plain words (empty = fine).
 * Test networks may relax them (tests and fixture builds do).
 */
export function securityFloorProblems(config: SecurityConfig): string[] {
  if (config.testnet) return [];
  const t = config.threat ?? {};
  const out: string[] = [];
  if (t.openLists === false) out.push("threat.openLists: the open phishing lists can't be switched off on mainnet");
  if (t.lists) out.push("threat.lists: a mainnet build uses every open phishing list; remove the list filter");
  if (t.refreshHours !== undefined && !(t.refreshHours > 0 && t.refreshHours <= MAX_LIST_REFRESH_HOURS)) {
    out.push(`threat.refreshHours: refresh the phishing lists at least every ${MAX_LIST_REFRESH_HOURS} hours`);
  }
  if (t.newContractDays !== undefined && !(t.newContractDays >= 1)) out.push("threat.newContractDays: new-contract cautions can't be switched off on mainnet");
  return out;
}

/** Throws when `config` goes below the security floor (securityFloorProblems). */
export function assertSecurityFloor(config: SecurityConfig): void {
  const problems = securityFloorProblems(config);
  if (problems.length) throw new Error(`Security can't be switched off:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}
