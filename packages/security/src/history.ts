import type { FeatureHost } from "@clip-wallet/features";
import type { HistoryEntry } from "./host.js";

const KEY = "security/sent-to";
const MAX = 500;

/**
 * The wallet's Activity doesn't keep counterparties, so the look-alike check needs its own small record of
 * who you've sent to. Stored on this device only (kv), newest first, capped at 500 entries. The background
 * calls `record` when a send is approved and went through; `SecurityHost.history` returns `list()` (plus any
 * indexer-fed inbound transfers the host has).
 */
export class RecipientLog {
  constructor(private readonly kv: FeatureHost["kv"]) {}

  async list(): Promise<HistoryEntry[]> {
    return (await this.kv.get<HistoryEntry[]>(KEY)) ?? [];
  }

  async record(e: Omit<HistoryEntry, "direction"> & { direction?: HistoryEntry["direction"] }): Promise<void> {
    const all = await this.list();
    all.unshift({ direction: "out", ...e });
    await this.kv.set(KEY, all.slice(0, MAX));
  }
}
