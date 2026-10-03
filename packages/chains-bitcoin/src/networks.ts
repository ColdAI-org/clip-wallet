/**
 * Bitcoin networks. CAIP-2 ids are `bip122:` + the first 32 hex chars of the genesis block hash
 * (CAIP-4). Genesis hashes checked against mempool.space `/api/block-height/0` (2026-10-03):
 *   mainnet  000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f
 *   testnet4 00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043
 *   signet   00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6
 *
 * `rpcUrls` are Esplora-compatible REST bases (mempool.space / blockstream.info), tried in order.
 */
import type { AssetRef, Network } from "@clip-wallet/core";
import { NETWORK, TEST_NETWORK } from "@scure/btc-signer";

export const BITCOIN_MAINNET = "bip122:000000000019d6689c085ae165831e93";
export const BITCOIN_TESTNET4 = "bip122:00000000da84f2bafbbc53dee25a72ae";
export const BITCOIN_SIGNET = "bip122:00000008819873e925422c1ff0f99f7c";

const btc = (networkId: string, testnet: boolean): AssetRef => ({
  key: testnet ? "btc-testnet" : "btc",
  symbol: "BTC",
  name: testnet ? "Test Bitcoin" : "Bitcoin",
  decimals: 8,
  networkId,
});

export const BITCOIN_NETWORKS: Network[] = [
  {
    id: BITCOIN_MAINNET,
    family: "bitcoin",
    name: "Bitcoin",
    nativeAsset: btc(BITCOIN_MAINNET, false),
    testnet: false,
    rpcUrls: ["https://mempool.space/api", "https://blockstream.info/api"],
    explorerUrl: "https://mempool.space",
    indexerUrl: "https://mempool.space/api",
  },
  {
    id: BITCOIN_TESTNET4,
    family: "bitcoin",
    name: "Bitcoin Testnet4",
    nativeAsset: btc(BITCOIN_TESTNET4, true),
    testnet: true,
    rpcUrls: ["https://mempool.space/testnet4/api"],
    explorerUrl: "https://mempool.space/testnet4",
    indexerUrl: "https://mempool.space/testnet4/api",
  },
  {
    id: BITCOIN_SIGNET,
    family: "bitcoin",
    name: "Bitcoin Signet",
    nativeAsset: btc(BITCOIN_SIGNET, true),
    testnet: true,
    rpcUrls: ["https://mempool.space/signet/api", "https://blockstream.info/signet/api"],
    explorerUrl: "https://mempool.space/signet",
    indexerUrl: "https://mempool.space/signet/api",
  },
];

export const networkById = (id: string): Network | undefined => BITCOIN_NETWORKS.find((n) => n.id === id);

/** Address encoding parameters (bech32 hrp, base58 versions) for a network. Testnet4 and signet share "tb". */
export const btcNet = (network: Network) => (network.testnet ? TEST_NETWORK : NETWORK);
