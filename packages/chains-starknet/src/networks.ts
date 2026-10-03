import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Starknet networks.
 *
 *  - NetworkId: CAIP-2 `starknet:<chain id string>` (ChainAgnostic namespaces, starknet/caip2.md):
 *    `starknet:SN_MAIN`, `starknet:SN_SEPOLIA`.
 *  - Wallet API chain id (wallet_requestChainId, wallet_switchStarknetChain, starknet_chainId): the
 *    short string as a felt, `0x534e5f4d41494e` ("SN_MAIN") and `0x534e5f5345504f4c4941` ("SN_SEPOLIA").
 *  - Public RPCs (no key, JSON-RPC spec 0.10, checked with starknet_chainId / starknet_specVersion on
 *    2026-10-03): ZAN (`/rpc/v0_10`, starknet.js's RPC_DEFAULT_NODES host) and PublicNode.
 */
export type StarknetChain = "SN_MAIN" | "SN_SEPOLIA";

export const STARKNET_CHAINS: Record<StarknetChain, { caip2: NetworkId; chainId: string; rpc: string[]; explorer: string }> = {
  SN_MAIN: {
    caip2: "starknet:SN_MAIN",
    chainId: "0x534e5f4d41494e",
    rpc: ["https://api.zan.top/public/starknet-mainnet/rpc/v0_10", "https://starknet-rpc.publicnode.com"],
    explorer: "https://voyager.online",
  },
  SN_SEPOLIA: {
    caip2: "starknet:SN_SEPOLIA",
    chainId: "0x534e5f5345504f4c4941",
    rpc: ["https://api.zan.top/public/starknet-sepolia/rpc/v0_10", "https://starknet-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.voyager.online",
  },
};

/** STRK pays fees (v3 transactions) and is the network's own token. Same contract on both networks. */
export const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
/** ETH over StarkGate (Starknet's canonical bridge). Same contract on both networks. */
export const ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

export function strkAsset(networkId: NetworkId): AssetRef {
  return { key: "strk", symbol: "STRK", name: "Starknet Token", decimals: 18, networkId };
}

function network(chain: StarknetChain): Network {
  const c = STARKNET_CHAINS[chain];
  return {
    id: c.caip2,
    family: "starknet",
    name: chain === "SN_MAIN" ? "Starknet" : "Starknet Sepolia",
    nativeAsset: strkAsset(c.caip2),
    testnet: chain !== "SN_MAIN",
    rpcUrls: c.rpc,
    explorerUrl: c.explorer,
  };
}

export const STARKNET_MAINNET = network("SN_MAIN");
export const STARKNET_SEPOLIA = network("SN_SEPOLIA");
export const STARKNET_NETWORKS: Network[] = [STARKNET_SEPOLIA, STARKNET_MAINNET];

/** Accepts the CAIP-2 id, the short string ("SN_SEPOLIA") or the felt hex chain id. */
export function chainOf(id: string): StarknetChain | null {
  const v = id.trim();
  for (const [name, c] of Object.entries(STARKNET_CHAINS) as [StarknetChain, (typeof STARKNET_CHAINS)[StarknetChain]][]) {
    if (v === c.caip2 || v === name) return name;
    if (/^0x[0-9a-fA-F]+$/.test(v) && BigInt(v) === BigInt(c.chainId)) return name;
  }
  return null;
}

export function fromChainId(id: string): NetworkId | null {
  const c = chainOf(id);
  return c ? STARKNET_CHAINS[c].caip2 : null;
}

/** Felt hex chain id for a NetworkId (what wallet_requestChainId returns). */
export function walletChainId(networkId: NetworkId): string {
  const c = chainOf(networkId);
  if (!c) throw new Error(`Not a Starknet network: ${networkId}`);
  return STARKNET_CHAINS[c].chainId;
}

export function explorerTxUrl(net: Network, txHash: string): string {
  return `${net.explorerUrl}/tx/${txHash}`;
}
