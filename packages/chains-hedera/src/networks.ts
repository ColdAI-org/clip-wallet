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
 * `rpcUrls` is empty on purpose: Hedera transactions go to consensus nodes over gRPC through the SDK's built-in
 * node list; reads go to the mirror node (`indexerUrl`).
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
