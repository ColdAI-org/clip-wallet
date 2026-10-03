import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Substrate networks. CAIP-2 (ChainAgnostic namespaces, polkadot/caip2.md): `polkadot:` + the first 32 hex
 * characters of the genesis hash. Genesis hashes, SS58 formats, decimals and symbols were read on 2026-10-03 with
 * chain_getBlockHash(0) and system_properties against the RPC endpoints below. Paseo's genesis was confirmed on
 * two independent providers (Dwellir, Stakeworld).
 *
 * Since the Asset Hub migration, staking and nomination pools live on each Asset Hub; the relay chains keep
 * balances and transfers. The module reads pallets from metadata, so it follows wherever they are.
 */
export interface SubstrateSpec {
  slug: string;
  name: string;
  genesisHash: `0x${string}`;
  ss58: number;
  symbol: string;
  decimals: number;
  /** Asset key of the native token (the same issuer's DOT on the relay and on Asset Hub share "dot"). */
  key: string;
  testnet: boolean;
  rpc: string[];
  explorer: string;
  assetHub: boolean;
  /** Curated Asset Hub assets (pallet-assets ids). */
  assets?: { id: number; symbol: string; name: string; decimals: number; key: string }[];
}

export const SUBSTRATE_SPECS: SubstrateSpec[] = [
  {
    slug: "polkadot",
    name: "Polkadot",
    genesisHash: "0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3",
    ss58: 0,
    symbol: "DOT",
    decimals: 10,
    key: "dot",
    testnet: false,
    rpc: ["https://rpc.polkadot.io"],
    explorer: "https://polkadot.subscan.io",
    assetHub: false,
  },
  {
    slug: "kusama",
    name: "Kusama",
    genesisHash: "0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe",
    ss58: 2,
    symbol: "KSM",
    decimals: 12,
    key: "ksm",
    testnet: false,
    rpc: ["https://kusama-rpc.polkadot.io"],
    explorer: "https://kusama.subscan.io",
    assetHub: false,
  },
  {
    slug: "westend",
    name: "Westend",
    genesisHash: "0xe143f23803ac50e8f6f8e62695d1ce9e4e1d68aa36c1cd2cfd15340213f3423e",
    ss58: 42,
    symbol: "WND",
    decimals: 12,
    key: "wnd",
    testnet: true,
    rpc: ["https://westend-rpc.polkadot.io"],
    explorer: "https://westend.subscan.io",
    assetHub: false,
  },
  {
    slug: "paseo",
    name: "Paseo",
    genesisHash: "0x374057be67b355151f271ff70c3db98308c62c8adc48dc6724b6a009a1a014fd",
    ss58: 42,
    symbol: "PAS",
    decimals: 10,
    key: "pas",
    testnet: true,
    rpc: ["https://paseo-rpc.n.dwellir.com", "https://pas-rpc.stakeworld.io"],
    explorer: "https://paseo.subscan.io",
    assetHub: false,
  },
  {
    slug: "polkadot-asset-hub",
    name: "Polkadot Asset Hub",
    genesisHash: "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f",
    ss58: 0,
    symbol: "DOT",
    decimals: 10,
    key: "dot",
    testnet: false,
    rpc: ["https://polkadot-asset-hub-rpc.polkadot.io"],
    explorer: "https://assethub-polkadot.subscan.io",
    assetHub: true,
    assets: [
      { id: 1337, symbol: "USDC", name: "USD Coin", decimals: 6, key: "usdc" },
      { id: 1984, symbol: "USDT", name: "Tether USD", decimals: 6, key: "usdt" },
    ],
  },
  {
    slug: "kusama-asset-hub",
    name: "Kusama Asset Hub",
    genesisHash: "0x48239ef607d7928874027a43a67689209727dfb3d3dc5e5b03a39bdc2eda771a",
    ss58: 2,
    symbol: "KSM",
    decimals: 12,
    key: "ksm",
    testnet: false,
    rpc: ["https://kusama-asset-hub-rpc.polkadot.io"],
    explorer: "https://assethub-kusama.subscan.io",
    assetHub: true,
    assets: [{ id: 1984, symbol: "USDT", name: "Tether USD", decimals: 6, key: "usdt" }],
  },
  {
    slug: "westend-asset-hub",
    name: "Westend Asset Hub",
    genesisHash: "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9",
    ss58: 42,
    symbol: "WND",
    decimals: 12,
    key: "wnd",
    testnet: true,
    rpc: ["https://westend-asset-hub-rpc.polkadot.io"],
    explorer: "https://assethub-westend.subscan.io",
    assetHub: true,
  },
  {
    slug: "paseo-asset-hub",
    name: "Paseo Asset Hub",
    genesisHash: "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
    ss58: 42,
    symbol: "PAS",
    decimals: 10,
    key: "pas",
    testnet: true,
    rpc: ["https://asset-hub-paseo-rpc.n.dwellir.com"],
    explorer: "https://assethub-paseo.subscan.io",
    assetHub: true,
  },
];

