import type { Account, ChainContext, Network } from "@clip-wallet/core";
import {
  CARDANO_MAINNET,
  CARDANO_PREPROD,
  addressToBech32,
  baseAddress,
  keyHash,
  poolIdToBech32,
  rewardAddress,
} from "@clip-wallet/chains-cardano";
import { mockFetch, type Route } from "./helpers.js";

/**
 * Public fixture keys from packages/chains-cardano/test/signatures.ts (FIX). Public keys and addresses only;
 * no private key exists anywhere in these tests.
 */
export const PAYMENT_PUB = "f8573c6dbfde4d69363f64f688063e6227ef4bd4d3e3dd2bbb2744205d2124d6";
export const STAKE_PUB = "5672598feec2b38672e09ccc81839fcd275658b57686156404013198e7e97eba";
export const ADDR_TEST = "addr_test1qzk2jt3l5uxmzvvgtkfn65mcmakqexsxm0ard84zxng7dd5ck5cvjgqxmagnjvycn5he68cp606q6x7kwkhk734wve9q7umnwu";
export const REWARD_TEST = "stake_test1uzvt2vxfyqrd75fexzvf6tuaruqa8aqdr0t8ttm0g6hxvjsnadee2";

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const PKH = keyHash(hexToBytes(PAYMENT_PUB));
export const SKH = keyHash(hexToBytes(STAKE_PUB));
export const ADDR_MAIN = addressToBech32(baseAddress(1, PKH, SKH));
export const REWARD_MAIN = addressToBech32(rewardAddress(1, { kind: "key", hash: SKH }));
/** Someone else (the "bob" key hash in chains-cardano fixtures is an enterprise address; any 28 bytes work here). */
export const STRANGER = new Uint8Array(28).fill(7);

export const poolId = (n: number) => poolIdToBech32(new Uint8Array(28).fill(n));

export function cardanoAccount(network: Network): Account {
  return {
    id: "cardano:0",
    family: "cardano",
    index: 0,
    curve: "bip32-ed25519",
    derivationPath: "m/1852'/1815'/0'/0/0",
    publicKey: PAYMENT_PUB,
    address: network.testnet ? ADDR_TEST : ADDR_MAIN,
  };
}

export function cardanoCtx(network: Network, routes: Route[]): ChainContext & { calls: ReturnType<typeof mockFetch>["calls"] } {
  const m = mockFetch(routes);
  return { network, account: cardanoAccount(network), fetch: m.fetch, calls: m.calls };
}

export const KOIOS_PARAMS = {
  txFeePerByte: 44,
  txFeeFixed: 155381,
  utxoCostPerByte: 4310,
  stakeAddressDeposit: 2000000,
  maxTxSize: 16384,
  maxValueSize: 5000,
  collateralPercentage: 150,
};

export const TX_A = "aa".repeat(32);
export const TX_C = "cc".repeat(32);

export function koiosUtxo(txHash: string, index: number, address: string, lovelace: bigint) {
  return { tx_hash: txHash, tx_index: index, address, value: lovelace.toString(), asset_list: [], is_spent: false };
}

/** Koios answers shared by Cardano tests (both networks: paths are matched without the host). */
export function koiosBase(address: string): Route[] {
  return [
    [/\/tip$/, [{ abs_slot: 100_000_000, epoch_no: 300, block_height: 1 }]],
    [/\/cli_protocol_params$/, KOIOS_PARAMS],
    [/\/address_utxos$/, [koiosUtxo(TX_A, 0, address, 20_000_000n), koiosUtxo(TX_C, 1, address, 3_000_000n)]],
  ];
}

export { CARDANO_MAINNET, CARDANO_PREPROD };
