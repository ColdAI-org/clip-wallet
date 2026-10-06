import type { Family } from "@clip-wallet/core";
import { METHOD_WS_STATE } from "./protocol.js";

/**
 * Wire methods and public chain facts for the Keplr-compatible Cosmos provider (inpage/cosmos.ts,
 * background/cosmos.ts). The signing method names are chains-cosmos `COSMOS_METHODS`, so the background hands them
 * to the module unchanged. The chain table repeats what @clip-wallet/chains-cosmos/networks ships (1Mask doesn't
 * depend on chain packages); chains-cosmos's tests check the two agree.
 */

export type CosmosFamily = "cosmos" | "provenance" | "thorchain" | "initia";
export const COSMOS_FAMILIES = ["cosmos", "provenance", "thorchain", "initia"] as const satisfies readonly Family[];

export const COSMOS_INJECTED = {
  accounts: METHOD_WS_STATE,
  enable: "cosmos:enable",
  disable: "cosmos:disable",
  getKey: "cosmos:getKey",
  signDirect: "cosmos_signDirect",
  signAmino: "cosmos_signAmino",
  signArbitrary: "cosmos_signArbitrary",
  sendTx: "cosmos_sendTx",
  verifyArbitrary: "cosmos_verifyArbitrary",
} as const;

/** Connect method: the extension's connector treats it as a connect approval. */
export const COSMOS_CONNECT_METHODS = [COSMOS_INJECTED.enable] as const;

/** Keplr Key over the wire (bytes as hex). */
export interface CosmosKeyWire {
  algo: string;
  pubKey: string;
  address: string;
  bech32Address: string;
  ethereumHexAddress: string;
}

export interface CosmosCurrency {
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
}

/** Keplr ChainInfoWithoutEndpoints (@keplr-wallet/types src/chain-info.ts): ChainInfo minus rest/rpc/nodeProvider. */
export interface CosmosChainInfoWithoutEndpoints {
  readonly rest: undefined;
  readonly rpc: undefined;
  readonly nodeProvider: undefined;
  readonly chainId: string;
  readonly chainName: string;
  readonly stakeCurrency?: CosmosCurrency;
  readonly bip44: { coinType: number };
  readonly bech32Config: {
    bech32PrefixAccAddr: string;
    bech32PrefixAccPub: string;
    bech32PrefixValAddr: string;
    bech32PrefixValPub: string;
    bech32PrefixConsAddr: string;
    bech32PrefixConsPub: string;
  };
  readonly currencies: CosmosCurrency[];
  readonly feeCurrencies: (CosmosCurrency & { gasPriceStep?: { low: number; average: number; high: number } })[];
  readonly features: string[];
  readonly isTestnet: boolean;
}

export interface CosmosChainFacts {
  chainId: string;
  family: CosmosFamily;
  chainName: string;
  prefix: string;
  coinType: number;
  /** Keplr Key.algo. */
  algo: "secp256k1" | "ethsecp256k1";
  native: CosmosCurrency;
  /** Native gas price step (chain-registry). */
  gas: { low: number; average: number; high: number };
  usdc?: string;
  /** THORChain has no x/staking: no stake currency. */
  staking: boolean;
  features: string[];
  testnet: boolean;
}

const cur = (coinDenom: string, coinMinimalDenom: string, coinDecimals: number): CosmosCurrency => ({ coinDenom, coinMinimalDenom, coinDecimals });
const OSMO = cur("OSMO", "uosmo", 6);
const ZIG = cur("ZIG", "azig", 18);
const HASH = cur("HASH", "nhash", 9);
const INIT = cur("INIT", "uinit", 6);
const DYDX_USDC = "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5";

