/**
 * Curated tokens, asset keys, known apps and spam heuristics.
 *
 * Asset keys: only the same issuer's native token shares a key. Circle-issued USDC is "usdc" on every
 * network where Circle issues it natively (addresses from developers.circle.com/stablecoins/usdc-contract-addresses,
 * 2026-10-03); testnet USDC shares the "usdc" key (a build runs testnets or mainnet, never both). Bridged copies (USDC.e) get "usdc.e" and bridged=true.
 * Unknown tokens get a key unique to their contract, so they are never merged with anything.
 */
import type { AssetRef, NetworkId } from "@clip-wallet/core";
import { getAddress } from "viem";

export interface CuratedToken {
  chainId: number;
  address: `0x${string}`;
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  bridged?: boolean;
}

const usdc = (chainId: number, address: `0x${string}`, testnet = false): CuratedToken => ({
  chainId, address, key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6,
});
const usdce = (chainId: number, address: `0x${string}`): CuratedToken => ({
  chainId, address, key: "usdc.e", symbol: "USDC.e", name: "Bridged USDC", decimals: 6, bridged: true,
});

export const CURATED_TOKENS: CuratedToken[] = [
  // Circle native USDC
  usdc(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  usdc(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  usdc(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
  usdc(10, "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
  usdc(137, "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
  usdc(43114, "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"),
  usdc(42220, "0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
  usdc(59144, "0x176211869cA2b568f2A7D4EE941E073a821EE1ff"),
  usdc(130, "0x078D782b760474a361dDA0AF3839290b0EF57AD6"),
  usdc(480, "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1"),
  usdc(324, "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4"),
  usdc(57073, "0x2D270e6886d130D724215A266106e6832161EAEd"),
  usdc(1329, "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392"),
  usdc(999, "0xb88339CB7199b77E23DB6E890353E22632Ba630f"),
  usdc(98866, "0x222365EF19F7947e5484218551B56bb3965Aa7aF"),
  usdc(143, "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"),
  // Circle testnet USDC
  usdc(11155111, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", true),
  usdc(84532, "0x036CbD53842c5426634e7929541eC2318f3dCF7e", true),
  usdc(421614, "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", true),
  usdc(11155420, "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", true),
  // Bridged USDC (pre-native deployments)
  usdce(42161, "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"),
  usdce(137, "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"),
  usdce(10, "0x7F5c764cBc14f9669B88837ca1490cCa17c31607"),
  // Tether native on Ethereum
  { chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", key: "usdt", symbol: "USDT", name: "Tether USD", decimals: 6 },
];

const byChainAddr = new Map(CURATED_TOKENS.map((t) => [`${t.chainId}:${t.address.toLowerCase()}`, t]));

export function curatedToken(chainId: number, address: string): CuratedToken | undefined {
  return byChainAddr.get(`${chainId}:${address.toLowerCase()}`);
}

export const curatedFor = (chainId: number): CuratedToken[] => CURATED_TOKENS.filter((t) => t.chainId === chainId);

export function curatedAsset(t: CuratedToken): AssetRef {
  const a: AssetRef = { key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId: `eip155:${t.chainId}`, address: t.address };
  if (t.bridged) a.bridged = true;
  return a;
}

/** Key for a token we know nothing about: unique per contract, never merged. */
export const contractKey = (networkId: NetworkId, address: string): string => `${networkId}/${address.toLowerCase()}`;

export function tokenAsset(networkId: NetworkId, chainId: number, address: string, meta: { symbol?: string; name?: string; decimals?: number }): AssetRef {
  const c = curatedToken(chainId, address);
  if (c) return curatedAsset(c);
  const symbol = (meta.symbol ?? "").trim() || "token";
  const name = (meta.name ?? "").trim() || symbol;
  const a: AssetRef = { key: contractKey(networkId, address), symbol, name, decimals: meta.decimals ?? 0, networkId, address: getAddress(address) };
  // Not curated (that returned above): a USDC/ETH/… ticker here is an impersonation (audit TOK-01). Passing options
  // turns that check on, as the portfolio path already did; approvals and simulations now see it too.
  if (looksLikeSpam(symbol, name, {})) a.spam = true;
  return a;
}

/* ------------------------------------------------------------------ spam heuristics */

const SPAM_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\.(com|io|org|net|xyz|app|site|top|gift|claims?|vip|cc|me|link|pro|live)\b/i,
  /t\.me\//i,
  /\b(claim|visit|reward|airdrop|voucher|bonus|redeem|giveaway|free)\b/i,
  /[Ѐ-ӿͰ-Ͽ]/, // Cyrillic / Greek lookalikes in a ticker
  /[^\x20-\x7E]{2,}/, // runs of non-printable / exotic characters
  /[\p{Cc}\p{Cf}]/u, // any invisible or direction-changing character (audit TOK-01)
];

/** Symbols that scam tokens copy. A token using one of these that is not the curated contract is spam. */
const IMPERSONATED = new Set(["USDC", "USDT", "ETH", "WETH", "DAI", "WBTC"]);

export function looksLikeSpam(symbol: string, name: string, opts?: { curated?: boolean; reputation?: string | null }): boolean {
  if (opts?.curated) return false;
  if (opts?.reputation && /scam|spam/i.test(opts.reputation)) return true;
  const text = `${symbol} ${name}`;
  if (SPAM_PATTERNS.some((p) => p.test(text))) return true;
  if (symbol.length > 24 || name.length > 64) return true;
  if (opts && IMPERSONATED.has(symbol.toUpperCase())) return true;
  return false;
}

/* ------------------------------------------------------------------ known apps (spender / operator names) */

/** Contracts with the same address on every network they are deployed to. Plain names only. */
export const KNOWN_APPS: Record<string, string> = {
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap Permit2",
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Uniswap",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Uniswap",
  "0x0000000000000068f116a894984e2db1123eb395": "OpenSea",
  "0x111111125421ca6dc452d289314280a0f8842a65": "1inch",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x",
};

export const appName = (address: string): string | undefined => KNOWN_APPS[address.toLowerCase()];
