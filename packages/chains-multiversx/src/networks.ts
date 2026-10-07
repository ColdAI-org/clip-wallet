import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * MultiversX networks. Ids are the WalletConnect / CAIP-2 chain ids of the `mvx` namespace: "mvx:" + the chain's
 * own chain ID ("1" mainnet, "D" devnet, "T" testnet), the `chainID` field every transaction carries.
 * Gateway (proxy) and API endpoints are MultiversX's public ones, no key; each `GET /network/config` answered with
 * erd_chain_id 1 / D / T, min gas price 1,000,000,000, min gas limit 50,000, 1,500 gas per data byte (2026-10-06).
 */
export type MultiversXNet = "devnet" | "testnet" | "mainnet";

export interface MultiversXNetSpec {
  caip2: NetworkId;
  /** The transaction `chainID`. */
  chainId: string;
  /** Proxy (gateway): accounts, nonces, network config, /transaction/send, process-status. */
  gateway: string;
  /** Indexer API: token lists with metadata, staking providers. */
  api: string;
  explorer: string;
  /** USDC (bridged from Ethereum as an ESDT; the issuer's own MultiversX USDC doesn't exist). */
  usdc: string;
}

export const MULTIVERSX_NETS: Record<MultiversXNet, MultiversXNetSpec> = {
  devnet: {
    caip2: "mvx:D",
    chainId: "D",
    gateway: "https://devnet-gateway.multiversx.com",
    api: "https://devnet-api.multiversx.com",
    explorer: "https://devnet-explorer.multiversx.com",
    // devnet-api /tokens?search=USDC: the one with registered assets ("bridged as an ESDT token"), 6 decimals.
    usdc: "USDC-350c4e",
  },
  testnet: {
    caip2: "mvx:T",
    chainId: "T",
    gateway: "https://testnet-gateway.multiversx.com",
    api: "https://testnet-api.multiversx.com",
    explorer: "https://testnet-explorer.multiversx.com",
    usdc: "",
  },
  mainnet: {
    caip2: "mvx:1",
    chainId: "1",
    gateway: "https://gateway.multiversx.com",
    api: "https://api.multiversx.com",
    explorer: "https://explorer.multiversx.com",
    // api.multiversx.com /tokens/USDC-c76f1f: "WrappedUSDC", ticker USDC, 6 decimals.
    usdc: "USDC-c76f1f",
  },
};

/** EGLD: 18 decimals. */
export const EGLD_DECIMALS = 18;

/** The token identifier MultiESDTNFTTransfer uses for EGLD inside a multi-transfer (sdk-core EGLD_IDENTIFIER_FOR_MULTI_ESDTNFT_TRANSFER). */
export const EGLD_MULTI_ID = "EGLD-000000";

export function egldAsset(networkId: NetworkId): AssetRef {
  return { key: "egld", symbol: "EGLD", name: "MultiversX eGold", decimals: EGLD_DECIMALS, networkId };
}

function network(net: MultiversXNet): Network {
  const c = MULTIVERSX_NETS[net];
  return {
    id: c.caip2,
    family: "multiversx",
    name: net === "mainnet" ? "MultiversX" : net === "devnet" ? "MultiversX Devnet" : "MultiversX Testnet",
    nativeAsset: egldAsset(c.caip2),
    testnet: net !== "mainnet",
    rpcUrls: [c.gateway],
    explorerUrl: c.explorer,
    indexerUrl: c.api,
  };
}

export const MULTIVERSX_DEVNET = network("devnet");
export const MULTIVERSX_TESTNET = network("testnet");
export const MULTIVERSX_MAINNET = network("mainnet");
/** Devnet first: it's where MultiversX's faucet and dapps' test deployments are. */
export const MULTIVERSX_NETWORKS: Network[] = [MULTIVERSX_DEVNET, MULTIVERSX_TESTNET, MULTIVERSX_MAINNET];

/** Accepts "mvx:D", "D", or a network name. */
export function netOf(id: string): MultiversXNet | null {
  for (const [name, c] of Object.entries(MULTIVERSX_NETS) as [MultiversXNet, MultiversXNetSpec][]) {
    if (id === c.caip2 || id === c.chainId || id === name) return name;
  }
  return null;
}

export function specFor(networkId: NetworkId): MultiversXNetSpec | null {
  const n = netOf(networkId);
  return n ? MULTIVERSX_NETS[n] : null;
}

/** Ticker part of an ESDT identifier ("USDC-c76f1f" → "USDC"). */
export function tickerOf(identifier: string): string {
  const i = identifier.indexOf("-");
  return i > 0 ? identifier.slice(0, i) : identifier;
}

/** ESDT identifiers: TICKER (3-10 upper-case letters/digits) + "-" + 6 lower-case hex characters. */
export function isEsdtIdentifier(value: string): boolean {
  return /^[A-Z0-9]{3,10}-[0-9a-f]{6}$/.test(value);
}

export interface TokenInfo {
  identifier: string;
  ticker?: string;
  name?: string;
  decimals?: number;
  /** Registered in the MultiversX assets repository (logo, description). */
  assets?: { status?: string; pngUrl?: string; svgUrl?: string } | null;
  isVerified?: boolean;
}

/**
 * AssetRef for an ESDT. USDC (the known identifier) → key "usdc.mvx", bridged (it is Ethereum USDC moved over a
 * bridge, so it never merges with Circle's native USDC). Others: "esdt:<identifier>". A token is marked spam when
 * it isn't registered in the MultiversX assets repository, or when it calls itself USDC / EGLD without being the
 * real one.
 */
export function esdtAsset(networkId: NetworkId, info: TokenInfo): AssetRef {
  const spec = specFor(networkId);
  const isUsdc = !!spec?.usdc && info.identifier === spec.usdc;
  const ticker = info.ticker || tickerOf(info.identifier);
  const asset: AssetRef = {
    key: isUsdc ? "usdc.mvx" : `esdt:${info.identifier}`,
    symbol: isUsdc ? "USDC" : ticker,
    name: isUsdc ? "USD Coin (bridged from Ethereum)" : info.name || ticker,
    decimals: isUsdc ? 6 : (info.decimals ?? 0),
    networkId,
    address: info.identifier,
  };
  if (isUsdc) {
    asset.bridged = true;
    return asset;
  }
  const logo = info.assets?.svgUrl ?? info.assets?.pngUrl;
  if (logo) asset.logoUrl = logo;
  const registered = !!info.assets && info.assets.status !== "inactive";
  if (!registered || looksLikeKnown(ticker) || looksLikeKnown(info.name ?? "")) asset.spam = true;
  return asset;
}

function looksLikeKnown(text: string): boolean {
  const t = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return t === "EGLD" || t.startsWith("USDC") || t === "USD" || t === "U5DC";
}

export function explorerTxUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/transactions/${hash}`;
}
