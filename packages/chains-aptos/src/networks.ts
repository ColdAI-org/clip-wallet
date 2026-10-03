import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Aptos networks. Two id schemes are in use:
 *  - CAIP-2 (ChainAgnostic namespaces, aptos/caip2.md): `aptos:<chain_id>`: mainnet `aptos:1`, testnet `aptos:2`.
 *    Devnet's numeric chain id changes on every reset (248 on 2026-10-03), so its NetworkId is the stable name `aptos:devnet`.
 *  - AIP-62 Wallet Standard chains (@aptos-labs/wallet-standard APTOS_CHAINS): aptos:mainnet, aptos:testnet, aptos:devnet.
 * Clip Wallet's NetworkId is the CAIP-2 form; map with `toWalletStandardChain` / `fromChainId` (accepts either).
 * Chain ids were read from GET /v1 (ledger info) on each public fullnode.
 */
export type AptosNetworkName = "mainnet" | "testnet" | "devnet";

export const APTOS_CHAINS: Record<
  AptosNetworkName,
  { id: NetworkId; walletStandard: `aptos:${string}`; chainId: number | null; fullnode: string; indexer: string }
> = {
  mainnet: { id: "aptos:1", walletStandard: "aptos:mainnet", chainId: 1, fullnode: "https://api.mainnet.aptoslabs.com/v1", indexer: "https://api.mainnet.aptoslabs.com/v1/graphql" },
  testnet: { id: "aptos:2", walletStandard: "aptos:testnet", chainId: 2, fullnode: "https://api.testnet.aptoslabs.com/v1", indexer: "https://api.testnet.aptoslabs.com/v1/graphql" },
  devnet: { id: "aptos:devnet", walletStandard: "aptos:devnet", chainId: null, fullnode: "https://api.devnet.aptoslabs.com/v1", indexer: "https://api.devnet.aptoslabs.com/v1/graphql" },
};

/** APT: the coin type and its paired fungible-asset metadata object (0xa). */
export const APT_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
export const APT_METADATA = "0x000000000000000000000000000000000000000000000000000000000000000a";

/** Circle USDC fungible-asset metadata addresses (checked with 0x1::fungible_asset::symbol on each network). */
export const USDC_METADATA: Partial<Record<AptosNetworkName, string>> = {
  mainnet: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
  testnet: "0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832",
};

export function aptAsset(networkId: NetworkId): AssetRef {
  return { key: "apt", symbol: "APT", name: "Aptos", decimals: 8, networkId };
}

function network(name: AptosNetworkName): Network {
  const c = APTOS_CHAINS[name];
  const n: Network = {
    id: c.id,
    family: "aptos",
    name: name === "mainnet" ? "Aptos" : `Aptos ${name[0]!.toUpperCase()}${name.slice(1)}`,
    nativeAsset: aptAsset(c.id),
    testnet: name !== "mainnet",
    rpcUrls: [c.fullnode],
    explorerUrl: "https://explorer.aptoslabs.com",
    indexerUrl: c.indexer,
  };
  return n;
}

export const APTOS_MAINNET = network("mainnet");
export const APTOS_TESTNET = network("testnet");
export const APTOS_DEVNET = network("devnet");
export const APTOS_NETWORKS: Network[] = [APTOS_TESTNET, APTOS_DEVNET, APTOS_MAINNET];

/** Accepts the CAIP-2 id or the AIP-62 chain id. */
export function aptosNetworkOf(chainId: string): AptosNetworkName | null {
  for (const [name, c] of Object.entries(APTOS_CHAINS) as [AptosNetworkName, (typeof APTOS_CHAINS)[AptosNetworkName]][]) {
    if (chainId === c.id || chainId === c.walletStandard) return name;
  }
  return null;
}

export function toWalletStandardChain(networkId: NetworkId): `aptos:${string}` {
  const n = aptosNetworkOf(networkId);
  if (!n) throw new Error(`Not an Aptos network: ${networkId}`);
  return APTOS_CHAINS[n].walletStandard;
}

export function fromChainId(chainId: string): NetworkId | null {
  const n = aptosNetworkOf(chainId);
  return n ? APTOS_CHAINS[n].id : null;
}

/** 64-hex, lower-case address. */
export function longAddress(a: string): string {
  const h = a.toLowerCase().replace(/^0x/, "");
  return `0x${h.padStart(64, "0")}`;
}

/**
 * Shared asset key: APT (coin or its 0xa fungible asset) = "apt", Circle USDC = "usdc",
 * other fungible assets `aptos:<metadata>`, other coins `aptos:<coin type>`.
 */
export function assetKey(networkId: NetworkId, assetType: string): string {
  if (isApt(assetType)) return "apt";
  const n = aptosNetworkOf(networkId);
  if (!assetType.includes("::") && n && USDC_METADATA[n] && longAddress(assetType) === USDC_METADATA[n]) return "usdc";
  return `aptos:${assetType.includes("::") ? assetType : longAddress(assetType)}`;
}

export function isApt(assetType: string): boolean {
  if (assetType.includes("::")) return /^0x0*1::aptos_coin::AptosCoin$/.test(assetType);
  try {
    return longAddress(assetType) === APT_METADATA;
  } catch {
    return false;
  }
}

export function explorerTxUrl(net: Network, hash: string): string {
  const n = aptosNetworkOf(net.id) ?? "testnet";
  return `${net.explorerUrl}/txn/${hash}?network=${n}`;
}

/** SDK-canonical address: special addresses (0x0–0xf) short, everything else 64 hex. */
export function canonicalAddress(a: string): string {
  const h = a.toLowerCase().replace(/^0x/, "").replace(/^0+(?=.)/, "");
  return h.length === 1 ? `0x${h}` : longAddress(h);
}

/** Canonicalises every address inside a Move type ("0xbeef::m::T<0x1::x::Y>"). */
export function canonicalType(t: string): string {
  return t.replace(/0x[0-9a-fA-F]+(?=::)/g, (m) => canonicalAddress(m));
}
