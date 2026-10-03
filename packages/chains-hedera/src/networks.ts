import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Hedera networks. Ids are the CAIP-2 ids used by Hedera WalletConnect (HIP-30), verified against
 * `LEDGER_ID_MAPPINGS` in @hashgraph/hedera-wallet-connect 2.1.3 (src/lib/shared/utils.ts):
 *   hedera:mainnet ↔ EVM 295, hedera:testnet ↔ 296, hedera:previewnet ↔ 297 (hedera:devnet = local node, 298).
 *
 * Hedera's EVM (eip155:295 / eip155:296 / eip155:297 via the JSON-RPC relay) is NOT handled here: EVM-style
 * requests (eth_sendTransaction etc.) go through @clip-wallet/chains-evm. The same secp256k1 key gives the same
 * 0x address on both sides, which is the account's EVM alias here.
 *
 * `rpcUrls` is empty on purpose: Hedera transactions go to consensus nodes over gRPC-Web (`GRPC_WEB_NODES` below);
 * reads go to the mirror node (`indexerUrl`).
 */

export type HederaLedger = "mainnet" | "testnet" | "previewnet";

export const HEDERA_NETWORK_IDS = {
  mainnet: "hedera:mainnet",
  testnet: "hedera:testnet",
  previewnet: "hedera:previewnet",
} as const satisfies Record<HederaLedger, NetworkId>;

