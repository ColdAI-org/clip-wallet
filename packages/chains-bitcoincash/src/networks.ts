import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";
import type { CashPrefix } from "./cashaddr.js";

/**
 * Bitcoin Cash networks.
 *
 * Ids are CAIP-2 `bip122:` + the first 32 hex characters of a block hash (BIP-122). BCH shares Bitcoin's genesis, so
 * the ChainAgnostic bip122 namespace (bip122/caip2.md, test cases) names BCH mainnet by its first own block, 478559:
 * `bip122:000000000000000000651ef99cb9fcbe`. The same rule gives chipnet its first block after it split from
 * testnet4 (height 115252, 00000000040ba964…; found by comparing both chains' headers on Fulcrum, 2026-10) and
 * testnet4 its genesis (000000001dd410c4…). None collides with chains-bitcoin's ids.
 *
 * The BCH wallet community's WalletConnect spec (wc2-bch-bcr, Cashonize/Paytaca,
 * https://github.com/mainnet-pat/wc2-bch-bcr#pairing) names chains "bch:bitcoincash" (mainnet) and "bch:bchtest"
 * (any testnet), carried here as `wcChain`.
 *
 * Indexers: public Fulcrum servers (Electrum Cash protocol 1.4) over WebSocket, each checked with server.version,
 * blockchain.scripthash.get_balance, blockchain.headers.get_tip and blockchain.relayfee (2026-10). They're tried in
 * order; the next one is used when one can't be reached.
 */
export type BchNet = "mainnet" | "chipnet" | "testnet4";

export interface BchNetSpec {
  caip2: NetworkId;
  prefix: CashPrefix;
  wcChain: "bch:bitcoincash" | "bch:bchtest";
  electrum: string[];
  explorer: string;
}

export const BCH_NETS: Record<BchNet, BchNetSpec> = {
  mainnet: {
    caip2: "bip122:000000000000000000651ef99cb9fcbe",
    prefix: "bitcoincash",
    wcChain: "bch:bitcoincash",
    electrum: ["wss://bch.imaginary.cash:50004", "wss://electrum.imaginary.cash:50004", "wss://bch.loping.net:50004", "wss://bch.soul-dev.com:50004"],
    explorer: "https://bch.loping.net",
  },
  chipnet: {
    caip2: "bip122:00000000040ba9641ba98a37b2e5ceea",
    prefix: "bchtest",
    wcChain: "bch:bchtest",
    electrum: ["wss://chipnet.imaginary.cash:50004", "wss://chipnet.bch.ninja:50004", "wss://chipnet.c3-soft.com:64004", "wss://cbch.loping.net:62104"],
    explorer: "https://cbch.loping.net",
  },
  testnet4: {
    caip2: "bip122:000000001dd410c49a788668ce267517",
    prefix: "bchtest",
    wcChain: "bch:bchtest",
    electrum: ["wss://testnet4.imaginary.cash:50004", "wss://tbch4.loping.net:62004"],
    explorer: "https://tbch4.loping.net",
  },
};

export function bchAsset(networkId: NetworkId): AssetRef {
  return { key: "bch", symbol: "BCH", name: "Bitcoin Cash", decimals: 8, networkId };
}

const NAMES: Record<BchNet, string> = { mainnet: "Bitcoin Cash", chipnet: "Bitcoin Cash Chipnet", testnet4: "Bitcoin Cash Testnet4" };

function network(net: BchNet): Network {
  const c = BCH_NETS[net];
  return { id: c.caip2, family: "bitcoincash", name: NAMES[net], nativeAsset: bchAsset(c.caip2), testnet: net !== "mainnet", rpcUrls: [...c.electrum], explorerUrl: c.explorer };
}

export const BCH_MAINNET = network("mainnet");
export const BCH_CHIPNET = network("chipnet");
export const BCH_TESTNET4 = network("testnet4");
/** Chipnet first: it's where BCH developers test upcoming upgrades, and the wallet's default test network. */
export const BCH_NETWORKS: Network[] = [BCH_CHIPNET, BCH_TESTNET4, BCH_MAINNET];

export function netOf(networkId: NetworkId): BchNet | null {
  for (const [n, c] of Object.entries(BCH_NETS) as [BchNet, BchNetSpec][]) if (c.caip2 === networkId) return n;
  return null;
}

export function specFor(networkId: NetworkId): BchNetSpec | null {
  const n = netOf(networkId);
  return n ? BCH_NETS[n] : null;
}

export function explorerTxUrl(networkId: NetworkId, txid: string): string {
  return `${(specFor(networkId) ?? BCH_NETS.chipnet).explorer}/tx/${txid}`;
}

/** CashToken AssetRef (fungible part). Category ids are shown as-is; names come from nowhere trusted, so none. */
export function cashTokenAsset(networkId: NetworkId, category: string): AssetRef {
  return { key: `cashtoken:${category}`, symbol: `CT-${category.slice(0, 6)}`, name: `CashToken ${category.slice(0, 8)}…`, decimals: 0, networkId, address: category };
}
