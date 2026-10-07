import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Fuel networks (Fuel Ignition mainnet and the public Sepolia-anchored testnet).
 *
 * Ids: there is no ChainAgnostic CAIP-2 namespace for Fuel (github.com/ChainAgnostic/namespaces has none, checked
 * Oct 2026). The Fuel connector standard names a network by its numeric chain id (fuels-ts `Network.chainId`,
 * `CHAIN_IDS.fuel` = { mainnet: 9889, testnet: 0, devnet: 1119889111 } in @fuel-ts/account providers/chains.ts, the
 * same table @fuels/connectors' `DEFAULT_NETWORKS` uses), so the id here is "fuel:<chain id>".
 *
 * Chain ids, base asset and endpoints verified with `{ chain { name consensusParameters { chainId baseAssetId } } }`
 * on both GraphQL endpoints (Oct 2026: "Ignition" chainId 9889, "Fuel Sepolia Testnet" chainId 0, fuel-core 0.48.3;
 * both base assets 0xf8f8…ad07, ETH with 9 decimals).
 */
export type FuelNet = "mainnet" | "testnet";

export interface FuelToken {
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Asset id (b256, lower-case 0x-hex). */
  assetId: string;
  bridged?: boolean;
}

export interface FuelNetSpec {
  id: NetworkId;
  chainId: number;
  graphql: string;
  explorer: string;
  /** Base asset (ETH, 9 decimals): consensus parameters `baseAssetId`. */
  baseAssetId: string;
  /** Asset key of the base asset ("eth" on mainnet; the testnet copy gets its own key, as chains-evm/-starknet do). */
  baseKey: string;
  /** Curated tokens (Fuel's verified-assets list, https://verified-assets.fuel.network/assets.json, Oct 2026). */
  tokens: FuelToken[];
  faucet?: string;
}

export const BASE_ASSET_ID = "0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07";

/**
 * USDC, USDT and FUEL on Fuel are minted by Fuel's canonical bridge (contract 0x4ea6…d0e8 on mainnet, 0xd021…5471 on
 * testnet; the verified-assets list names them), so they are bridged copies: own keys, `bridged: true`, never merged
 * with the issuer's native token elsewhere (AGENTS.md "Add a token list").
 */
export const FUEL_NETS: Record<FuelNet, FuelNetSpec> = {
  testnet: {
    id: "fuel:0",
    chainId: 0,
    graphql: "https://testnet.fuel.network/v1/graphql",
    explorer: "https://app-testnet.fuel.network",
    baseAssetId: BASE_ASSET_ID,
    baseKey: "eth-testnet",
    faucet: "https://faucet-testnet.fuel.network/",
    tokens: [
      { key: "usdc.e", symbol: "USDC", name: "Bridged USDC (Fuel)", decimals: 6, assetId: "0xc26c91055de37528492e7e97d91c6f4abe34aae26f2c4d25cff6bfe45b5dc9a9", bridged: true },
      { key: "fuel", symbol: "FUEL", name: "Fuel", decimals: 9, assetId: "0x324d0c35a4299ef88138a656d5272c5a3a9ccde2630ae055dacaf9d13443d53b", bridged: true },
    ],
  },
  mainnet: {
    id: "fuel:9889",
    chainId: 9889,
    graphql: "https://mainnet.fuel.network/v1/graphql",
    explorer: "https://app.fuel.network",
    baseAssetId: BASE_ASSET_ID,
    baseKey: "eth",
    tokens: [
      { key: "usdc.e", symbol: "USDC", name: "Bridged USDC (Fuel)", decimals: 6, assetId: "0x286c479da40dc953bddc3bb4c453b608bba2e0ac483b077bd475174115395e6b", bridged: true },
      { key: "usdt.e", symbol: "USDT", name: "Bridged USDT (Fuel)", decimals: 6, assetId: "0xa0265fb5c32f6e8db3197af3c7eb05c48ae373605b8165b6f4a51c5b0ba4812e", bridged: true },
      { key: "fuel", symbol: "FUEL", name: "Fuel", decimals: 9, assetId: "0x1d5d97005e41cae2187a895fd8eab0506111e0e2f3331cd3912c15c24e3c1d82", bridged: true },
    ],
  },
};

export function ethAsset(networkId: NetworkId): AssetRef {
  const s = specFor(networkId);
  return { key: s?.baseKey ?? "eth", symbol: "ETH", name: "Ether", decimals: 9, networkId };
}

function network(net: FuelNet): Network {
  const s = FUEL_NETS[net];
  return {
    id: s.id,
    family: "fuel",
    name: net === "mainnet" ? "Fuel" : "Fuel Testnet",
    nativeAsset: ethAsset(s.id),
    testnet: net !== "mainnet",
    rpcUrls: [s.graphql],
    explorerUrl: s.explorer,
  };
}

export const FUEL_TESTNET = network("testnet");
export const FUEL_MAINNET = network("mainnet");
export const FUEL_NETWORKS: Network[] = [FUEL_TESTNET, FUEL_MAINNET];

/** "fuel:0", "0", 0, or a known GraphQL URL → the network's name; null for anything else. */
export function fuelNetOf(idOrChainId: string | number): FuelNet | null {
  for (const [name, s] of Object.entries(FUEL_NETS) as [FuelNet, FuelNetSpec][]) {
    if (typeof idOrChainId === "number") {
      if (idOrChainId === s.chainId) return name;
      continue;
    }
    const v = idOrChainId.trim();
    if (v === s.id || v === String(s.chainId) || sameUrl(v, s.graphql)) return name;
  }
  return null;
}

export function specFor(networkId: NetworkId): FuelNetSpec | null {
  const n = fuelNetOf(networkId);
  return n ? FUEL_NETS[n] : null;
}

/** The Fuel connector's `Network` shape ({ url, chainId }) for a network. */
export function connectorNetwork(net: Network): { url: string; chainId: number } {
  const s = specFor(net.id);
  return { url: net.rpcUrls[0] ?? s?.graphql ?? "", chainId: s?.chainId ?? Number(net.id.replace(/^fuel:/, "")) };
}

function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

/** Curated token by asset id, or undefined. */
export function curatedToken(networkId: NetworkId, assetId: string): FuelToken | undefined {
  const id = assetId.toLowerCase();
  return specFor(networkId)?.tokens.find((t) => t.assetId === id);
}

/** AssetRef for an asset id: ETH, a curated token, or an unknown asset shown by its short id (never merged). */
export function assetFor(networkId: NetworkId, assetId: string): AssetRef {
  const id = assetId.toLowerCase();
  const s = specFor(networkId);
  if (s && id === s.baseAssetId) return ethAsset(networkId);
  const t = curatedToken(networkId, id);
  if (t) return { key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId, address: t.assetId, ...(t.bridged ? { bridged: true } : {}) };
  const shortId = `${id.slice(0, 6)}…${id.slice(-4)}`;
  // Unverified assets: no decimals are known (they live in the minting contract's SRC-20 metadata), so base units.
  return { key: `fuel-asset:${id}`, symbol: shortId, name: `Asset ${shortId}`, decimals: 0, networkId, address: id };
}

export function explorerTxUrl(net: Network, txId: string): string {
  return `${net.explorerUrl}/tx/${txId}`;
}
