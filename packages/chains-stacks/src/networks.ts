import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Stacks networks.
 *  - CAIP-2 (ChainAgnostic namespaces, stacks/caip2.md): "stacks:" + the chain id in decimal, the `network_id` of
 *    GET /v2/info. Test cases there: mainnet `stacks:1`, testnet `stacks:2147483648` (0x80000000). Checked on
 *    api.hiro.so and api.testnet.hiro.so (2026-10).
 *  - Transaction version byte (SIP-005): 0x00 mainnet, 0x80 testnet. Address versions: SP (22) / ST (26).
 *  - Hiro's public API needs no key for these read and broadcast calls (rate-limited per IP).
 */
export type StacksNetName = "mainnet" | "testnet";

export interface StacksNetSpec {
  caip2: NetworkId;
  chainId: number;
  api: string;
  explorer: string;
  /** Curated SIP-010 tokens (the rest of an account's tokens are shown as spam-checked "other"). */
  tokens: StacksToken[];
}

export interface StacksToken {
  /** "SP….contract::asset-name" */
  assetId: string;
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  bridged?: boolean;
}

export const STACKS_NETS: Record<StacksNetName, StacksNetSpec> = {
  mainnet: {
    caip2: "stacks:1",
    chainId: 0x00000001,
    api: "https://api.hiro.so",
    explorer: "https://explorer.hiro.so",
    tokens: [
      // sBTC: docs.stacks.co/learn/sbtc/clarity-contracts ("Deployed Mainnet Contracts"), 8 decimals, 1:1 BTC.
      { assetId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token", key: "sbtc", symbol: "sBTC", name: "sBTC", decimals: 8, bridged: true },
      // USDCx (Circle xReserve): docs.stacks.co/learn/bridging/usdcx/contracts, mainnet token contract.
      { assetId: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx-token", key: "usdcx", symbol: "USDCx", name: "USDCx", decimals: 6, bridged: true },
      // aeUSDC: Allbridge's bridged USDC (Ethereum), the older bridged dollar on Stacks; its own key.
      { assetId: "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC", key: "aeusdc", symbol: "aeUSDC", name: "Ethereum USDC via Allbridge", decimals: 6, bridged: true },
    ],
  },
  testnet: {
    caip2: "stacks:2147483648",
    chainId: 0x80000000,
    api: "https://api.testnet.hiro.so",
    explorer: "https://explorer.hiro.so",
    tokens: [
      // USDCx testnet token contract (same docs page). sBTC has no published testnet deployment (only mocks).
      { assetId: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx::usdcx-token", key: "usdcx", symbol: "USDCx", name: "USDCx", decimals: 6, bridged: true },
    ],
  },
};

export function stxAsset(networkId: NetworkId): AssetRef {
  return { key: "stx", symbol: "STX", name: "Stacks", decimals: 6, networkId };
}

function network(net: StacksNetName): Network {
  const c = STACKS_NETS[net];
  return {
    id: c.caip2,
    family: "stacks",
    name: net === "mainnet" ? "Stacks" : "Stacks Testnet",
    nativeAsset: stxAsset(c.caip2),
    testnet: net !== "mainnet",
    rpcUrls: [c.api],
    explorerUrl: net === "mainnet" ? c.explorer : `${c.explorer}/?chain=testnet`,
    indexerUrl: c.api,
  };
}

export const STACKS_MAINNET = network("mainnet");
export const STACKS_TESTNET = network("testnet");
export const STACKS_NETWORKS: Network[] = [STACKS_TESTNET, STACKS_MAINNET];

/** Accepts a CAIP-2 id, a numeric chain id, or the SIP-030 network names ("mainnet", "testnet"). */
export function netOf(id: string | number | undefined): StacksNetName | null {
  if (id === undefined) return null;
  if (typeof id === "number") return id === 1 ? "mainnet" : id === 0x80000000 ? "testnet" : null;
  const s = id.trim().toLowerCase();
  if (s === "mainnet" || s === "stacks:1" || s === "1") return "mainnet";
  if (s === "testnet" || s === "stacks:2147483648" || s === "2147483648") return "testnet";
  return null;
}

export function specFor(networkId: NetworkId): StacksNetSpec | null {
  const n = netOf(networkId);
  return n ? STACKS_NETS[n] : null;
}

export function explorerTxUrl(networkId: NetworkId, txid: string): string {
  const n = netOf(networkId) ?? "testnet";
  const id = txid.startsWith("0x") ? txid : `0x${txid}`;
  return `${STACKS_NETS[n].explorer}/txid/${id}${n === "testnet" ? "?chain=testnet" : ""}`;
}

/** The curated token for "SP….contract::asset", if any. */
export function knownToken(networkId: NetworkId, assetId: string): StacksToken | undefined {
  return specFor(networkId)?.tokens.find((t) => t.assetId === assetId);
}

/** AssetRef for a SIP-010 token. Unknown tokens named like a curated one (or like STX) are spam. */
export function tokenAsset(networkId: NetworkId, assetId: string, meta?: { symbol?: string; name?: string; decimals?: number } | null): AssetRef {
  const known = knownToken(networkId, assetId);
  if (known) return { key: known.key, symbol: known.symbol, name: known.name, decimals: known.decimals, networkId, address: assetId, ...(known.bridged ? { bridged: true } : {}) };
  const symbol = (meta?.symbol || assetId.split("::")[1] || "token").slice(0, 32);
  const name = (meta?.name || symbol).slice(0, 64);
  const lookalike = /^(stx|wstx|sbtc|btc|usdc|usdcx|aeusdc|usdt|usdh)$/i.test(symbol.replace(/[^a-z]/gi, "")) || /\b(sbtc|usdc|stacks)\b/i.test(name);
  return {
    key: `sip10:${assetId}`,
    symbol,
    name,
    decimals: Number.isInteger(meta?.decimals) && meta!.decimals! >= 0 && meta!.decimals! <= 38 ? meta!.decimals! : 0,
    networkId,
    address: assetId,
    ...(lookalike ? { spam: true } : {}),
  };
}
