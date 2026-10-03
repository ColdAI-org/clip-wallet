import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Cardano networks. CAIP-2 ids use the CIP-34 form `cip34:<NetworkId>-<NetworkMagic>` (CIP-0034 registry.json;
 * WalletConnect uses the same "cip34" namespace). ChainAgnostic/namespaces has no Cardano entry.
 * Indexer: Koios public tier (no API key; 5,000 requests/day, 100 per 10 s per IP). Its CORS restriction does not
 * apply to an extension background with host permissions.
 */
export type CardanoNet = "mainnet" | "preprod" | "preview";

export const CARDANO_NETS: Record<
  CardanoNet,
  { caip2: NetworkId; networkId: 0 | 1; magic: number; genesisHash: string; koios: string; explorer: string }
> = {
  mainnet: {
    caip2: "cip34:1-764824073",
    networkId: 1,
    magic: 764824073,
    genesisHash: "5f20df933584822601f9e3f8c024eb5eb252fe8cefb24d1317dc3d432e940ebb",
    koios: "https://api.koios.rest/api/v1",
    explorer: "https://cardanoscan.io",
  },
  preprod: {
    caip2: "cip34:0-1",
    networkId: 0,
    magic: 1,
    genesisHash: "d4b8de7a11d929a323373cbab6c1a9bdc931beffff11db111cf9d57356ee1937",
    koios: "https://preprod.koios.rest/api/v1",
    explorer: "https://preprod.cardanoscan.io",
  },
  preview: {
    caip2: "cip34:0-2",
    networkId: 0,
    magic: 2,
    genesisHash: "72593f260b66f26bef4fc50b38a8f24d3d3633ad2e854eaf73039eb9402706f1",
    koios: "https://preview.koios.rest/api/v1",
    explorer: "https://preview.cardanoscan.io",
  },
};

export function adaAsset(networkId: NetworkId): AssetRef {
  return { key: "ada", symbol: "ADA", name: "Cardano", decimals: 6, networkId };
}

function network(n: CardanoNet): Network {
  const c = CARDANO_NETS[n];
  return {
    id: c.caip2,
    family: "cardano",
    name: n === "mainnet" ? "Cardano" : `Cardano ${n === "preprod" ? "Preprod" : "Preview"}`,
    nativeAsset: adaAsset(c.caip2),
    testnet: n !== "mainnet",
    rpcUrls: [c.koios],
    explorerUrl: c.explorer,
    indexerUrl: c.koios,
  };
}

export const CARDANO_MAINNET = network("mainnet");
export const CARDANO_PREPROD = network("preprod");
export const CARDANO_PREVIEW = network("preview");
export const CARDANO_NETWORKS: Network[] = [CARDANO_PREPROD, CARDANO_PREVIEW, CARDANO_MAINNET];

export function netOf(networkId: NetworkId): CardanoNet | null {
  for (const [k, v] of Object.entries(CARDANO_NETS) as [CardanoNet, (typeof CARDANO_NETS)[CardanoNet]][]) {
    if (v.caip2 === networkId) return k;
  }
  return null;
}

/** The address-level network id (0 testnets, 1 mainnet) for a NetworkId. */
export function addressNetworkId(networkId: NetworkId): 0 | 1 {
  const n = netOf(networkId);
  if (!n) throw new Error(`Not a Cardano network: ${networkId}`);
  return CARDANO_NETS[n].networkId;
}

/** Native assets are keyed by their unit (policy id + asset name hex): `cnt:<unit>`. */
export function tokenAssetKey(unit: string): string {
  return `cnt:${unit.toLowerCase()}`;
}

export function explorerTxUrl(net: Network, txHash: string): string {
  return `${net.explorerUrl}/transaction/${txHash}`;
}
