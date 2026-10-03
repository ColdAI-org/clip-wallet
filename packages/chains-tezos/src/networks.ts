import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Tezos networks. CAIP-2 (ChainAgnostic namespaces, tezos/caip2.md): "tezos:" + the full base58 chain id
 * ("Net…", 15 characters), checked with GET /chains/main/chain_id on each RPC (Oct 2026).
 *
 * Testnets: Ghostnet has been retired (it is gone from teztnets.com/teztnets.json and its RPC / TzKT no longer
 * answer). Shadownet is the long-running testnet for applications ("For applications testing, you will be best off
 * on shadownet", teztnets.com). Protocol testnets (e.g. ushuaianet) are short-lived and not listed.
 */
export const TEZOS_CHAIN_IDS = {
  mainnet: "NetXdQprcVkpaWU",
  shadownet: "NetXsqzbfFenSTS",
} as const;

export type TezosNetworkName = keyof typeof TEZOS_CHAIN_IDS;

export function xtzAsset(networkId: NetworkId): AssetRef {
  return { key: "xtz", symbol: "XTZ", name: "Tezos", decimals: 6, networkId };
}

export const TEZOS_SHADOWNET: Network = {
  id: `tezos:${TEZOS_CHAIN_IDS.shadownet}`,
  family: "tezos",
  name: "Tezos Shadownet",
  nativeAsset: xtzAsset(`tezos:${TEZOS_CHAIN_IDS.shadownet}`),
  testnet: true,
  rpcUrls: ["https://rpc.shadownet.teztnets.com", "https://rpc.tzkt.io/shadownet"],
  explorerUrl: "https://shadownet.tzkt.io",
  indexerUrl: "https://api.shadownet.tzkt.io",
};

export const TEZOS_MAINNET: Network = {
  id: `tezos:${TEZOS_CHAIN_IDS.mainnet}`,
  family: "tezos",
  name: "Tezos",
  nativeAsset: xtzAsset(`tezos:${TEZOS_CHAIN_IDS.mainnet}`),
  testnet: false,
  rpcUrls: ["https://rpc.tzbeta.net", "https://rpc.tzkt.io/mainnet"],
  explorerUrl: "https://tzkt.io",
  indexerUrl: "https://api.tzkt.io",
};

/** Testnets first. */
export const TEZOS_NETWORKS: Network[] = [TEZOS_SHADOWNET, TEZOS_MAINNET];

const BY_NAME: Record<TezosNetworkName, Network> = { mainnet: TEZOS_MAINNET, shadownet: TEZOS_SHADOWNET };

export function networkNameOf(networkId: NetworkId): TezosNetworkName | null {
  for (const [name, id] of Object.entries(TEZOS_CHAIN_IDS) as [TezosNetworkName, string][]) {
    if (networkId === `tezos:${id}`) return name;
  }
  return null;
}

/** Accepts "tezos:Net…", a bare chain id, or the "tezos:mainnet"/"tezos:shadownet" aliases some WalletConnect dapps send. */
export function fromChainId(chainId: string): NetworkId | null {
  const ref = chainId.startsWith("tezos:") ? chainId.slice(6) : chainId;
  for (const [name, id] of Object.entries(TEZOS_CHAIN_IDS) as [TezosNetworkName, string][]) {
    if (ref === id || ref === name) return `tezos:${id}`;
  }
  return null;
}

/** Beacon (`@airgap/beacon-types` NetworkType) name for one of our networks. */
export function beaconNetworkType(networkId: NetworkId): string | undefined {
  return networkNameOf(networkId) ?? undefined;
}

/**
 * Beacon network → NetworkId. "custom" matches when its rpcUrl is one of ours. "ghostnet" (retired) and other
 * protocol testnets return undefined.
 */
export function fromBeaconNetwork(n: { type: string; rpcUrl?: string }): NetworkId | undefined {
  if (n.type === "mainnet" || n.type === "shadownet") return BY_NAME[n.type].id;
  if (n.type === "custom" && n.rpcUrl) {
    const url = n.rpcUrl.replace(/\/+$/, "");
    return TEZOS_NETWORKS.find((net) => net.rpcUrls.some((r) => r === url))?.id;
  }
  return undefined;
}

/**
 * Tokens that share a cross-network asset key: only the issuer's own token. Circle has no USDC on Tezos L1
 * (developers.circle.com/stablecoins/usdc-contract-addresses), so no "usdc" here. USDt on Tezos is issued by
 * Tether itself (FA2 KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o, token 0, 6 decimals, checked on TzKT).
 */
export const KNOWN_TOKENS: { networkId: NetworkId; contract: string; tokenId: string; key: string; symbol: string; name: string; decimals: number; standard: "fa1.2" | "fa2" }[] = [
  {
    networkId: TEZOS_MAINNET.id,
    contract: "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o",
    tokenId: "0",
    key: "usdt",
    symbol: "USDt",
    name: "Tether USD",
    decimals: 6,
    standard: "fa2",
  },
  {
    networkId: TEZOS_MAINNET.id,
    contract: "KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn",
    tokenId: "0",
    key: "fa:KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn:0",
    symbol: "tzBTC",
    name: "tzBTC",
    decimals: 8,
    standard: "fa1.2",
  },
];

/** "fa:<KT1>:<tokenId>" unless it's a known issuer-native token. */
export function tokenAssetKey(networkId: NetworkId, contract: string, tokenId: string): string {
  return KNOWN_TOKENS.find((t) => t.networkId === networkId && t.contract === contract && t.tokenId === tokenId)?.key ?? `fa:${contract}:${tokenId}`;
}

/** Contract and token id of a token AssetRef (key "fa:<KT1>:<id>", or a known key like "usdt"). */
export function tokenRef(asset: AssetRef): { contract: string; tokenId: string } | null {
  const m = /^fa:(KT1[1-9A-HJ-NP-Za-km-z]{33}):(\d+)$/.exec(asset.key);
  if (m) return { contract: m[1]!, tokenId: m[2]! };
  const k = KNOWN_TOKENS.find((t) => t.networkId === asset.networkId && t.key === asset.key);
  if (k) return { contract: k.contract, tokenId: k.tokenId };
  if (asset.address?.startsWith("KT1")) {
    const [contract, tokenId = "0"] = asset.address.split(":");
    return { contract: contract!, tokenId };
  }
  return null;
}

export function explorerOperationUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/${hash}`;
}
