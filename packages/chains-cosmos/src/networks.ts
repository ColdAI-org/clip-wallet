import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * Cosmos SDK networks Clip Wallet ships, by key family (each ecosystem's wallets derive at the chain's own SLIP-44
 * coin type, so each family is its own vault key):
 *  - "cosmos" (m/44'/118'/0'/0/i): Osmosis, dYdX, ZIGChain
 *  - "provenance" (m/44'/505'/0'/0/i): Provenance (pb… mainnet, tp… testnet)
 *  - "thorchain" (m/44'/931'/0'/0/i): THORChain (mainnet only: its stagenet runs on real funds)
 *  - "initia" (m/44'/60'/0'/0/i, ethsecp256k1): Initia L1
 *
 * Network ids are CAIP-2 in the `cosmos` namespace: "cosmos:<chain-id>"
 * (https://github.com/ChainAgnostic/namespaces/blob/main/cosmos/caip2.md).
 *
 * Chain facts (bech32 prefix, slip44, denoms, decimals, gas prices, endpoints) come from github.com/cosmos/chain-registry
 * (<chain>/chain.json, assetlist.json; testnets/…) and, for Initia, github.com/initia-labs/initia-registry. Every REST
 * endpoint here answered GET /cosmos/base/tendermint/v1beta1/node_info with the right `network` (checked with curl,
 * Oct 2026) and allows any origin (the extension background has no host permission for them), except
 * thorchain.ibs.team, which sends the CORS header twice (browsers refuse that; it stays as a last resort). No endpoint
 * needs a key. Only one public REST endpoint was found for pio-testnet-1 and initiation-2.
 */

export type CosmosFamily = "cosmos" | "provenance" | "thorchain" | "initia";
export const COSMOS_FAMILIES: readonly CosmosFamily[] = ["cosmos", "provenance", "thorchain", "initia"];

export interface FeeToken {
  denom: string;
  /** Gas prices (base units per gas), decimal strings as chain-registry gives them. */
  low: string;
  average: string;
  high: string;
}

export interface KnownToken {
  denom: string;
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Listed in getBalances even at 0 (dYdX: USDC is the collateral and a fee asset). */
  alwaysShow?: boolean;
}

export interface CosmosChainSpec {
  chainId: string;
  family: CosmosFamily;
  name: string;
  testnet: boolean;
  prefix: string;
  /** SLIP-44 coin type of the family's derivation path. */
  coinType: number;
  keyKind: "secp256k1" | "ethsecp256k1";
  /** Any type URL of the account's public key in AuthInfo.signer_infos. */
  pubKeyTypeUrl: string;
  /** REST (LCD) endpoints, tried in order. */
  rest: string[];
  /** CometBFT RPC endpoints (not used by the module; listed for dapps and the provider's chain info). */
  rpc: string[];
  explorer: string;
  /** Explorer page of a transaction: `{hash}` is replaced. */
  explorerTx: string;
  native: { denom: string; symbol: string; name: string; decimals: number; key: string };
  tokens?: KnownToken[];
  /** Fee tokens in order of preference, with gas prices. */
  feeTokens: FeeToken[];
  /**
   * "gas-price": fee = gas limit × gas price of the first fee token the account can pay.
   * "osmosis-txfees": OSMO's gas price is the txfees module's EIP-1559 base fee × 1.65 (osmosis-frontend
   *   packages/tx/src/gas.ts defaultBaseFeeMultiplier).
   * "initia-dynamic": INIT's gas price is x/dynamicfee's current price (/initia/tx/v1/gas_prices/{denom}) × 1.05.
   * "provenance-flatfee": x/flatfees charges a flat fee per message type; /provenance/tx/v1/calculate_flat_fee gives
   *   the fee and the gas (gas price 1nhash, as Provenance asks every client to use).
   * "fixed-native": THORChain charges a fixed native fee from the balance; the tx's Fee carries no coins.
   */
  feeModel: "gas-price" | "osmosis-txfees" | "initia-dynamic" | "provenance-flatfee" | "fixed-native";
  /** THORChain: the fixed native fee taken by the chain (read live from /thorchain/network native_tx_fee_rune; this is the fallback). */
  fixedFee?: { denom: string; amount: string };
  /** Smallest gas limit used for a transfer (THORChain: xchainjs's 6 000 000; gas isn't charged there). */
  minGas?: bigint;
  /** "bank": cosmos.bank.v1beta1.MsgSend. "thorchain": types.MsgSend (bank sends are disabled on THORChain). */
  sendMsg: "bank" | "thorchain";
}

const SECP = "/cosmos.crypto.secp256k1.PubKey";
/** initia crypto/ethsecp256k1 (proto/initia/crypto/v1beta1/ethsecp256k1/keys.proto). */
const ETHSECP_INITIA = "/initia.crypto.v1beta1.ethsecp256k1.PubKey";

const usdc = (denom: string, alwaysShow = false): KnownToken => ({ denom, key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, ...(alwaysShow ? { alwaysShow } : {}) });

export const COSMOS_CHAINS: readonly CosmosChainSpec[] = [
  /* ---------------------------------------------------------------- cosmos (118) */
  {
    chainId: "osmo-test-5",
    family: "cosmos",
    name: "Osmosis Testnet",
    testnet: true,
    prefix: "osmo",
    coinType: 118,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://lcd.osmotest5.osmosis.zone", "https://lcd.testnet.osmosis.zone"],
    rpc: ["https://rpc.osmotest5.osmosis.zone", "https://rpc.testnet.osmosis.zone"],
    explorer: "https://www.mintscan.io/osmosis-testnet",
    explorerTx: "https://www.mintscan.io/osmosis-testnet/tx/{hash}",
    native: { denom: "uosmo", symbol: "OSMO", name: "Osmosis", decimals: 6, key: "osmo" },
    // Circle's testnet USDC from Noble grand-1 (transfer/channel-4280).
    tokens: [usdc("ibc/DE6792CF9E521F6AD6E9A4BDF6225C9571A3B74ACC0A529F92BC5122A39D2E58")],
    feeTokens: [{ denom: "uosmo", low: "0.0025", average: "0.025", high: "0.04" }],
    feeModel: "osmosis-txfees",
    sendMsg: "bank",
  },
  {
    chainId: "osmosis-1",
    family: "cosmos",
    name: "Osmosis",
    testnet: false,
    prefix: "osmo",
    coinType: 118,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://lcd.osmosis.zone", "https://osmosis-rest.publicnode.com", "https://osmosis-api.polkachu.com"],
    rpc: ["https://rpc.osmosis.zone", "https://osmosis-rpc.publicnode.com"],
    explorer: "https://www.mintscan.io/osmosis",
    explorerTx: "https://www.mintscan.io/osmosis/tx/{hash}",
    native: { denom: "uosmo", symbol: "OSMO", name: "Osmosis", decimals: 6, key: "osmo" },
    // Circle USDC from Noble (channel-750 on Osmosis), the USDC Osmosis lists as "USDC".
    tokens: [usdc("ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4")],
    feeTokens: [{ denom: "uosmo", low: "0.03", average: "0.1", high: "0.16" }],
    feeModel: "osmosis-txfees",
    sendMsg: "bank",
  },
  {
    chainId: "dydx-testnet-4",
    family: "cosmos",
    name: "dYdX Testnet",
    testnet: true,
    prefix: "dydx",
    coinType: 118,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://dydx-testnet-api.polkachu.com", "https://test-dydx-rest.kingnodes.com"],
    rpc: ["https://dydx-testnet-rpc.polkachu.com", "https://test-dydx-rpc.kingnodes.com"],
    explorer: "https://www.mintscan.io/dydx-testnet",
    explorerTx: "https://www.mintscan.io/dydx-testnet/tx/{hash}",
    native: { denom: "adv4tnt", symbol: "DV4TNT", name: "dYdX testnet token", decimals: 18, key: "dydx" },
    tokens: [usdc("ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5", true)],
    feeTokens: [
      { denom: "adv4tnt", low: "25000000000", average: "25000000000", high: "50000000000" },
      { denom: "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5", low: "0.025", average: "0.025", high: "0.03" },
    ],
    feeModel: "gas-price",
    sendMsg: "bank",
  },
  {
    chainId: "dydx-mainnet-1",
    family: "cosmos",
    name: "dYdX",
    testnet: false,
    prefix: "dydx",
    coinType: 118,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://dydx-rest.publicnode.com", "https://dydx-api.polkachu.com"],
    rpc: ["https://dydx-rpc.publicnode.com", "https://dydx-rpc.polkachu.com"],
    explorer: "https://www.mintscan.io/dydx",
    explorerTx: "https://www.mintscan.io/dydx/tx/{hash}",
    native: { denom: "adydx", symbol: "DYDX", name: "dYdX", decimals: 18, key: "dydx" },
    tokens: [usdc("ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5", true)],
    feeTokens: [
      { denom: "adydx", low: "12500000000", average: "12500000000", high: "20000000000" },
      { denom: "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5", low: "0.025", average: "0.025", high: "0.03" },
    ],
    feeModel: "gas-price",
    sendMsg: "bank",
  },
  {
    chainId: "zig-test-2",
    family: "cosmos",
    name: "ZIGChain Testnet",
    testnet: true,
    prefix: "zig",
    coinType: 118,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://zigchain-testnet-api.polkachu.com", "https://public-zigchain-testnet-lcd.numia.xyz", "https://testnet-api.zigchain.com"],
    rpc: ["https://zigchain-testnet-rpc.polkachu.com", "https://testnet-rpc.zigchain.com"],
    explorer: "https://testnet.zigscan.org",
    explorerTx: "https://testnet.zigscan.org/tx/{hash}",
    native: { denom: "azig", symbol: "ZIG", name: "ZIGChain", decimals: 18, key: "zig" },
    feeTokens: [{ denom: "azig", low: "2500000000", average: "25000000000", high: "50000000000" }],
    feeModel: "gas-price",
    sendMsg: "bank",
  },
  {
    chainId: "zigchain-1",
    family: "cosmos",
    name: "ZIGChain",
    testnet: false,
    prefix: "zig",
    coinType: 118,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://public-zigchain-lcd.numia.xyz", "https://zigchain-api.polkachu.com"],
    rpc: ["https://public-zigchain-rpc.numia.xyz", "https://zigchain-rpc.polkachu.com"],
    explorer: "https://www.zigscan.org",
    explorerTx: "https://www.zigscan.org/tx/{hash}",
    native: { denom: "azig", symbol: "ZIG", name: "ZIGChain", decimals: 18, key: "zig" },
    feeTokens: [{ denom: "azig", low: "2500000000", average: "25000000000", high: "50000000000" }],
    feeModel: "gas-price",
    sendMsg: "bank",
  },

  /* ---------------------------------------------------------------- provenance (505) */
  {
    chainId: "pio-testnet-1",
    family: "provenance",
    name: "Provenance Testnet",
    testnet: true,
    prefix: "tp",
    coinType: 505,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://api.test.provenance.io"],
    rpc: ["https://rpc.test.provenance.io"],
    explorer: "https://explorer.test.provenance.io",
    explorerTx: "https://explorer.test.provenance.io/tx/{hash}",
    native: { denom: "nhash", symbol: "HASH", name: "Hash", decimals: 9, key: "hash" },
    feeTokens: [{ denom: "nhash", low: "1", average: "1", high: "1" }],
    feeModel: "provenance-flatfee",
    sendMsg: "bank",
  },
  {
    chainId: "pio-mainnet-1",
    family: "provenance",
    name: "Provenance",
    testnet: false,
    prefix: "pb",
    coinType: 505,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://provenance-api.polkachu.com", "https://provenance.api.pocket.network"],
    rpc: ["https://provenance-rpc.polkachu.com", "https://rpc.provenance.io"],
    explorer: "https://explorer.provenance.io",
    explorerTx: "https://explorer.provenance.io/tx/{hash}",
    native: { denom: "nhash", symbol: "HASH", name: "Hash", decimals: 9, key: "hash" },
    feeTokens: [{ denom: "nhash", low: "1", average: "1", high: "1" }],
    feeModel: "provenance-flatfee",
    sendMsg: "bank",
  },

  /* ---------------------------------------------------------------- thorchain (931) */
  {
    chainId: "thorchain-1",
    family: "thorchain",
    name: "THORChain",
    testnet: false,
    prefix: "thor",
    coinType: 931,
    keyKind: "secp256k1",
    pubKeyTypeUrl: SECP,
    rest: ["https://gateway.liquify.com/chain/thorchain_api", "https://thorchain.ibs.team/api"],
    rpc: ["https://gateway.liquify.com/chain/thorchain_rpc", "https://thorchain.ibs.team/rpc"],
    explorer: "https://runescan.io",
    explorerTx: "https://runescan.io/tx/{hash}",
    native: { denom: "rune", symbol: "RUNE", name: "THORChain", decimals: 8, key: "rune" },
    feeTokens: [{ denom: "rune", low: "0", average: "0", high: "0" }],
    feeModel: "fixed-native",
    fixedFee: { denom: "rune", amount: "2000000" },
    minGas: 6_000_000n,
    sendMsg: "thorchain",
  },

  /* ---------------------------------------------------------------- initia (60, ethsecp256k1) */
  {
    chainId: "initiation-2",
    family: "initia",
    name: "Initia Testnet",
    testnet: true,
    prefix: "init",
    coinType: 60,
    keyKind: "ethsecp256k1",
    pubKeyTypeUrl: ETHSECP_INITIA,
    rest: ["https://rest.testnet.initia.xyz"],
    rpc: ["https://rpc.testnet.initia.xyz"],
    explorer: "https://scan.testnet.initia.xyz/initiation-2",
    explorerTx: "https://scan.testnet.initia.xyz/initiation-2/txs/{hash}",
    native: { denom: "uinit", symbol: "INIT", name: "Initia", decimals: 6, key: "init" },
    feeTokens: [{ denom: "uinit", low: "0.015", average: "0.015", high: "0.04" }],
    feeModel: "initia-dynamic",
    sendMsg: "bank",
  },
  {
    chainId: "interwoven-1",
    family: "initia",
    name: "Initia",
    testnet: false,
    prefix: "init",
    coinType: 60,
    keyKind: "ethsecp256k1",
    pubKeyTypeUrl: ETHSECP_INITIA,
    rest: ["https://rest.initia.xyz", "https://initia-api.polkachu.com"],
    rpc: ["https://rpc.initia.xyz", "https://initia-rpc.polkachu.com"],
    explorer: "https://scan.initia.xyz/interwoven-1",
    explorerTx: "https://scan.initia.xyz/interwoven-1/txs/{hash}",
    native: { denom: "uinit", symbol: "INIT", name: "Initia", decimals: 6, key: "init" },
    feeTokens: [{ denom: "uinit", low: "0.015", average: "0.015", high: "0.04" }],
    feeModel: "initia-dynamic",
    sendMsg: "bank",
  },
];

/** The vault's path for each family (packages/vault/src/derive.ts `derivationPath`). */
export function derivationPathOf(family: CosmosFamily, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new RangeError(`bad account index ${index}`);
  const coin = { cosmos: 118, provenance: 505, thorchain: 931, initia: 60 }[family];
  return `m/44'/${coin}'/0'/0/${index}`;
}

export function chainsOf(family: CosmosFamily): CosmosChainSpec[] {
  return COSMOS_CHAINS.filter((c) => c.family === family);
}

export function specOf(networkId: NetworkId): CosmosChainSpec | null {
  const id = networkId.startsWith("cosmos:") ? networkId.slice("cosmos:".length) : null;
  return (id && COSMOS_CHAINS.find((c) => c.chainId === id)) || null;
}

export function nativeAsset(spec: CosmosChainSpec): AssetRef {
  return { key: spec.native.key, symbol: spec.native.symbol, name: spec.native.name, decimals: spec.native.decimals, networkId: `cosmos:${spec.chainId}` };
}

/**
 * The AssetRef of a denom on this chain: the native coin, a curated token, or (anything else) the raw denom with 0
 * decimals, so an amount is never shown scaled by a guess. Unknown denoms never appear in getBalances.
 */
export function assetOf(spec: CosmosChainSpec, denom: string): AssetRef {
  if (denom === spec.native.denom) return nativeAsset(spec);
  const t = spec.tokens?.find((x) => x.denom === denom);
  const networkId = `cosmos:${spec.chainId}`;
  if (t) return { key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId, address: denom };
  const symbol = denom.length > 16 ? `${denom.slice(0, 10)}…${denom.slice(-4)}` : denom;
  return { key: `cosmos:${spec.chainId}/${denom}`, symbol, name: denom, decimals: 0, networkId, address: denom };
}

export function explorerTxUrl(spec: CosmosChainSpec, hash: string): string {
  return spec.explorerTx.replace("{hash}", hash);
}

function networkOf(s: CosmosChainSpec): Network {
  return {
    id: `cosmos:${s.chainId}`,
    family: s.family,
    name: s.name,
    nativeAsset: nativeAsset(s),
    testnet: s.testnet,
    rpcUrls: s.rest,
    explorerUrl: s.explorer,
  };
}

/** Every network of every Cosmos family, as core Networks (rpcUrls = REST endpoints). */
export const COSMOS_NETWORKS: Network[] = COSMOS_CHAINS.map(networkOf);

export const networksOfFamily = (family: CosmosFamily): Network[] => COSMOS_NETWORKS.filter((n) => n.family === family);

export const OSMOSIS_TESTNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:osmo-test-5")!;
export const OSMOSIS_MAINNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:osmosis-1")!;
export const DYDX_TESTNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:dydx-testnet-4")!;
export const DYDX_MAINNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:dydx-mainnet-1")!;
export const ZIGCHAIN_TESTNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:zig-test-2")!;
export const ZIGCHAIN_MAINNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:zigchain-1")!;
export const PROVENANCE_TESTNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:pio-testnet-1")!;
export const PROVENANCE_MAINNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:pio-mainnet-1")!;
export const THORCHAIN_MAINNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:thorchain-1")!;
export const INITIA_TESTNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:initiation-2")!;
export const INITIA_MAINNET = COSMOS_NETWORKS.find((n) => n.id === "cosmos:interwoven-1")!;
