import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * TRON networks.
 *
 * Ids: the CAIP-2 `tron:` namespace as WalletConnect / Reown use it, "tron:" + the TRON chain id in hex, i.e. the last
 * 4 bytes of the genesis block id (the value TRON's `eth_chainId` returns and TIP-1193 / TIP-3326 use):
 *  - Reown TRON RPC reference (chainId "tron:0xcd8690dc" for Nile):
 *    https://github.com/reown-com/reown-docs/blob/main/advanced/multichain/rpc-reference/tron-rpc.mdx
 *  - tronwallet-adapter's WalletConnect adapter (`tron:${chainId}`, mainnet 0x2b6653dc / Shasta 0x94a9059e / Nile
 *    0xcd8690dc): https://github.com/tronweb3/tronwallet-adapter/blob/main/packages/adapters/walletconnect/src/adapter.ts
 *  - ChainAgnostic namespaces/tron/caip2.md (Draft, 2026-01) writes the same chain ids in decimal ("tron:728126428").
 *    `fromChainId` accepts both spellings and the bare hex / decimal chain id.
 * Genesis block ids were checked with POST /wallet/getblockbynum {"num":0} on every endpoint below
 * (mainnet …1ebf88508a03865c71d452e25f4d51194196a1d22b6653dc, Nile …d698d4192c56cb6be724a558448e2684802de4d6cd8690dc,
 * Shasta …de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e).
 *
 * Endpoints: full-node HTTP API without an API key (TronGrid answers keyless requests, rate-limited). Second endpoints
 * answer the same /wallet and /walletsolidity paths: TRON's own api.nileex.io (Nile) and api.tronstack.io /
 * tron-rpc.publicnode.com (mainnet). Only TronGrid and api.nileex.io answer /wallet/estimateenergy; the module falls
 * back to /wallet/triggerconstantcontract elsewhere.
 */
export type TronNet = "mainnet" | "nile" | "shasta";

export interface TronNetSpec {
  caip2: NetworkId;
  /** TRON chain id: last 4 bytes of the genesis block id, "0x…" (eth_chainId). */
  chainId: string;
  /** Full genesis block id (hex). */
  genesisBlockId: string;
  rpc: string[];
  explorer: string;
  /** Tether USDT (TRC-20) on mainnet; the Nile faucet's USDT test token on Nile. */
  usdt?: string;
}

export const TRON_NETS: Record<TronNet, TronNetSpec> = {
  nile: {
    caip2: "tron:0xcd8690dc",
    chainId: "0xcd8690dc",
    genesisBlockId: "0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc",
    rpc: ["https://nile.trongrid.io", "https://api.nileex.io"],
    explorer: "https://nile.tronscan.org",
    // "USDT test tokens (trc20, token address: TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf)": https://nileex.io/join/getJoinPage
    usdt: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  },
  shasta: {
    caip2: "tron:0x94a9059e",
    chainId: "0x94a9059e",
    genesisBlockId: "0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e",
    rpc: ["https://api.shasta.trongrid.io"],
    explorer: "https://shasta.tronscan.org",
  },
  mainnet: {
    caip2: "tron:0x2b6653dc",
    chainId: "0x2b6653dc",
    genesisBlockId: "00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc",
    rpc: ["https://api.trongrid.io", "https://api.tronstack.io", "https://tron-rpc.publicnode.com"],
    explorer: "https://tronscan.org",
    // Tether USDT on TRON: https://tether.to/en/supported-protocols
    usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  },
};

export function trxAsset(networkId: NetworkId): AssetRef {
  return { key: "trx", symbol: "TRX", name: "TRON", decimals: 6, networkId };
}

/** Tether USDT (mainnet) shares the "usdt" key; the Nile test token is its own asset, never merged with real USDT. */
export function usdtAsset(networkId: NetworkId): AssetRef | null {
  const s = specFor(networkId);
  if (!s?.usdt) return null;
  const mainnet = s.caip2 === TRON_NETS.mainnet.caip2;
  return { key: mainnet ? "usdt" : `trc20:${s.usdt}`, symbol: "USDT", name: mainnet ? "Tether USD" : "Tether USD (Nile test token)", decimals: 6, networkId, address: s.usdt };
}

function network(net: TronNet): Network {
  const c = TRON_NETS[net];
  return {
    id: c.caip2,
    family: "tron",
    name: net === "mainnet" ? "TRON" : net === "nile" ? "TRON Nile Testnet" : "TRON Shasta Testnet",
    nativeAsset: trxAsset(c.caip2),
    testnet: net !== "mainnet",
    rpcUrls: c.rpc,
    explorerUrl: c.explorer,
  };
}

export const TRON_NILE = network("nile");
export const TRON_SHASTA = network("shasta");
export const TRON_MAINNET = network("mainnet");
/** Testnets first: testnet by default. */
export const TRON_NETWORKS: Network[] = [TRON_NILE, TRON_SHASTA, TRON_MAINNET];

/**
 * Accepts "tron:0xcd8690dc", "tron:3448148188", "0xcd8690dc", "3448148188", a full genesis block id, or a name
 * ("nile", "shasta", "mainnet").
 */
export function netOf(chainId: string | number): TronNet | null {
  let raw = String(chainId).trim().replace(/^tron:/i, "").toLowerCase();
  if ((Object.keys(TRON_NETS) as TronNet[]).includes(raw as TronNet)) return raw as TronNet;
  if (/^[0-9a-f]{64}$/.test(raw)) raw = `0x${raw.slice(-8)}`;
  let n: number | null = null;
  if (/^0x[0-9a-f]{1,8}$/.test(raw)) n = parseInt(raw.slice(2), 16);
  else if (/^\d{1,10}$/.test(raw)) n = Number(raw);
  if (n === null) return null;
  for (const [name, c] of Object.entries(TRON_NETS) as [TronNet, TronNetSpec][]) if (parseInt(c.chainId.slice(2), 16) === n) return name;
  return null;
}

export function fromChainId(chainId: string | number): NetworkId | null {
  const n = netOf(chainId);
  return n ? TRON_NETS[n].caip2 : null;
}

export function specFor(networkId: NetworkId): TronNetSpec | null {
  const n = netOf(networkId);
  return n ? TRON_NETS[n] : null;
}

/** The "0x…" chain id dapps see (TIP-1193 connect/chainChanged, eth_chainId). */
export function chainIdHex(networkId: NetworkId): string | null {
  return specFor(networkId)?.chainId ?? null;
}

export function explorerTxUrl(net: Network, txId: string): string {
  return `${net.explorerUrl}/#/transaction/${txId}`;
}
