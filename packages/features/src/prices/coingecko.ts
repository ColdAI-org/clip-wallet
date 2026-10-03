import { COINGECKO_IDS, PEGGED_USD, TESTNET_ALIASES } from "./ids.js";

/** The background's PriceFeed seam (apps/extension/src/background/wiring.ts): synchronous reads. */
export interface SyncPriceFeed {
  usd(assetKey: string): number | undefined;
  fx(currency: string): number;
}

export interface CoinGeckoOptions {
  fetch: typeof fetch;
  /** Default https://api.coingecko.com/api/v3 (keyless public API; IP-rate-limited). */
  baseUrl?: string;
  /** Optional Demo key, sent as x-cg-demo-api-key. Never committed: read from build config. */
  demoApiKey?: string;
  /** How long a price is fresh (default 60 s). */
  ttlMs?: number;
  /** Minimum gap between requests (default 15 s); after a 429 the gap doubles up to 10 min. */
  minIntervalMs?: number;
  /** Map testnet keys to mainnet prices (default true, like the Phase 1 reference table). */
  testnetValues?: boolean;
  /** Persist last-known prices (survives a service-worker restart). */
  store?: { get<T>(k: string): Promise<T | undefined>; set<T>(k: string, v: T): Promise<void> };
  extraIds?: Record<string, string>;
  now?: () => number;
}

const FIAT = ["usd", "eur", "gbp", "chf", "jpy", "cad", "aud"] as const;
const STORE_KEY = "clip/features/prices";

interface Snapshot {
  at: number;
  /** coingecko id → { usd, eur, … } */
  prices: Record<string, Record<string, number>>;
}

/**
 * CoinGecko `/simple/price` feed (https://docs.coingecko.com/reference/simple-price).
 * - Reads are synchronous from the last snapshot (the background's `fiat()` is sync).
 * - `refresh()` fetches every mapped id in ONE request, at most every `minIntervalMs`.
 * - Failures keep the last known prices (fall back, never blank out balances).
 * - FX comes from the same response: fx(EUR) = price.eur / price.usd for a liquid reference coin.
 */
export class CoinGeckoPriceFeed implements SyncPriceFeed {
  private snap: Snapshot = { at: 0, prices: {} };
  private lastRequest = 0;
  private backoffMs: number;
  private inflight?: Promise<void>;
  private readonly ids: Record<string, string>;
  private readonly now: () => number;

  constructor(private readonly opts: CoinGeckoOptions) {
    this.ids = { ...COINGECKO_IDS, ...opts.extraIds };
    this.now = opts.now ?? Date.now;
    this.backoffMs = opts.minIntervalMs ?? 15_000;
  }

  /** Load the persisted snapshot (call once at startup). */
  async load(): Promise<void> {
    const s = await this.opts.store?.get<Snapshot>(STORE_KEY).catch(() => undefined);
    if (s && s.at > this.snap.at) this.snap = s;
  }

  idFor(assetKey: string): string | undefined {
    const k = assetKey.toLowerCase();
    if (this.ids[k]) return this.ids[k];
    if ((this.opts.testnetValues ?? true) && TESTNET_ALIASES[k]) return this.ids[TESTNET_ALIASES[k]!];
    return undefined;
  }

  usd(assetKey: string): number | undefined {
    if (PEGGED_USD.has(assetKey.toLowerCase())) return 1;
    const id = this.idFor(assetKey);
    if (!id) return undefined;
    const v = this.snap.prices[id]?.usd;
    if (v === undefined) {
      void this.refresh();
      return undefined;
    }
    if (this.now() - this.snap.at > (this.opts.ttlMs ?? 60_000)) void this.refresh();
    return v;
  }

  fx(currency: string): number {
    const c = currency.toLowerCase();
    if (c === "usd") return 1;
    for (const ref of ["usd-coin", "bitcoin", "ethereum"]) {
      const p = this.snap.prices[ref];
      if (p?.usd && p[c]) return p[c]! / p.usd;
    }
    return 1;
  }

  /** When prices were last fetched (0 = never). */
  get updatedAt(): number {
    return this.snap.at;
  }

  refresh(force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    const t = this.now();
    const fresh = t - this.snap.at < (this.opts.ttlMs ?? 60_000);
    if (!force && (fresh || t - this.lastRequest < this.backoffMs)) return Promise.resolve();
    this.lastRequest = t;
    this.inflight = this.fetchAll().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchAll(): Promise<void> {
    const ids = [...new Set(Object.values(this.ids))].sort();
    const base = (this.opts.baseUrl ?? "https://api.coingecko.com/api/v3").replace(/\/+$/, "");
    const url = `${base}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=${FIAT.join(",")}`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.opts.demoApiKey) headers["x-cg-demo-api-key"] = this.opts.demoApiKey;
    try {
      const res = await this.opts.fetch(url, { headers });
      if (res.status === 429) {
        this.backoffMs = Math.min(this.backoffMs * 2, 10 * 60_000);
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as Record<string, Record<string, number>>;
      const prices: Snapshot["prices"] = { ...this.snap.prices };
      for (const [id, p] of Object.entries(body)) if (p && typeof p.usd === "number") prices[id] = p;
      this.snap = { at: this.now(), prices };
      this.backoffMs = this.opts.minIntervalMs ?? 15_000;
      await this.opts.store?.set(STORE_KEY, this.snap).catch(() => undefined);
    } catch {
      // Offline or blocked: keep the last known prices.
    }
  }
}
