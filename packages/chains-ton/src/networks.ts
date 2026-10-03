import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * TON networks.
 *
 *  - NetworkId `ton:<global_id>`: `ton:-239` (mainnet) and `ton:-3` (testnet), as WalletConnect/Reown's TON
 *    reference uses. TON Connect itself carries the bare global_id string ("-239" / "-3", NETWORK enum in
 *    ton-connect/docs spec/connect.md). ChainAgnostic's namespace is `tvm:<global_id>`; `fromChainId` accepts all three.
 *  - The native coin was renamed Toncoin → Gram (ticker GRAM) on 2026-06-15 after the TON community vote. Same coin,
 *    same 9 decimals (nanograms); only the name and ticker changed.
 *  - Public, keyless endpoints (rate-limited to about 1 request per second each): toncenter (v2 JSON API for
 *    broadcasting and fee estimates, v3 indexer for wallet state) and tonapi.io (jettons, NFTs, emulation).
 */
export type TonNet = "mainnet" | "testnet";

export const TON_NETS: Record<TonNet, { caip2: NetworkId; globalId: number; toncenter: string; tonapi: string; explorer: string }> = {
  mainnet: { caip2: "ton:-239", globalId: -239, toncenter: "https://toncenter.com/api", tonapi: "https://tonapi.io", explorer: "https://tonviewer.com" },
  testnet: {
    caip2: "ton:-3",
    globalId: -3,
    toncenter: "https://testnet.toncenter.com/api",
    tonapi: "https://testnet.tonapi.io",
    explorer: "https://testnet.tonviewer.com",
  },
};

export function gramAsset(networkId: NetworkId): AssetRef {
  return { key: "gram", symbol: "GRAM", name: "Gram", decimals: 9, networkId };
}

function network(n: TonNet): Network {
  const c = TON_NETS[n];
  return {
    id: c.caip2,
    family: "ton",
    name: n === "mainnet" ? "TON" : "TON Testnet",
    nativeAsset: gramAsset(c.caip2),
    testnet: n === "testnet",
    rpcUrls: [c.toncenter],
    explorerUrl: c.explorer,
    indexerUrl: c.tonapi,
  };
}

export const TON_MAINNET = network("mainnet");
export const TON_TESTNET = network("testnet");
export const TON_NETWORKS: Network[] = [TON_TESTNET, TON_MAINNET];

/** Accepts `ton:-3`, `tvm:-3` or the bare TON Connect global_id `-3`. */
export function netOf(id: string): TonNet | null {
  const v = id.trim().replace(/^(ton|tvm):/, "");
  for (const [name, c] of Object.entries(TON_NETS) as [TonNet, (typeof TON_NETS)[TonNet]][]) if (v === String(c.globalId)) return name;
  return null;
}

export function fromChainId(id: string): NetworkId | null {
  const n = netOf(id);
  return n ? TON_NETS[n].caip2 : null;
}

/** TON Connect NETWORK_ID ("-239" / "-3") for a NetworkId. */
export function tonConnectNetwork(networkId: NetworkId): string {
  const n = netOf(networkId);
  if (!n) throw new Error(`Not a TON network: ${networkId}`);
  return String(TON_NETS[n].globalId);
}

export function endpoints(net: Network): { toncenter: string; tonapi: string; globalId: number; testnet: boolean } {
  const n = netOf(net.id);
  if (!n) throw new Error(`Not a TON network: ${net.id}`);
  return { toncenter: net.rpcUrls[0] ?? TON_NETS[n].toncenter, tonapi: net.indexerUrl ?? TON_NETS[n].tonapi, globalId: TON_NETS[n].globalId, testnet: n === "testnet" };
}

/** Tether's native USD₮ jetton (master from tonapi /v2/jettons, 6 decimals). No curated testnet jettons. */
export const CURATED_JETTONS: { net: TonNet; master: string; key: string; symbol: string; name: string; decimals: number }[] = [
  { net: "mainnet", master: "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe", key: "usdt", symbol: "USD₮", name: "Tether USD", decimals: 6 },
];

export function explorerTxUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/transaction/${hash}`;
}
