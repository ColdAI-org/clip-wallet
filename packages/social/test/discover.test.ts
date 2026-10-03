import { describe, expect, it } from "vitest";
import type { AssetRef, Network } from "@clip-wallet/core";
import { DiscoverService, heuristicVerdict, supportedChains, type TokenRiskSource } from "../src/index.js";
import { MapKV, routes } from "./helpers.js";
import trending from "./fixtures/coingecko-trending.json";
import coins from "./fixtures/coingecko-coins.json";
import profiles from "./fixtures/dexscreener-profiles.json";
import hederaPairs from "./fixtures/dexscreener-hedera-whbar-pairs.json";
import solSearch from "./fixtures/dexscreener-solana-search.json";

const net = (id: string, family: Network["family"], chainId?: number, key = "x") =>
  ({ id, family, name: id, chainId, nativeAsset: { key, symbol: key.toUpperCase(), name: key, decimals: 18, networkId: id }, testnet: true, rpcUrls: [], explorerUrl: "" }) as Network;
const NETWORKS = [net("eip155:84532", "evm", 84532, "eth"), net("solana:devnet", "solana", undefined, "sol"), net("hedera:testnet", "hedera", undefined, "hbar")];
const ASSETS = [{ key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "hedera:testnet" }] as AssetRef[];

// Real DEX Screener token-profile addresses (fixtures/dexscreener-profiles.json), priced with synthetic pairs.
const sol = (profiles as { chainId: string; tokenAddress: string }[]).filter((p) => p.chainId === "solana").map((p) => p.tokenAddress);
const pair = (address: string, symbol: string, name: string, liquidity: number | undefined, createdAt: number) => ({
  chainId: "solana",
  dexId: "raydium",
  url: `https://dexscreener.com/solana/${address}`,
  pairAddress: `pair-${address}`,
  baseToken: { address, symbol, name },
  quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL" },
  priceUsd: "0.0123",
  priceChange: { h24: 42.5 },
  volume: { h24: 900000 },
  ...(liquidity !== undefined ? { liquidity: { usd: liquidity } } : {}),
  pairCreatedAt: createdAt,
});
const solanaTokens = [
  pair(sol[0]!, "GOOD", "Good Token", 120_000, 3),
  pair(sol[1]!, "USDC", "UpSideDownCat", 900_000, 4), // impersonation (real case from the search fixture)
  pair(sol[2]!, "VISIT", "claim-airdrop.com", 500_000, 5), // bait
  pair(sol[3]!, "THIN", "Thin", 2_000, 6), // too thin
];

function service(over: { risk?: TokenRiskSource; fail?: string[] } = {}) {
  const r = routes(
    {
      "/search/trending": trending,
      "/coins/layerzero": coins.layerzero,
      "/token-profiles/latest/v1": profiles,
      "/tokens/v1/solana/": solanaTokens,
      "/token-pairs/v1/hedera/": hederaPairs,
      "/token-pairs/v1/solana/": solSearch,
      "/token-pairs/v1/base/": [],
    },
    Object.fromEntries((over.fail ?? []).map((k) => [k, 500])),
  );
  const s = new DiscoverService({ fetch: r.f, networks: NETWORKS, assets: ASSETS, kv: new MapKV(), coingeckoIds: { hbar: "hedera-hashgraph" }, now: () => 1_000_000, ...(over.risk ? { risk: over.risk } : {}) });
  return { s, urls: r.urls };
}

describe("supported chains", () => {
  it("maps the wallet's (test)networks to mainnet markets", () => {
    expect(supportedChains(NETWORKS).map((c) => c.dex)).toEqual(["base", "solana", "hedera"]);
    expect(supportedChains([net("eip155:1", "evm", 1)]).map((c) => c.dex)).toEqual(["ethereum"]);
    expect(supportedChains([net("bip122:x", "bitcoin")])).toEqual([]);
  });
});