export const caip2Of = (genesisHash: string): NetworkId => `polkadot:${genesisHash.replace(/^0x/, "").slice(0, 32).toLowerCase()}`;

export function nativeAsset(spec: SubstrateSpec): AssetRef {
  return { key: spec.key, symbol: spec.symbol, name: spec.name.replace(/ Asset Hub$/, ""), decimals: spec.decimals, networkId: caip2Of(spec.genesisHash) };
}

function network(spec: SubstrateSpec): Network {
  return {
    id: caip2Of(spec.genesisHash),
    family: "substrate",
    name: spec.name,
    nativeAsset: nativeAsset(spec),
    testnet: spec.testnet,
    rpcUrls: spec.rpc,
    explorerUrl: spec.explorer,
  };
}

export const SUBSTRATE_NETWORKS: Network[] = SUBSTRATE_SPECS.map(network);
const byId = new Map(SUBSTRATE_SPECS.map((s) => [caip2Of(s.genesisHash), s]));

export function specOf(networkId: NetworkId): SubstrateSpec | null {
  return byId.get(networkId) ?? null;
}

/** Accepts a CAIP-2 id, a full genesis hash (0x…, as injectedWeb3 accounts and SignerPayloadJSON carry it) or a slug. */
export function fromChainId(chain: string): NetworkId | null {
  if (byId.has(chain)) return chain;
  if (/^0x[0-9a-f]{64}$/i.test(chain)) {
    const id = caip2Of(chain);
    return byId.get(id)?.genesisHash.toLowerCase() === chain.toLowerCase() ? id : null;
  }
  const s = SUBSTRATE_SPECS.find((x) => x.slug === chain);
  return s ? caip2Of(s.genesisHash) : null;
}

export const SUBSTRATE_NETWORK = (slug: string): Network => SUBSTRATE_NETWORKS.find((n) => specOf(n.id)?.slug === slug)!;
export const WESTEND = SUBSTRATE_NETWORK("westend");
export const PASEO = SUBSTRATE_NETWORK("paseo");
export const WESTEND_ASSET_HUB = SUBSTRATE_NETWORK("westend-asset-hub");
export const PASEO_ASSET_HUB = SUBSTRATE_NETWORK("paseo-asset-hub");
export const POLKADOT = SUBSTRATE_NETWORK("polkadot");
export const POLKADOT_ASSET_HUB = SUBSTRATE_NETWORK("polkadot-asset-hub");
export const KUSAMA = SUBSTRATE_NETWORK("kusama");
export const KUSAMA_ASSET_HUB = SUBSTRATE_NETWORK("kusama-asset-hub");

export function assetKey(networkId: NetworkId, assetId: number): string {
  return specOf(networkId)?.assets?.find((a) => a.id === assetId)?.key ?? `asset:${assetId}`;
}

export function explorerTxUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/extrinsic/${hash}`;
}
