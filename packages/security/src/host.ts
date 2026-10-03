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
