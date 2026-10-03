import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";
import { normalizeStructTag } from "@mysten/sui/utils";

/**
 * Sui networks. One id scheme serves everything:
 *  - CAIP-2 (ChainAgnostic namespaces, sui/caip2.md): `sui:mainnet`, `sui:testnet`, `sui:devnet` (regex ^sui:(mainnet|testnet|devnet)$).
 *  - Wallet Standard chains (@mysten/wallet-standard SUI_CHAINS): the same strings.
 *  - WalletConnect uses the CAIP-2 ids.
 * Public endpoints: Sui Foundation's public fullnodes no longer serve JSON-RPC (shut off July 2026, verified: every
 * method answers -32601 "JSON-RPC on public fullnodes has been deprecated"), so this module talks GraphQL RPC.
 * Chain identifiers below were read with `{ chainIdentifier }` on each endpoint (2026-10-03); testnet/devnet change on reset.
 */
export type SuiNetworkName = "mainnet" | "testnet" | "devnet";

export const SUI_CHAINS: Record<SuiNetworkName, { id: NetworkId; graphql: string; chainIdentifier: string }> = {
  mainnet: { id: "sui:mainnet", graphql: "https://graphql.mainnet.sui.io/graphql", chainIdentifier: "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S" },
  testnet: { id: "sui:testnet", graphql: "https://graphql.testnet.sui.io/graphql", chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD" },
  devnet: { id: "sui:devnet", graphql: "https://graphql.devnet.sui.io/graphql", chainIdentifier: "HqW49ubUVvCrjTRiM5FJzzhD4A3geXQY6GcK5JMhPWs" },
};

export const SUI_TYPE = normalizeStructTag("0x2::sui::SUI");

/** Circle USDC (checked with coinMetadata on each network: 6 decimals, symbol USDC). None on devnet. */
export const USDC_COIN_TYPES: Partial<Record<SuiNetworkName, string>> = {
  mainnet: normalizeStructTag("0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"),
  testnet: normalizeStructTag("0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC"),
};

export function suiAsset(networkId: NetworkId): AssetRef {
  return { key: "sui", symbol: "SUI", name: "Sui", decimals: 9, networkId };
}

function network(name: SuiNetworkName): Network {
  const c = SUI_CHAINS[name];
  return {
    id: c.id,
    family: "sui",
    name: name === "mainnet" ? "Sui" : `Sui ${name[0]!.toUpperCase()}${name.slice(1)}`,
    nativeAsset: suiAsset(c.id),
    testnet: name !== "mainnet",
    rpcUrls: [c.graphql],
    explorerUrl: name === "mainnet" ? "https://suiscan.xyz/mainnet" : `https://suiscan.xyz/${name}`,
  };
}

export const SUI_MAINNET = network("mainnet");
export const SUI_TESTNET = network("testnet");
export const SUI_DEVNET = network("devnet");
export const SUI_NETWORKS: Network[] = [SUI_TESTNET, SUI_DEVNET, SUI_MAINNET];

export function suiNetworkOf(chainId: string): SuiNetworkName | null {
  for (const [name, c] of Object.entries(SUI_CHAINS) as [SuiNetworkName, (typeof SUI_CHAINS)[SuiNetworkName]][]) {
    if (chainId === c.id) return name;
  }
  return null;
}

/** Wallet Standard chain for a NetworkId (identical strings for Sui). */
export function toWalletStandardChain(networkId: NetworkId): `sui:${string}` {
  if (!suiNetworkOf(networkId)) throw new Error(`Not a Sui network: ${networkId}`);
  return networkId as `sui:${string}`;
}

export function fromChainId(chainId: string): NetworkId | null {
  const n = suiNetworkOf(chainId);
  return n ? SUI_CHAINS[n].id : null;
}

/** Shared asset key: SUI = "sui", Circle USDC = "usdc", anything else `sui:<coin type>`. */
export function coinAssetKey(networkId: NetworkId, coinType: string): string {
  const t = normalizeStructTag(coinType);
  if (t === SUI_TYPE) return "sui";
  const n = suiNetworkOf(networkId);
  return n && USDC_COIN_TYPES[n] === t ? "usdc" : `sui:${t}`;
}

export function explorerTxUrl(net: Network, digest: string): string {
  return `${net.explorerUrl}/tx/${digest}`;
}
