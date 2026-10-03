/**
 * Discover: what's moving, from keyless public APIs, limited to the networks this wallet has and with scams
 * filtered out. Every item carries a Swap target.
 *
 *  - Trending: CoinGecko GET /search/trending (https://docs.coingecko.com/reference/trending-search; keyless
 *    public API), enriched with each coin's asset platforms from GET /coins/{id}
 *    (https://docs.coingecko.com/reference/coins-id) so it can be limited to supported networks. Platforms are
 *    cached for a week; at most MAX_ENRICH coins are looked up per refresh.
 *  - New tokens: DEX Screener GET /token-profiles/latest/v1, priced with GET /tokens/v1/{chainId}/{addresses}
 *  - Top pools: DEX Screener GET /token-pairs/v1/{chainId}/{wrapped native} by 24 h volume
 *    (https://docs.dexscreener.com/api/reference; 60 req/min for profiles, 300 req/min for pairs/tokens).
 *
 * Results are cached (DISCOVER_TTL_MS) so opening Explore repeatedly doesn't hit the APIs.
 */
import type { AssetRef, Network } from "@clip-wallet/core";
import type { KVLike } from "../contacts/store.js";
import { DISCOVER_CHAINS, mainnetNetworkId, supportedChains, type DiscoverChain } from "./chains.js";
import { verdictOf, type TokenRef, type TokenRiskSource } from "./risk.js";

export interface DiscoverToken {
  /** "cg:<id>" or "dex:<chain>:<address>". */
  id: string;
  name: string;
  symbol: string;
  logoUrl?: string;
  priceUsd?: number;
  change24hPct?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  /** DEX Screener chain id of the market shown. */
  chain?: string;
  /** EVM markets: mainnet CAIP-2 (Advanced mode only). */
  networkId?: string;
  address?: string;
  /** Pair creation time (new tokens). */
  createdAt?: number;
  /** Where Swap should take the user. `assetKey` set = the wallet already knows this asset. */
  swap: { buy: string; symbol: string; assetKey?: string };
  source: "coingecko" | "dexscreener";
}

export interface DiscoverPool {
  id: string;
  /** "WETH / USDC". */
  pair: string;
  dex: string;
  chain: string;
  networkId?: string;
  liquidityUsd: number;
  volume24hUsd: number;
  change24hPct?: number;
  url: string;
  /** The side to buy when the user taps Swap (the non-wrapped-native token). */
  token: DiscoverToken;
}

export interface DiscoverFeed {
  trending: DiscoverToken[];
  newTokens: DiscoverToken[];
  topPools: DiscoverPool[];
  updatedAt: number;
  /** Sections whose source failed this time (the UI says so instead of showing nothing). */
  unavailable: ("trending" | "newTokens" | "topPools")[];
}

export interface DiscoverOptions {
  fetch: typeof fetch;
  networks: Network[];
  /** The wallet's assets (assetKey matching; trusted addresses). */
  assets: AssetRef[];
  /** CoinGecko id per wallet asset key (packages/features prices/ids.ts COINGECKO_IDS). */
  coingeckoIds?: Record<string, string>;
  risk?: TokenRiskSource;
  kv?: KVLike;
  now?: () => number;
  coingeckoBase?: string;
  dexBase?: string;
  /** CoinGecko Demo key from build config (never committed); sent as x-cg-demo-api-key. */
  coingeckoDemoKey?: string;
}

export const DISCOVER_TTL_MS = 5 * 60_000;
const PLATFORM_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_ENRICH = 10;
const PER_SECTION = 10;
const TIMEOUT_MS = 8000;
const FEED_KEY = "clip/social/discover";
const PLATFORM_KEY = "clip/social/cg-platforms";

type Json = Record<string, unknown>;

export class DiscoverService {
  private readonly now: () => number;
  private readonly chains: DiscoverChain[];
  private inflight?: Promise<DiscoverFeed>;

  constructor(private readonly o: DiscoverOptions) {
    this.now = o.now ?? Date.now;
    this.chains = supportedChains(o.networks);
  }

