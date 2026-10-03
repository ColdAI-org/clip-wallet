import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * NEAR networks. ChainAgnostic/namespaces has no `near` namespace yet; "near:mainnet" / "near:testnet" are the
 * chain ids WalletConnect uses for NEAR (near/wallet-selector packages/wallet-connect: `near:${networkId}`), so
 * they are Clip Wallet's NetworkIds.
 *
 * RPC: FastNEAR's free endpoints are listed first on docs.near.org/api/rpc/providers; rpc.*.near.org answered
 * `status` with the right chain_id/genesis_hash when checked and stays as a fallback.
 */
export type NearNetworkName = "mainnet" | "testnet";

export const NEAR_CHAINS: Record<
  NearNetworkName,
  { id: NetworkId; genesisHash: string; rpc: string[]; fastnear: string; explorer: string }
> = {
  testnet: {
    id: "near:testnet",
    genesisHash: "FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b",
    rpc: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
    fastnear: "https://test.api.fastnear.com",
    explorer: "https://testnet.nearblocks.io",
  },
  mainnet: {
    id: "near:mainnet",
    genesisHash: "EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H",
    rpc: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
    fastnear: "https://api.fastnear.com",
    explorer: "https://nearblocks.io",
  },
};

/** Circle's native USDC on NEAR (developers.circle.com/stablecoins/usdc-contract-addresses). ft_metadata: USDC, 6 decimals. */
export const USDC_CONTRACTS: Record<NearNetworkName, string> = {
  mainnet: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  testnet: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
};

/** wNEAR (NEP-141 wrapper of NEAR, `near_deposit` / `near_withdraw`). */
export const WRAP_CONTRACTS: Record<NearNetworkName, string> = { mainnet: "wrap.near", testnet: "wrap.testnet" };

/** Staking pool factories: pools are `<name>.<factory>` (checked against the `validators` RPC). */
export const POOL_SUFFIXES: Record<NearNetworkName, string[]> = {
  mainnet: [".poolv1.near", ".pool.near"],
  testnet: [".pool.f863973.m0"],
};

export function nearAsset(networkId: NetworkId): AssetRef {
  return { key: "near", symbol: "NEAR", name: "NEAR", decimals: 24, networkId };
}

export function networkName(networkId: NetworkId): NearNetworkName | null {
  if (networkId === "near:mainnet" || networkId === "mainnet") return "mainnet";
  if (networkId === "near:testnet" || networkId === "testnet") return "testnet";
  return null;
}

function network(name: NearNetworkName): Network {
  const c = NEAR_CHAINS[name];
  return {
    id: c.id,
    family: "near",
    name: name === "mainnet" ? "NEAR" : "NEAR Testnet",
    nativeAsset: nearAsset(c.id),
    testnet: name !== "mainnet",
    rpcUrls: c.rpc,
    explorerUrl: c.explorer,
    indexerUrl: c.fastnear,
  };
}

export const NEAR_TESTNET = network("testnet");
export const NEAR_MAINNET = network("mainnet");
export const NEAR_NETWORKS: Network[] = [NEAR_TESTNET, NEAR_MAINNET];

export function tokenAssetKey(networkId: NetworkId, contract: string): string {
  const n = networkName(networkId);
  return n && USDC_CONTRACTS[n] === contract ? "usdc" : `nep141:${contract}`;
}

export function isPool(networkId: NetworkId, accountId: string): boolean {
  const n = networkName(networkId);
  return !!n && POOL_SUFFIXES[n].some((s) => accountId.endsWith(s) && accountId.length > s.length);
}

/** "kiln.pool.f863973.m0" → "kiln". */
export function poolName(accountId: string): string {
  for (const s of [...POOL_SUFFIXES.mainnet, ...POOL_SUFFIXES.testnet]) if (accountId.endsWith(s)) return accountId.slice(0, -s.length);
  return accountId;
}

export function explorerTxUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/txns/${hash}`;
}