export const MIRROR_NODE_URLS: Record<HederaLedger, string> = {
  mainnet: "https://mainnet-public.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

export const HASHSCAN_URLS: Record<HederaLedger, string> = {
  mainnet: "https://hashscan.io/mainnet",
  testnet: "https://hashscan.io/testnet",
  previewnet: "https://hashscan.io/previewnet",
};

/** Circle's native USDC on Hedera (checked against the mirror node: name "USD Coin", 6 decimals). */
export const USDC_TOKEN_IDS: Partial<Record<HederaLedger, string>> = {
  mainnet: "0.0.456858",
  testnet: "0.0.429274",
};

export function hbarAsset(networkId: NetworkId): AssetRef {
  return { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId };
}

function network(ledger: HederaLedger): Network {
  const id = HEDERA_NETWORK_IDS[ledger];
  return {
    id,
    family: "hedera",
    name: ledger === "mainnet" ? "Hedera" : `Hedera ${ledger[0]!.toUpperCase()}${ledger.slice(1)}`,
    nativeAsset: hbarAsset(id),
    testnet: ledger !== "mainnet",
    rpcUrls: [],
    explorerUrl: HASHSCAN_URLS[ledger],
    indexerUrl: MIRROR_NODE_URLS[ledger],
  };
}

export const HEDERA_MAINNET = network("mainnet");
export const HEDERA_TESTNET = network("testnet");
export const HEDERA_PREVIEWNET = network("previewnet");
export const HEDERA_NETWORKS: Network[] = [HEDERA_TESTNET, HEDERA_PREVIEWNET, HEDERA_MAINNET];

export function ledgerOf(networkId: NetworkId): HederaLedger {
  const ledger = networkId.split(":")[1];
  if (networkId.startsWith("hedera:") && (ledger === "mainnet" || ledger === "testnet" || ledger === "previewnet")) {
    return ledger;
  }
  throw new Error(`Not a Hedera network: ${networkId}`);
}

export function mirrorUrl(net: Network): string {
  return (net.indexerUrl ?? MIRROR_NODE_URLS[ledgerOf(net.id)]).replace(/\/+$/, "");
}

/** Canonical asset key for an HTS token: native USDC merges with USDC elsewhere; everything else is per-token. */
export function tokenAssetKey(networkId: NetworkId, tokenId: string): string {
  const ledger = ledgerOf(networkId);
  return USDC_TOKEN_IDS[ledger] === tokenId ? "usdc" : `hts:${tokenId}`;
}

export function hashscanTransactionUrl(net: Network, transactionId: string): string {
  return `${net.explorerUrl}/transaction/${transactionId}`;
}

/**
 * Consensus nodes and their gRPC-Web proxies, per ledger: the Hiero SDK's browser address book
 * (hiero-sdk-js v2.89.1, src/constants/ClientConstants.js: MAINNET, WEB_TESTNET, WEB_PREVIEWNET). The SDK's
 * WebClient submits through these same proxies; they answer `application/grpc-web+proto` with CORS headers.
 * The mirror node's `/api/v1/network/nodes` has a `grpc_proxy_endpoint` field for this (HIP-1046), but it is
 * still null on every network (checked 2026-10-03), so the list is static.
 */
export const GRPC_WEB_NODES: Record<HederaLedger, Record<string, string>> = {
  mainnet: {
    "0.0.3": "https://node00.swirldslabs.com:443",
    "0.0.4": "https://node01-00-grpc.swirlds.com:443",
    "0.0.7": "https://node04.swirldslabs.com:443",
    "0.0.8": "https://node05.swirldslabs.com:443",
    "0.0.9": "https://node06.swirldslabs.com:443",
    "0.0.10": "https://node07.swirldslabs.com:443",
    "0.0.12": "https://node09.swirldslabs.com:443",
    "0.0.13": "https://node10.swirldslabs.com:443",
    "0.0.14": "https://node11.swirldslabs.com:443",
    "0.0.15": "https://node12.swirldslabs.com:443",
    "0.0.18": "https://node15.swirldslabs.com:443",
    "0.0.20": "https://node17.swirldslabs.com:443",
    "0.0.21": "https://node18.swirldslabs.com:443",
    "0.0.22": "https://node19.swirldslabs.com:443",
    "0.0.23": "https://node20.swirldslabs.com:443",
    "0.0.24": "https://node21.swirldslabs.com:443",
    "0.0.25": "https://node22.swirldslabs.com:443",
    "0.0.28": "https://node25.swirldslabs.com:443",
    "0.0.29": "https://node26.swirldslabs.com:443",
    "0.0.31": "https://node28.swirldslabs.com:443",
    "0.0.33": "https://node30.swirldslabs.com:443",
    "0.0.34": "https://node31.swirldslabs.com:443",
    "0.0.35": "https://node32.swirldslabs.com:443",
    "0.0.36": "https://node33.swirldslabs.com:443",
    "0.0.37": "https://node34.swirldslabs.com:443",
  },
  testnet: {
    "0.0.3": "https://testnet-node00-00-grpc.hedera.com:443",
    "0.0.4": "https://testnet-node01-00-grpc.hedera.com:443",
    "0.0.5": "https://testnet-node02-00-grpc.hedera.com:443",
    "0.0.6": "https://testnet-node03-00-grpc.hedera.com:443",
    "0.0.7": "https://testnet-node04-00-grpc.hedera.com:443",
    "0.0.8": "https://testnet-node05-00-grpc.hedera.com:443",
    "0.0.9": "https://testnet-node06-00-grpc.hedera.com:443",
  },
  previewnet: {
    "0.0.3": "https://previewnet-node00-00-grpc.hedera.com:443",
    "0.0.4": "https://previewnet-node01-00-grpc.hedera.com:443",
    "0.0.5": "https://previewnet-node02-00-grpc.hedera.com:443",
    "0.0.6": "https://previewnet-node03-00-grpc.hedera.com:443",
    "0.0.7": "https://previewnet-node04-00-grpc.hedera.com:443",
    "0.0.8": "https://previewnet-node05-00-grpc.hedera.com:443",
    "0.0.9": "https://previewnet-node06-00-grpc.hedera.com:443",
  },
};

/** How many nodes a new transaction is frozen for: each is a separate body to sign, and the spares are retries. */
export const NODES_PER_TRANSACTION = 5;