  /** Cached feed, refreshed when older than DISCOVER_TTL_MS (or when `refresh`). */
  async feed(opts: { refresh?: boolean } = {}): Promise<DiscoverFeed> {
    const cached = await this.o.kv?.get<DiscoverFeed>(FEED_KEY).catch(() => undefined);
    if (!opts.refresh && cached && this.now() - cached.updatedAt < DISCOVER_TTL_MS) return cached;
    this.inflight ??= this.load(cached).finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async load(cached?: DiscoverFeed): Promise<DiscoverFeed> {
    const [trending, newTokens, topPools] = await Promise.allSettled([this.trending(), this.newTokens(), this.topPools()]);
    const unavailable: DiscoverFeed["unavailable"] = [];
    const pick = <T>(r: PromiseSettledResult<T[]>, name: DiscoverFeed["unavailable"][number], fallback: T[] | undefined): T[] => {
      if (r.status === "fulfilled") return r.value;
      unavailable.push(name);
      return fallback ?? [];
    };
    const feed: DiscoverFeed = {
      trending: pick(trending, "trending", cached?.trending),
      newTokens: pick(newTokens, "newTokens", cached?.newTokens),
      topPools: pick(topPools, "topPools", cached?.topPools),
      updatedAt: this.now(),
      unavailable,
    };
    if (unavailable.length < 3) await this.o.kv?.set(FEED_KEY, feed).catch(() => undefined);
    return feed;
  }

  /* ------------------------------------------------------------------ CoinGecko trending */

  async trending(): Promise<DiscoverToken[]> {
    const base = this.o.coingeckoBase ?? "https://api.coingecko.com/api/v3";
    const body = (await this.get(`${base}/search/trending`, true)) as { coins?: { item: Json }[] };
    const byCgId = new Map(Object.entries(this.o.coingeckoIds ?? {}).map(([k, v]) => [v, k]));
    const platforms = (await this.o.kv?.get<Record<string, { at: number; p: Record<string, string> }>>(PLATFORM_KEY).catch(() => undefined)) ?? {};
    let looked = 0;
    const out: DiscoverToken[] = [];
    for (const { item } of body.coins ?? []) {
      const id = String(item.id ?? "");
      const symbol = String(item.symbol ?? "").toUpperCase();
      const name = String(item.name ?? symbol);
      if (!id || !symbol) continue;
      const data = (item.data ?? {}) as Json;
      const priceUsd = num(data.price);
      const change = num(((data.price_change_percentage_24h ?? {}) as Json).usd);
      const known = byCgId.get(id);
      const known1 = known && this.o.assets.some((a) => a.key === known) ? known : undefined;
      let chain: DiscoverChain | undefined;
      let address: string | undefined;
      if (!known1) {
        // Not a wallet asset: show it only if it lives on a supported chain.
        let p = platforms[id];
        if ((!p || this.now() - p.at > PLATFORM_TTL_MS) && looked < MAX_ENRICH) {
          looked++;
          const coin = (await this.get(`${base}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`, true).catch(() => null)) as { platforms?: Record<string, string> } | null;
          if (coin) p = platforms[id] = { at: this.now(), p: coin.platforms ?? {} };
        }
        if (!p) continue;
        for (const c of this.chains) {
          const a = p.p[c.coingecko];
          if (a) {
            chain = c;
            address = a;
            break;
          }
        }
        if (!chain) continue;
      }
      const ref: TokenRef = { chain: chain?.dex ?? "coingecko", symbol, name, ...(address ? { address } : {}) };
      // CoinGecko listings are curated: only the security lists can drop them (no liquidity/symbol heuristics).
      const listed = this.o.risk ? await Promise.resolve(this.o.risk.verdict(ref)).catch(() => undefined) : undefined;
      if (listed === "spam" || listed === "scam") continue;
      out.push({
        id: `cg:${id}`,
        name,
        symbol,
        ...(typeof item.small === "string" ? { logoUrl: item.small } : {}),
        ...(priceUsd !== undefined ? { priceUsd } : {}),
        ...(change !== undefined ? { change24hPct: change } : {}),
        ...(chain ? { chain: chain.dex } : {}),
        ...(chain && mainnetNetworkId(chain) ? { networkId: mainnetNetworkId(chain)! } : {}),
        ...(address ? { address } : {}),
        swap: known1 ? { buy: known1, symbol, assetKey: known1 } : { buy: `token:${chain!.dex}:${address}`, symbol },
        source: "coingecko",
      });
    }
    await this.o.kv?.set(PLATFORM_KEY, platforms).catch(() => undefined);
    return out.slice(0, PER_SECTION);
  }

  /* ------------------------------------------------------------------ DEX Screener */

  async newTokens(): Promise<DiscoverToken[]> {
    const base = this.o.dexBase ?? "https://api.dexscreener.com";
    const profiles = (await this.get(`${base}/token-profiles/latest/v1`)) as { chainId?: string; tokenAddress?: string; icon?: string }[];
    const wanted = new Map<string, Set<string>>();
    for (const p of Array.isArray(profiles) ? profiles : []) {
      if (!p.chainId || !p.tokenAddress || !this.chains.some((c) => c.dex === p.chainId)) continue;
      (wanted.get(p.chainId) ?? wanted.set(p.chainId, new Set()).get(p.chainId)!).add(p.tokenAddress);
    }
    const out: DiscoverToken[] = [];
    for (const [chainId, set] of wanted) {
      const chain = this.chains.find((c) => c.dex === chainId)!;
      const addrs = [...set].slice(0, 30);
      const pairs = (await this.get(`${base}/tokens/v1/${chainId}/${addrs.map(encodeURIComponent).join(",")}`).catch(() => [])) as Json[];
      for (const addr of addrs) {
        // The deepest pool where this token is the base token prices it.
        const best = (Array.isArray(pairs) ? pairs : [])
          .filter((p) => sameAddr(String(((p.baseToken ?? {}) as Json).address ?? ""), addr))
          .sort((a, b) => (liq(b) ?? 0) - (liq(a) ?? 0))[0];
        if (!best) continue;
        const t = this.tokenFromPair(best, chain, "base");
        if (!t) continue;
        const icon = (profiles as { tokenAddress?: string; icon?: string }[]).find((p) => p.tokenAddress === addr)?.icon;
        if (await this.blocked(t)) continue;
        out.push(icon ? { ...t, logoUrl: icon } : t);
      }
    }
    return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, PER_SECTION);
  }

