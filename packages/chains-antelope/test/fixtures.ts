/**
 * The public "abandon … about" test key at m/44'/194'/0'/0/0 (what the vault derives for antelope account 0), the
 * account names the mocked chain says use it, and the transactions the tests sign. Public data only.
 */
import type { Abi } from "../src/abi.js";
import { TOKEN_ABI, encodeActionData } from "../src/abi.js";
import { hex } from "../src/bytes.js";
import type { TransactionJson } from "../src/transaction.js";

export const PUB_HEX = "0315c358024ce46767102578947584c4342a6982b922d454f63588effa34597197";
export const PUB_K1 = "PUB_K1_6zpSNY1YoLxNt2VsvJjoDfBueU6xC1M1ERJw1UoekL1NK2aD4t";
export const LEGACY = "EOS6zpSNY1YoLxNt2VsvJjoDfBueU6xC1M1ERJw1UoekL1NHn8KNA";
export const ME = "clipabandon1";
export const BOB = "bobbobbob123";

/** get_info the mocked Jungle4 answers with. */
export const INFO = {
  chain_id: "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d",
  head_block_num: 290625015,
  head_block_time: "2026-10-06T12:00:00.000",
  last_irreversible_block_num: 290625013,
  last_irreversible_block_id: "115295f5c53487176d0c821bfdf8bd44261573ace810f6fb68f38626cee854f3",
};

const header = { expiration: "2026-10-06T12:05:00", ref_block_num: 0x95f5, ref_block_prefix: 0x1b820c6d, max_net_usage_words: 0, max_cpu_usage_ms: 0, delay_sec: 0, context_free_actions: [], transaction_extensions: [] as [number, string][] };

/** buildTransfer: 1.5000 EOS from ME to BOB on Jungle4. */
export const EOS_SEND: TransactionJson = {
  ...header,
  actions: [{ account: "eosio.token", name: "transfer", authorization: [{ actor: ME, permission: "active" }], data: hex(encodeActionData(TOKEN_ABI, "transfer", { from: ME, to: BOB, quantity: "1.5000 EOS", memo: "" })) }],
};

/** The eosio ABI subset the tests serve (structs as in the system contract). */
export const EOSIO_ABI: Abi = {
  version: "eosio::abi/1.2",
  structs: [
    { name: "permission_level", base: "", fields: [{ name: "actor", type: "name" }, { name: "permission", type: "name" }] },
    { name: "key_weight", base: "", fields: [{ name: "key", type: "public_key" }, { name: "weight", type: "uint16" }] },
    { name: "permission_level_weight", base: "", fields: [{ name: "permission", type: "permission_level" }, { name: "weight", type: "uint16" }] },
    { name: "wait_weight", base: "", fields: [{ name: "wait_sec", type: "uint32" }, { name: "weight", type: "uint16" }] },
    { name: "authority", base: "", fields: [{ name: "threshold", type: "uint32" }, { name: "keys", type: "key_weight[]" }, { name: "accounts", type: "permission_level_weight[]" }, { name: "waits", type: "wait_weight[]" }] },
    { name: "updateauth", base: "", fields: [{ name: "account", type: "name" }, { name: "permission", type: "name" }, { name: "parent", type: "name" }, { name: "auth", type: "authority" }, { name: "authorized_by", type: "name$" }] },
    { name: "buyrambytes", base: "", fields: [{ name: "payer", type: "name" }, { name: "receiver", type: "name" }, { name: "bytes", type: "uint32" }] },
  ],
  actions: [{ name: "updateauth", type: "updateauth" }, { name: "buyrambytes", type: "buyrambytes" }],
};

/** A dapp's updateauth handing the active permission to another key (data given as JSON, serialised with the ABI). */
export const TAKEOVER_DATA = {
  account: ME,
  permission: "active",
  parent: "owner",
  auth: { threshold: 1, keys: [{ key: "PUB_K1_5UAjunGLeR6eBfbpU4CxGssxa9DKKjbPA4zrCuUpoJQwr6a12W", weight: 1 }], accounts: [], waits: [] },
};
export const TAKEOVER: TransactionJson = {
  ...header,
  actions: [{ account: "eosio", name: "updateauth", authorization: [{ actor: ME, permission: "owner" }], data: hex(encodeActionData(EOSIO_ABI, "updateauth", TAKEOVER_DATA)) }],
};
