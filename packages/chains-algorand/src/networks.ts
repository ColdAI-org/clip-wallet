import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";
import { b64decode, b64url } from "./util.js";

/**
 * Algorand networks.
 *  - CAIP-2 (ChainAgnostic namespaces, algorand/caip2.md): "algorand:" + the first 32 characters of the genesis hash
 *    re-encoded as URL-safe base64. Test cases there: MainNet wGHE2Pwdvd7S12BL5FaOP20EGYesN73k, TestNet
 *    SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe. WalletConnect v2 uses the same ids.
 *  - ARC-25 numeric WalletConnect v1 chain ids: 416001 MainNet, 416002 TestNet, 4160 "any Algorand chain" (legacy).
 *  - Genesis hash / id verified with GET /v2/transactions/params on the Nodely endpoints below.
 */
export type AlgorandNet = "mainnet" | "testnet";

export interface AlgorandNetSpec {
  caip2: NetworkId;
  genesisHash: string;
  genesisId: string;
  /** ARC-25 WalletConnect v1 chain id. */
  wcV1ChainId: number;
  algod: string;
  indexer: string;
  explorer: string;
  /** Circle USDC ASA id (developers.circle.com/stablecoins/usdc-contract-addresses). */
  usdc: string;
}

export const ALGORAND_NETS: Record<AlgorandNet, AlgorandNetSpec> = {
  testnet: {
    caip2: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe",
    genesisHash: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
    genesisId: "testnet-v1.0",
    wcV1ChainId: 416002,
    algod: "https://testnet-api.4160.nodely.dev",
    indexer: "https://testnet-idx.4160.nodely.dev",
    explorer: "https://lora.algokit.io/testnet",
    usdc: "10458941",
  },
  mainnet: {
    caip2: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k",
    genesisHash: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
    genesisId: "mainnet-v1.0",
    wcV1ChainId: 416001,
    algod: "https://mainnet-api.4160.nodely.dev",
    indexer: "https://mainnet-idx.4160.nodely.dev",
    explorer: "https://lora.algokit.io/mainnet",
    usdc: "31566704",
  },
};

/** CAIP-2 id for any genesis hash (standard base64). */
export function caip2FromGenesisHash(genesisHash: string | Uint8Array): NetworkId {
  const bytes = typeof genesisHash === "string" ? b64decode(genesisHash) : genesisHash;
  return `algorand:${b64url(bytes).slice(0, 32)}`;
}

export function algoAsset(networkId: NetworkId): AssetRef {
  return { key: "algo", symbol: "ALGO", name: "Algorand", decimals: 6, networkId };
}

function network(net: AlgorandNet): Network {
  const c = ALGORAND_NETS[net];
  return {
    id: c.caip2,
    family: "algorand",
    name: net === "mainnet" ? "Algorand" : "Algorand TestNet",
    nativeAsset: algoAsset(c.caip2),
    testnet: net !== "mainnet",
    rpcUrls: [c.algod],
    explorerUrl: c.explorer,
    indexerUrl: c.indexer,
  };
}

export const ALGORAND_TESTNET = network("testnet");
export const ALGORAND_MAINNET = network("mainnet");
export const ALGORAND_NETWORKS: Network[] = [ALGORAND_TESTNET, ALGORAND_MAINNET];

/**
 * Accepts a CAIP-2 id, a genesis hash (base64 or base64url, with or without "algorand:"), a genesis id
 * ("testnet-v1.0") or an ARC-25 numeric chain id (416001/416002; 4160 is ambiguous and returns null).
 */
export function netOf(chainId: string | number): AlgorandNet | null {
  for (const [name, c] of Object.entries(ALGORAND_NETS) as [AlgorandNet, AlgorandNetSpec][]) {
    if (typeof chainId === "number") {
      if (chainId === c.wcV1ChainId) return name;
      continue;
    }
    const id = chainId.replace(/^algorand:/, "");
    if (`algorand:${id}` === c.caip2 || id === c.genesisHash || id === c.genesisId || id === String(c.wcV1ChainId)) return name;
    if (id.length >= 32 && `algorand:${id.replace(/\+/g, "-").replace(/\//g, "_").slice(0, 32)}` === c.caip2) return name;
  }
  return null;
}

export function fromChainId(chainId: string | number): NetworkId | null {
  const n = netOf(chainId);
  return n ? ALGORAND_NETS[n].caip2 : null;
}

export function specFor(networkId: NetworkId): AlgorandNetSpec | null {
  const n = netOf(networkId);
  return n ? ALGORAND_NETS[n] : null;
}

/** "usdc" for Circle's USDC ASA on that network, otherwise "asa:<id>". */
export function asaAssetKey(networkId: NetworkId, assetId: string | bigint | number): string {
  const s = specFor(networkId);
  return s && s.usdc === String(assetId) ? "usdc" : `asa:${assetId}`;
}

export function explorerTxUrl(net: Network, txId: string): string {
  return `${net.explorerUrl}/transaction/${txId}`;
}