  async topPools(): Promise<DiscoverPool[]> {
    const base = this.o.dexBase ?? "https://api.dexscreener.com";
    const out: DiscoverPool[] = [];
    const results = await Promise.allSettled(this.chains.map(async (chain) => ({ chain, pairs: (await this.get(`${base}/token-pairs/v1/${chain.dex}/${chain.wrappedNative}`)) as Json[] })));
    if (results.length && results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
    for (const r of results) {
      if (r.status !== "fulfilled" || !Array.isArray(r.value.pairs)) continue;
      const { chain } = r.value;
      const seen = new Set<string>();
      for (const p of r.value.pairs.sort((a, b) => vol(b) - vol(a))) {
        const baseT = (p.baseToken ?? {}) as Json;
        const quoteT = (p.quoteToken ?? {}) as Json;
        const side: "base" | "quote" = sameAddr(String(baseT.address ?? ""), chain.wrappedNative) ? "quote" : "base";
        const token = this.tokenFromPair(p, chain, side);
        if (!token || seen.has(token.id)) continue;
        if ((liq(p) ?? 0) < 250_000) continue;
        // Both sides must pass: a deep pool against a fake "USDC" is still a trap.
        if (await this.blocked(token)) continue;
        const other = this.tokenFromPair(p, chain, side === "base" ? "quote" : "base");
        if (other && (await this.blocked(other))) continue;
        seen.add(token.id);
        out.push({
          id: `pool:${chain.dex}:${String(p.pairAddress ?? "")}`,
          pair: `${String(baseT.symbol ?? "?")} / ${String(quoteT.symbol ?? "?")}`,
          dex: String(p.dexId ?? ""),
          chain: chain.dex,
          ...(mainnetNetworkId(chain) ? { networkId: mainnetNetworkId(chain)! } : {}),
          liquidityUsd: liq(p) ?? 0,
          volume24hUsd: vol(p),
          ...(num(((p.priceChange ?? {}) as Json).h24) !== undefined ? { change24hPct: num(((p.priceChange ?? {}) as Json).h24)! } : {}),
          url: String(p.url ?? ""),
          token,
        });
        if (seen.size >= 3) break;
      }
    }
    return out.sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, PER_SECTION);
  }

