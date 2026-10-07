import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Antelope networks: Vaulta (formerly EOS), Telos and XPR Network, each with its testnet.
 *  - Ids: ChainAgnostic namespaces antelope/caip2.md — "antelope:" + the first 32 hex characters of the chain id
 *    (its test cases include EOS Mainnet antelope:aca376f206b8fc25a6ed44dbdc66547c and Telos Mainnet).
 *  - Chain ids and endpoints checked with GET /v1/chain/get_info in October 2026; every chain API listed answers
 *    /v1/chain/get_accounts_by_authorizers and send_transaction2 (Hyperion `/v2/state/get_key_accounts` is the
 *    fallback for nodes that don't). No API keys.
 *  - Vaulta: the system (gas) token is still EOS on eosio.token (the RAM market, PowerUp and staking are priced in
 *    EOS); the Vaulta "A" token (core.vaulta, swapped 1:1 with EOS by transferring either to core.vaulta) is shown
 *    beside it. USDT is Tether's own issue on tethertether.
 */
export type AntelopeNet = "jungle4" | "vaulta" | "telos" | "telos-testnet" | "xpr" | "xpr-testnet";

export interface AntelopeToken {
  contract: string;
  symbol: string;
  precision: number;
  key: string;
  name: string;
}

export interface AntelopeNetSpec {
  chainId: string;
  name: string;
  testnet: boolean;
  rpc: string[];
  /** Hyperion v2 (state/get_key_accounts, state/get_tokens), when one answered. */
  hyperion?: string;
  explorer: string;
  /** The system token (fees, resources): native asset. */
  core: AntelopeToken;
  /** Other tokens shown by default (same issuer as on other networks only where the key says so). */
  tokens: AntelopeToken[];
  /** How CPU/NET are paid for, for plain error messages. */
  resources: "powerup" | "stake-or-powerup" | "free";
}

const eos = (): AntelopeToken => ({ contract: "eosio.token", symbol: "EOS", precision: 4, key: "eos", name: "EOS" });
const vaultaA: AntelopeToken = { contract: "core.vaulta", symbol: "A", precision: 4, key: "vaulta", name: "Vaulta" };

export const ANTELOPE_NETS: Record<AntelopeNet, AntelopeNetSpec> = {
  jungle4: {
    chainId: "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d",
    name: "Jungle4 (Vaulta testnet)",
    testnet: true,
    rpc: ["https://jungle4.greymass.com", "https://jungle4.cryptolions.io", "https://jungle4.api.eosnation.io"],
    hyperion: "https://jungle4.cryptolions.io",
    explorer: "https://jungle4.unicove.com",
    core: eos(),
    tokens: [vaultaA],
    resources: "powerup",
  },
  vaulta: {
    chainId: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
    name: "Vaulta",
    testnet: false,
    rpc: ["https://eos.greymass.com", "https://eos.api.eosnation.io"],
    hyperion: "https://eos.eosusa.io",
    explorer: "https://bloks.io",
    core: eos(),
    tokens: [vaultaA, { contract: "tethertether", symbol: "USDT", precision: 4, key: "usdt", name: "Tether USD" }],
    resources: "powerup",
  },
  "telos-testnet": {
    chainId: "1eaa0824707c8c16bd25145493bf062aecddfeb56c736f6ba6397f3195f33c9f",
    name: "Telos Testnet",
    testnet: true,
    rpc: ["https://testnet.telos.net", "https://telos-testnet.cryptolions.io"],
    hyperion: "https://testnet.telos.net",
    explorer: "https://explorer-test.telos.net",
    core: { contract: "eosio.token", symbol: "TLOS", precision: 4, key: "tlos", name: "Telos" },
    tokens: [],
    resources: "stake-or-powerup",
  },
  telos: {
    chainId: "4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11",
    name: "Telos",
    testnet: false,
    rpc: ["https://mainnet.telos.net", "https://telos.greymass.com"],
    hyperion: "https://mainnet.telos.net",
    explorer: "https://explorer.telos.net",
    core: { contract: "eosio.token", symbol: "TLOS", precision: 4, key: "tlos", name: "Telos" },
    tokens: [],
    resources: "stake-or-powerup",
  },
  "xpr-testnet": {
    chainId: "71ee83bcf52142d61019d95f9cc5427ba6a0d7ff8accd9e2088ae2abeaf3d3dd",
    name: "XPR Network Testnet",
    testnet: true,
    rpc: ["https://tn1.protonnz.com", "https://testnet.protonchain.com", "https://proton-testnet.cryptolions.io"],
    explorer: "https://testnet.explorer.xprnetwork.org",
    core: { contract: "eosio.token", symbol: "XPR", precision: 4, key: "xpr", name: "XPR Network" },
    tokens: [],
    resources: "free",
  },
  xpr: {
    chainId: "384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0",
    name: "XPR Network",
    testnet: false,
    rpc: ["https://proton.greymass.com", "https://api.protonnz.com", "https://proton.eosusa.io"],
    hyperion: "https://proton.eosusa.io",
    explorer: "https://explorer.xprnetwork.org",
    core: { contract: "eosio.token", symbol: "XPR", precision: 4, key: "xpr", name: "XPR Network" },
    tokens: [],
    resources: "free",
  },
};

export const caip2Of = (chainId: string): NetworkId => `antelope:${chainId.slice(0, 32).toLowerCase()}`;

export function tokenAssetOf(networkId: NetworkId, t: AntelopeToken): AssetRef {
  const a: AssetRef = { key: t.key, symbol: t.symbol, name: t.name, decimals: t.precision, networkId };
  return t.contract === "eosio.token" && isCore(networkId, t) ? a : { ...a, address: `${t.contract}:${t.symbol}` };
}

function isCore(networkId: NetworkId, t: AntelopeToken): boolean {
  const s = specFor(networkId);
  return !!s && s.core.contract === t.contract && s.core.symbol === t.symbol;
}

function network(net: AntelopeNet): Network {
  const c = ANTELOPE_NETS[net];
  const id = caip2Of(c.chainId);
  return { id, family: "antelope", name: c.name, nativeAsset: tokenAssetOf(id, c.core), testnet: c.testnet, rpcUrls: c.rpc, explorerUrl: c.explorer, ...(c.hyperion ? { indexerUrl: c.hyperion } : {}) };
}

export const JUNGLE4 = network("jungle4");
export const VAULTA_MAINNET = network("vaulta");
export const TELOS_TESTNET = network("telos-testnet");
export const TELOS_MAINNET = network("telos");
export const XPR_TESTNET = network("xpr-testnet");
export const XPR_MAINNET = network("xpr");
export const ANTELOPE_NETWORKS: Network[] = [JUNGLE4, VAULTA_MAINNET, TELOS_TESTNET, TELOS_MAINNET, XPR_TESTNET, XPR_MAINNET];

/** A CAIP-2 id, a full 64-hex chain id, or its 32-hex prefix → the network, else null. */
export function netOf(chain: string): AntelopeNet | null {
  const ref = chain.replace(/^(antelope|eosio):/, "").toLowerCase();
  if (!/^[0-9a-f]{32}([0-9a-f]{32})?$/.test(ref)) return null;
  for (const [name, c] of Object.entries(ANTELOPE_NETS) as [AntelopeNet, AntelopeNetSpec][]) if (c.chainId.startsWith(ref)) return name;
  return null;
}

export function specFor(networkId: NetworkId): AntelopeNetSpec | null {
  const n = netOf(networkId);
  return n ? ANTELOPE_NETS[n] : null;
}

/** All tokens Clip Wallet shows on a network, core first. */
export function knownTokens(networkId: NetworkId): AntelopeToken[] {
  const s = specFor(networkId);
  return s ? [s.core, ...s.tokens] : [];
}

/**
 * AssetRef for any token contract + symbol. Known ones keep their key; anything else is
 * `antelope:<contract>:<SYMBOL>` and, when it borrows a known symbol (EOS, A, USDT, TLOS, XPR) from another
 * contract, `spam: true`.
 */
export function assetFor(networkId: NetworkId, contract: string, symbol: string, precision: number): AssetRef {
  const known = knownTokens(networkId).find((t) => t.contract === contract && t.symbol === symbol);
  if (known) return tokenAssetOf(networkId, { ...known, precision });
  const asset: AssetRef = { key: `antelope:${contract}:${symbol}`, symbol, name: symbol, decimals: precision, networkId, address: `${contract}:${symbol}` };
  const famous = new Set(Object.values(ANTELOPE_NETS).flatMap((s) => [s.core.symbol, ...s.tokens.map((t) => t.symbol)]));
  if (famous.has(symbol) || /^USD/.test(symbol)) asset.spam = true;
  return asset;
}

export function explorerTxUrl(net: Network, id: string): string {
  return `${net.explorerUrl}/transaction/${id}`;
}
