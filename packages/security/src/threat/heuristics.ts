import type { HistoryEntry, SecurityHost } from "../host.js";
import { fetchJson, shortAddress } from "../util.js";
import { normAddr } from "./lists.js";
import type { ProviderStatus, ThreatFinding, ThreatIntelProvider, TxCheckInput } from "./types.js";

/**
 * Local heuristics. Everything runs on the device from data the wallet already has; the only network read
 * is the new-contract check, which asks the network's Blockscout about the CONTRACT being called (never your
 * address) and is cached.
 *
 *  - Address poisoning: scammers send you a zero-value (or dust) transfer from an address that starts and
 *    ends like one you use, so it shows up in your history; later you copy the wrong one. We flag a recipient
 *    that (a) looks like a saved/used address but isn't it, or (b) has only ever appeared in zero-value
 *    transfers.
 *  - New contract: an app asking you to call a contract created in the last few days (caution).
 *  - Zero-value transfer spam: `zeroValueSuspects()` lets Activity hide these entries.
 */

const DAY = 86_400_000;

/** Shared leading and trailing characters (after "0x" for EVM), as people compare addresses by eye. */
export function lookalike(a: string, b: string): boolean {
  const x = normAddr(a).replace(/^0x/, "");
  const y = normAddr(b).replace(/^0x/, "");
  if (x === y || x.length < 20 || x.length !== y.length) return false;
  let pre = 0;
  while (pre < x.length && x[pre] === y[pre]) pre++;
  let suf = 0;
  while (suf < x.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  return pre >= 3 && suf >= 3 && pre + suf >= 7;
}

/** Addresses seen only in zero-value transfers: the fingerprint of a poisoning attempt. */
export function zeroValueSuspects(history: HistoryEntry[]): Set<string> {
  const real = new Set<string>();
  const zero = new Set<string>();
  for (const h of history) {
    const a = normAddr(h.counterparty);
    if (/^0+$/.test(h.amount)) zero.add(a);
    else real.add(a);
  }
  return new Set([...zero].filter((a) => !real.has(a)));
}

/** Activity entries to hide: zero-value transfers whose counterparty looks like an address you really use. */
export function isPoisoningEntry(entry: HistoryEntry, history: HistoryEntry[]): boolean {
  if (!/^0+$/.test(entry.amount)) return false;
  const used = history.filter((h) => h.direction === "out" && !/^0+$/.test(h.amount)).map((h) => h.counterparty);
  return zeroValueSuspects(history).has(normAddr(entry.counterparty)) && (used.length === 0 || used.some((u) => lookalike(u, entry.counterparty)));
}

export class LocalHeuristics implements ThreatIntelProvider {
  readonly id = "local";
  readonly name = "Look-alike and new-contract checks";
  readonly privacy = "Runs on your device using your own history. Only asks the explorer when a contract was created, never about you.";
  readonly sendsUserData = false;
  private readonly created = new Map<string, Promise<number | null>>();

  constructor(
    private readonly host: SecurityHost,
    private readonly newContractDays = 7,
  ) {}

  status(): ProviderStatus {
    return { enabled: true };
  }

  async checkTransaction(input: TxCheckInput): Promise<ThreatFinding[]> {
    const out: ThreatFinding[] = [];
    const [book, history] = await Promise.all([this.host.addressBook?.().catch(() => []) ?? [], this.host.history?.().catch(() => []) ?? []]);
    const sentTo = history.filter((h) => h.direction === "out" && !/^0+$/.test(h.amount)).map((h) => h.counterparty);
    const known = new Set([...book.map((b) => normAddr(b.address)), ...sentTo.map(normAddr)]);
    const suspects = zeroValueSuspects(history);

    for (const r of input.recipients) {
      const n = normAddr(r);
      if (known.has(n)) continue;
      const twin = [...book.map((b) => ({ address: b.address, name: b.name })), ...sentTo.map((a) => ({ address: a, name: undefined }))].find((k) => lookalike(k.address, r));
      if (twin) {
        out.push({
          level: "danger",
          code: "address-poisoning",
          source: this.id,
          message: `${shortAddress(r)} looks like ${twin.name ? `${twin.name} (${shortAddress(twin.address)})` : shortAddress(twin.address)}, which you've used before, but it's a different address. Scammers make look-alikes. Check every character.`,
        });
      } else if (suspects.has(n)) {
        out.push({
          level: "danger",
          code: "address-poisoning",
          source: this.id,
          message: `${shortAddress(r)} only appears in your history from a zero-value transfer. That's a common trick to get you to copy a scammer's address.`,
        });
      }
    }

    if (input.request.origin !== "wallet" && input.request.origin !== "clip-wallet" && input.network.family === "evm") {
      const to = (input.request.params as { to?: string }[] | undefined)?.[0]?.to;
      if (input.request.method === "eth_sendTransaction" && to) {
        const at = await this.createdAt(input, to);
        const now = this.host.now?.() ?? Date.now();
        if (at !== null && now - at < this.newContractDays * DAY) {
          const days = Math.max(0, Math.floor((now - at) / DAY));
          out.push({
            level: "caution",
            code: "new-recipient",
            source: this.id,
            message: `This app's contract was created ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}. New contracts are often scams. Only continue if you trust this app.`,
          });
        }
      }
    }
    return out;
  }

  /** Creation time of a contract from Blockscout v2 (`creation_transaction_hash`, then the tx `timestamp`). Null if unknown or not a contract. */
  private createdAt(input: TxCheckInput, contract: string): Promise<number | null> {
    const base = input.network.indexerUrl;
    if (!base || !/\/api\/v2\/?$/.test(base)) return Promise.resolve(null);
    const key = `${input.network.id}|${contract.toLowerCase()}`;
    let p = this.created.get(key);
    if (!p) {
      p = (async () => {
        try {
          const root = base.replace(/\/+$/, "");
          const a = await fetchJson<{ is_contract?: boolean; creation_transaction_hash?: string | null; creation_tx_hash?: string | null }>(
            this.host.fetch,
            `${root}/addresses/${contract}`,
            "the explorer",
            { timeoutMs: 4000 },
          );
          const hash = a.creation_transaction_hash ?? a.creation_tx_hash;
          if (!a.is_contract || !hash) return null;
          const tx = await fetchJson<{ timestamp?: string }>(this.host.fetch, `${root}/transactions/${hash}`, "the explorer", { timeoutMs: 4000 });
          const t = tx.timestamp ? Date.parse(tx.timestamp) : NaN;
          return Number.isFinite(t) ? t : null;
        } catch {
          this.created.delete(key);
          return null;
        }
      })();
      this.created.set(key, p);
    }
    return p;
  }
}