describe("Discover", () => {
  it("trending: CoinGecko coins on supported networks only, each with a Swap target", async () => {
    const { s, urls } = service();
    const list = await s.trending();
    // layerzero has a Base platform; the others' platforms are unknown (404) or not on supported chains.
    expect(list.map((t) => t.symbol)).toEqual(["ZRO"]);
    expect(list[0]).toMatchObject({ id: "cg:layerzero", chain: "base", networkId: "eip155:8453", swap: { symbol: "ZRO" }, source: "coingecko" });
    expect(list[0]!.swap.buy).toMatch(/^token:base:0x/);
    expect(urls.filter((u) => u.includes("/coins/")).length).toBeLessThanOrEqual(10);
  });

  it("new tokens: impersonators, bait and thin pools are filtered out", async () => {
    const { s } = service();
    const list = await s.newTokens();
    expect(list.map((t) => t.symbol)).toEqual(["GOOD"]);
    expect(list[0]).toMatchObject({ chain: "solana", liquidityUsd: 120_000, priceUsd: 0.0123, change24hPct: 42.5, swap: { buy: `token:solana:${sol[0]}` } });
    expect(list[0]!.logoUrl).toMatch(/^https:\/\/cdn\.dexscreener\.com\//);
  });

  it("top pools: deep pools by volume; the wrapped native maps to the wallet's own asset", async () => {
    const { s } = service();
    const pools = await s.topPools();
    const hedera = pools.filter((p) => p.chain === "hedera");
    // USDC (canonical 0.0.456858) and HBARX pass; USDC[hts] has too little liquidity.
    expect(hedera.map((p) => p.pair)).toEqual(["WHBAR / USDC", "WHBAR / HBARX"]);
    expect(hedera[0]!.token).toMatchObject({ symbol: "USDC", swap: { buy: "token:hedera:0x000000000000000000000000000000000006f89a" } });
    // Solana: the "USDC" (UpSideDownCat) pool and the keyword-stuffed symbol are dropped.
    expect(pools.some((p) => p.pair.startsWith("USDC /") && p.chain === "solana")).toBe(false);
    expect(pools.every((p) => p.pair.length < 60)).toBe(true);
  });

  it("the security stream's list can block what heuristics let through", async () => {
    const { s } = service({ risk: { verdict: (t) => (t.symbol === "GOOD" || t.symbol === "ZRO" ? "scam" : undefined) } });
    expect(await s.newTokens()).toEqual([]);
    expect(await s.trending()).toEqual([]);
  });

  it("feed: caches, and says which section is unavailable instead of failing", async () => {
    const { s, urls } = service({ fail: ["/search/trending"] });
    const f = await s.feed();
    expect(f.unavailable).toEqual(["trending"]);
    expect(f.newTokens.length).toBe(1);
    const n = urls.length;
    await s.feed();
    expect(urls.length).toBe(n); // cached
    await s.feed({ refresh: true });
    expect(urls.length).toBeGreaterThan(n);
  });
});

describe("heuristics", () => {
  it("impersonation, bait, invisible characters, mixed scripts, thin liquidity", () => {
    expect(heuristicVerdict({ chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin" })).toBe("ok");
    expect(heuristicVerdict({ chain: "base", address: "0x0000000000000000000000000000000000000bad", symbol: "USDC", name: "USD Coin" })).toBe("scam");
    expect(heuristicVerdict({ chain: "arbitrum", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USD₮0", name: "USD₮0" })).toBe("ok");
    expect(heuristicVerdict({ chain: "base", address: "0xabc", symbol: "ETH", name: "Ether" })).toBe("scam");
    expect(heuristicVerdict({ chain: "base", address: "0xabc", symbol: "GIFT", name: "Visit t.me/x to claim" })).toBe("scam");
    expect(heuristicVerdict({ chain: "base", address: "0xabc", symbol: "PE​PE", name: "Pepe" })).toBe("scam");
    expect(heuristicVerdict({ chain: "base", address: "0xabc", symbol: "\u0420\u0415\u0420\u0415", name: "Pepe" })).toBe("ok"); // all-Cyrillic is a script, not a mix…
    expect(heuristicVerdict({ chain: "base", address: "0xabc", symbol: "PEPЕ", name: "Pepe" })).toBe("scam"); // …mixed Latin + Cyrillic Е is
    expect(heuristicVerdict({ chain: "base", address: "0xabc", symbol: "PEPE", name: "Pepe", liquidityUsd: 10 })).toBe("spam");
  });
});
