/**
 * Which markets Discover shows: DEX Screener chain ids (checked against live /latest/dex/search and
 * /token-pairs/v1 results on 2026-10-03) and CoinGecko asset-platform ids, mapped to the wallet's families
 * and EVM chain ids. A chain is shown when the wallet has that family (non-EVM) or that EVM chain or one of its
 * testnets (market data is always mainnet's).
 */
import type { Family, Network } from "@clip-wallet/core";

export interface DiscoverChain {
  /** DEX Screener chainId. */
  dex: string;
  /** CoinGecko asset_platform id. */
  coingecko: string;
  family: Family;
  /** EVM: mainnet chain id first, then its testnets. */
  evmChainIds?: number[];
  /** Wrapped native token (top pools are this token's pairs). */
  wrappedNative: string;
  /** Human name, for Advanced mode only. */
  name: string;
}

export const DISCOVER_CHAINS: readonly DiscoverChain[] = [
  { dex: "ethereum", coingecko: "ethereum", family: "evm", evmChainIds: [1, 11155111, 17000, 560048], wrappedNative: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", name: "Ethereum" },
  { dex: "base", coingecko: "base", family: "evm", evmChainIds: [8453, 84532], wrappedNative: "0x4200000000000000000000000000000000000006", name: "Base" },
  { dex: "arbitrum", coingecko: "arbitrum-one", family: "evm", evmChainIds: [42161, 421614], wrappedNative: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", name: "Arbitrum One" },
  { dex: "optimism", coingecko: "optimistic-ethereum", family: "evm", evmChainIds: [10, 11155420], wrappedNative: "0x4200000000000000000000000000000000000006", name: "OP Mainnet" },
  { dex: "polygon", coingecko: "polygon-pos", family: "evm", evmChainIds: [137, 80002], wrappedNative: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", name: "Polygon PoS" },
  { dex: "bsc", coingecko: "binance-smart-chain", family: "evm", evmChainIds: [56, 97], wrappedNative: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", name: "BNB Smart Chain" },
  { dex: "avalanche", coingecko: "avalanche", family: "evm", evmChainIds: [43114, 43113], wrappedNative: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", name: "Avalanche C-Chain" },
  { dex: "linea", coingecko: "linea", family: "evm", evmChainIds: [59144, 59141], wrappedNative: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f", name: "Linea" },
  { dex: "scroll", coingecko: "scroll", family: "evm", evmChainIds: [534352, 534351], wrappedNative: "0x5300000000000000000000000000000000000004", name: "Scroll" },
  { dex: "solana", coingecko: "solana", family: "solana", wrappedNative: "So11111111111111111111111111111111111111112", name: "Solana" },
  // WHBAR (0.0.1456986) as DEX Screener reports it.
  { dex: "hedera", coingecko: "hedera-hashgraph", family: "hedera", wrappedNative: "0x0000000000000000000000000000000000163B5a", name: "Hedera" },
];

/** The chains this wallet's networks cover. */
export function supportedChains(networks: Network[]): DiscoverChain[] {
  const families = new Set(networks.map((n) => n.family));
  const evmIds = new Set(networks.filter((n) => n.family === "evm" && n.chainId !== undefined).map((n) => n.chainId!));
  return DISCOVER_CHAINS.filter((c) => (c.family === "evm" ? c.evmChainIds!.some((id) => evmIds.has(id)) : families.has(c.family)));
}

/** CAIP-2 of the market's mainnet (EVM only; other families are identified by family). */
export function mainnetNetworkId(c: DiscoverChain): string | undefined {
  return c.evmChainIds ? `eip155:${c.evmChainIds[0]}` : undefined;
}

/**
 * Canonical stablecoins per DEX Screener chain (addresses checked against DEX Screener /tokens/v1 on 2026-10-03).
 * A token or pool side using one of these symbols at any other address is an impersonation.
 */
export const CANONICAL: Record<string, Record<string, string[]>> = {
  USDC: {
    ethereum: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
    base: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
    arbitrum: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
    optimism: ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"],
    polygon: ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"],
    avalanche: ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"],
    bsc: ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"],
    linea: ["0x176211869cA2b568f2A7D4EE941E073a821EE1ff"],
    scroll: ["0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4"],
    solana: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
    hedera: ["0x000000000000000000000000000000000006f89a"],
  },
  USDT: {
    ethereum: ["0xdAC17F958D2ee523a2206206994597C13D831ec7"],
    bsc: ["0x55d398326f99059fF775485246999027B3197955"],
    solana: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
    // On these chains the canonical Tether is now USDT0 ("USD₮0"/"USDT0").
    arbitrum: ["0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"],
    polygon: ["0xc2132D05D31c914a87C6611C10748AEb04B58e8F"],
  },
};

/** Symbols nobody new gets to use: a fresh token called one of these is impersonating. */
export const PROTECTED_SYMBOLS = new Set(["USDC", "USDT", "USDT0", "DAI", "ETH", "WETH", "BTC", "WBTC", "CBBTC", "SOL", "WSOL", "HBAR", "WHBAR", "BNB", "WBNB", "POL", "MATIC", "AVAX", "WAVAX", "ARB", "OP", "LINK", "UNI", "PYUSD", "EURC"]);

/** "USD₮0" → "USDT0", "u$dc" → "UDC": symbols compared without decoration and look-alike glyphs. */
export function plainSymbol(symbol: string): string {
  return symbol
    .normalize("NFKC")
    .replace(/₮/g, "T")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}
