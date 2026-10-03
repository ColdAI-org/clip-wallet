import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Solana clusters. Two id schemes are in use:
 *  - Wallet Standard chains (@solana/wallet-standard-chains 1.1.2): solana:mainnet, solana:devnet, solana:testnet.
 *  - CAIP-2 for WalletConnect: "solana:" + the first 32 characters of the cluster's genesis hash.
 * Genesis hashes verified with getGenesisHash against each public RPC endpoint.
 * Clip Wallet's NetworkId is the CAIP-2 form; map with `toWalletStandardChain` / `fromChainId`.
 */
export type SolanaCluster = "mainnet" | "devnet" | "testnet";

export const SOLANA_CLUSTERS: Record<
  SolanaCluster,
  { caip2: NetworkId; walletStandard: string; genesisHash: string; rpc: string; explorerCluster: string }
> = {
  mainnet: {
    caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    walletStandard: "solana:mainnet",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    rpc: "https://api.mainnet-beta.solana.com",
    explorerCluster: "",
  },
  devnet: {
    caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    walletStandard: "solana:devnet",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    rpc: "https://api.devnet.solana.com",
    explorerCluster: "devnet",
  },
  testnet: {
    caip2: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
    walletStandard: "solana:testnet",
    genesisHash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    rpc: "https://api.testnet.solana.com",
    explorerCluster: "testnet",
  },
};

/** Circle USDC mints (mainnet and devnet checked on-chain: 6 decimals, SPL Token program). No Circle USDC on testnet. */
export const USDC_MINTS: Partial<Record<SolanaCluster, string>> = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export function solAsset(networkId: NetworkId): AssetRef {
  return { key: "sol", symbol: "SOL", name: "Solana", decimals: 9, networkId };
}

function network(cluster: SolanaCluster): Network {
  const c = SOLANA_CLUSTERS[cluster];
  return {
    id: c.caip2,
    family: "solana",
    name: cluster === "mainnet" ? "Solana" : `Solana ${cluster[0]!.toUpperCase()}${cluster.slice(1)}`,
    nativeAsset: solAsset(c.caip2),
    testnet: cluster !== "mainnet",
    rpcUrls: [c.rpc],
    explorerUrl: "https://explorer.solana.com",
  };
}

export const SOLANA_MAINNET = network("mainnet");
export const SOLANA_DEVNET = network("devnet");
export const SOLANA_TESTNET = network("testnet");
export const SOLANA_NETWORKS: Network[] = [SOLANA_DEVNET, SOLANA_TESTNET, SOLANA_MAINNET];

/** Accepts either id scheme (or a full genesis hash) and returns the cluster. */
export function clusterOf(chainId: string): SolanaCluster | null {
  for (const [name, c] of Object.entries(SOLANA_CLUSTERS) as [SolanaCluster, (typeof SOLANA_CLUSTERS)[SolanaCluster]][]) {
    if (chainId === c.caip2 || chainId === c.walletStandard || chainId === `solana:${c.genesisHash}`) return name;
  }
  return null;
}

export function toWalletStandardChain(networkId: NetworkId): string {
  const c = clusterOf(networkId);
  if (!c) throw new Error(`Not a Solana network: ${networkId}`);
  return SOLANA_CLUSTERS[c].walletStandard;
}

/** CAIP-2 NetworkId for any Solana chain id. */
export function fromChainId(chainId: string): NetworkId | null {
  const c = clusterOf(chainId);
  return c ? SOLANA_CLUSTERS[c].caip2 : null;
}

export function tokenAssetKey(networkId: NetworkId, mint: string): string {
  const c = clusterOf(networkId);
  return c && USDC_MINTS[c] === mint ? "usdc" : `spl:${mint}`;
}

export function explorerTxUrl(net: Network, signature: string): string {
  const c = clusterOf(net.id);
  const cluster = c ? SOLANA_CLUSTERS[c].explorerCluster : "";
  return `${net.explorerUrl}/tx/${signature}${cluster ? `?cluster=${cluster}` : ""}`;
}