export const COSMOS_CHAIN_FACTS: readonly CosmosChainFacts[] = [
  { chainId: "osmo-test-5", family: "cosmos", chainName: "Osmosis Testnet", prefix: "osmo", coinType: 118, algo: "secp256k1", native: OSMO, gas: { low: 0.0025, average: 0.025, high: 0.04 }, usdc: "ibc/DE6792CF9E521F6AD6E9A4BDF6225C9571A3B74ACC0A529F92BC5122A39D2E58", staking: true, features: ["cosmwasm", "osmosis-txfees"], testnet: true },
  { chainId: "osmosis-1", family: "cosmos", chainName: "Osmosis", prefix: "osmo", coinType: 118, algo: "secp256k1", native: OSMO, gas: { low: 0.03, average: 0.1, high: 0.16 }, usdc: "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4", staking: true, features: ["cosmwasm", "osmosis-txfees"], testnet: false },
  { chainId: "dydx-testnet-4", family: "cosmos", chainName: "dYdX Testnet", prefix: "dydx", coinType: 118, algo: "secp256k1", native: cur("DV4TNT", "adv4tnt", 18), gas: { low: 25000000000, average: 25000000000, high: 50000000000 }, usdc: DYDX_USDC, staking: true, features: [], testnet: true },
  { chainId: "dydx-mainnet-1", family: "cosmos", chainName: "dYdX", prefix: "dydx", coinType: 118, algo: "secp256k1", native: cur("DYDX", "adydx", 18), gas: { low: 12500000000, average: 12500000000, high: 20000000000 }, usdc: DYDX_USDC, staking: true, features: [], testnet: false },
  { chainId: "zig-test-2", family: "cosmos", chainName: "ZIGChain Testnet", prefix: "zig", coinType: 118, algo: "secp256k1", native: ZIG, gas: { low: 2500000000, average: 25000000000, high: 50000000000 }, staking: true, features: ["cosmwasm"], testnet: true },
  { chainId: "zigchain-1", family: "cosmos", chainName: "ZIGChain", prefix: "zig", coinType: 118, algo: "secp256k1", native: ZIG, gas: { low: 2500000000, average: 25000000000, high: 50000000000 }, staking: true, features: ["cosmwasm"], testnet: false },
  { chainId: "pio-testnet-1", family: "provenance", chainName: "Provenance Testnet", prefix: "tp", coinType: 505, algo: "secp256k1", native: HASH, gas: { low: 1, average: 1, high: 1 }, staking: true, features: ["cosmwasm"], testnet: true },
  { chainId: "pio-mainnet-1", family: "provenance", chainName: "Provenance", prefix: "pb", coinType: 505, algo: "secp256k1", native: HASH, gas: { low: 1, average: 1, high: 1 }, staking: true, features: ["cosmwasm"], testnet: false },
  { chainId: "thorchain-1", family: "thorchain", chainName: "THORChain", prefix: "thor", coinType: 931, algo: "secp256k1", native: cur("RUNE", "rune", 8), gas: { low: 0, average: 0, high: 0 }, staking: false, features: [], testnet: false },
  { chainId: "initiation-2", family: "initia", chainName: "Initia Testnet", prefix: "init", coinType: 60, algo: "ethsecp256k1", native: INIT, gas: { low: 0.015, average: 0.015, high: 0.04 }, staking: true, features: ["eth-address-gen", "eth-key-sign", "eth-secp256k1-initia"], testnet: true },
  { chainId: "interwoven-1", family: "initia", chainName: "Initia", prefix: "init", coinType: 60, algo: "ethsecp256k1", native: INIT, gas: { low: 0.015, average: 0.015, high: 0.04 }, staking: true, features: ["eth-address-gen", "eth-key-sign", "eth-secp256k1-initia"], testnet: false },
];

export function cosmosChainOf(chainId: string): CosmosChainFacts | undefined {
  return COSMOS_CHAIN_FACTS.find((c) => c.chainId === chainId);
}

export function chainInfoWithoutEndpoints(chainId: string): CosmosChainInfoWithoutEndpoints | undefined {
  const c = cosmosChainOf(chainId);
  if (!c) return undefined;
  const p = c.prefix;
  const usdc = c.usdc ? [cur("USDC", c.usdc, 6)] : [];
  return {
    rest: undefined,
    rpc: undefined,
    nodeProvider: undefined,
    chainId: c.chainId,
    chainName: c.chainName,
    ...(c.staking ? { stakeCurrency: c.native } : {}),
    bip44: { coinType: c.coinType },
    bech32Config: {
      bech32PrefixAccAddr: p,
      bech32PrefixAccPub: `${p}pub`,
      bech32PrefixValAddr: `${p}valoper`,
      bech32PrefixValPub: `${p}valoperpub`,
      bech32PrefixConsAddr: `${p}valcons`,
      bech32PrefixConsPub: `${p}valconspub`,
    },
    currencies: [c.native, ...usdc],
    feeCurrencies: [{ ...c.native, gasPriceStep: c.gas }],
    features: [...c.features],
    isTestnet: c.testnet,
  };
}

/* ------------------------------------------------------------------ base64 without Buffer (page bundle) */

export function b64FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function bytesFromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