  /* ------------------------------------------------------------------ helpers */

  private tokenFromPair(p: Json, chain: DiscoverChain, side: "base" | "quote"): DiscoverToken | null {
    const tok = (p[side === "base" ? "baseToken" : "quoteToken"] ?? {}) as Json;
    const address = String(tok.address ?? "");
    const symbol = String(tok.symbol ?? "");
    if (!address || !symbol) return null;
    const known = this.knownAsset(chain, address);
    const isWrapped = sameAddr(address, chain.wrappedNative);
    return {
      id: `dex:${chain.dex}:${address}`,
      name: String(tok.name ?? symbol),
      symbol,
      ...(side === "base" && num(p.priceUsd) !== undefined ? { priceUsd: num(p.priceUsd)! } : {}),
      ...(side === "base" && num(((p.priceChange ?? {}) as Json).h24) !== undefined ? { change24hPct: num(((p.priceChange ?? {}) as Json).h24)! } : {}),
      ...(liq(p) !== undefined ? { liquidityUsd: liq(p)! } : {}),
      ...(vol(p) ? { volume24hUsd: vol(p) } : {}),
      ...(num(p.marketCap) !== undefined ? { marketCapUsd: num(p.marketCap)! } : {}),
      ...(typeof p.pairCreatedAt === "number" ? { createdAt: p.pairCreatedAt } : {}),
      chain: chain.dex,
      ...(mainnetNetworkId(chain) ? { networkId: mainnetNetworkId(chain)! } : {}),
      address,
      swap: known ? { buy: known, symbol, assetKey: known } : isWrapped ? { buy: nativeKeyOf(chain, this.o.networks), symbol, assetKey: nativeKeyOf(chain, this.o.networks) } : { buy: `token:${chain.dex}:${address}`, symbol },
      source: "dexscreener",
    };
  }

  private knownAsset(chain: DiscoverChain, address: string): string | undefined {
    const ids = new Set(chain.evmChainIds?.map((c) => `eip155:${c}`) ?? []);
    return this.o.assets.find((a) => a.address && sameAddr(a.address, address) && (ids.size ? ids.has(a.networkId) : this.o.networks.some((n) => n.id === a.networkId && n.family === chain.family)))?.key;
  }

  private async blocked(t: DiscoverToken): Promise<boolean> {
    const chain = DISCOVER_CHAINS.find((c) => c.dex === t.chain);
    const v = await verdictOf(
      { chain: t.chain ?? "", ...(t.address ? { address: t.address } : {}), symbol: t.symbol, name: t.name, ...(t.liquidityUsd !== undefined ? { liquidityUsd: t.liquidityUsd } : {}) },
      this.o.risk,
      { trusted: (_c, a) => (chain ? sameAddr(a, chain.wrappedNative) : false) || !!(chain && this.knownAsset(chain, a)) },
    );
    return v !== "ok";
  }

  private async get(url: string, coingecko = false): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (coingecko && this.o.coingeckoDemoKey) headers["x-cg-demo-api-key"] = this.o.coingeckoDemoKey;
    const res = await this.o.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function liq(p: Json): number | undefined {
  return num(((p.liquidity ?? {}) as Json).usd);
}
function vol(p: Json): number {
  return num(((p.volume ?? {}) as Json).h24) ?? 0;
}
function sameAddr(a: string, b: string): boolean {
  return a.startsWith("0x") || b.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b;
}
/** The wallet's native asset key for a market's family/chain (ETH for EVM L2s, SOL, HBAR). */
function nativeKeyOf(chain: DiscoverChain, networks: Network[]): string {
  const n = networks.find((x) => (chain.evmChainIds ? x.chainId !== undefined && chain.evmChainIds.includes(x.chainId) : x.family === chain.family));
  return n?.nativeAsset.key ?? chain.dex;
}
