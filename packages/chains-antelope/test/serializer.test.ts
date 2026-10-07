import { ABI, Action, Name, PublicKey, Serializer, Signature, Transaction } from "@wharfkit/antelope";
import { describe, expect, it } from "vitest";
import { type Abi, AbiError, TOKEN_ABI, decodeActionData, encodeActionData, isTokenTransfer } from "../src/abi.js";
import { fromHex, hex, isAccountName, isName, nameFromBigInt, nameToBigInt, parsePublicKey, publicKeyString, signatureString } from "../src/bytes.js";
import { type TransactionJson, packTransaction, signingDigest, tapos, transactionId, unpackTransaction } from "../src/transaction.js";

/** A contract ABI with the shapes dapps use: aliases, bases, optionals, arrays, extensions, variants, time types. */
const DAPP_ABI: Abi = {
  version: "eosio::abi/1.2",
  types: [{ new_type_name: "account_name", type: "name" }],
  structs: [
    { name: "base", base: "", fields: [{ name: "owner", type: "account_name" }] },
    {
      name: "doit",
      base: "base",
      fields: [
        { name: "flags", type: "uint8[]" },
        { name: "big", type: "uint64" },
        { name: "neg", type: "int64" },
        { name: "small", type: "int16" },
        { name: "count", type: "varuint32" },
        { name: "delta", type: "varint32" },
        { name: "ok", type: "bool" },
        { name: "note", type: "string?" },
        { name: "blob", type: "bytes" },
        { name: "hash", type: "checksum256" },
        { name: "key", type: "public_key" },
        { name: "when", type: "time_point_sec" },
        { name: "at", type: "time_point" },
        { name: "slot", type: "block_timestamp_type" },
        { name: "sym", type: "symbol" },
        { name: "code", type: "symbol_code" },
        { name: "fee", type: "extended_asset" },
        { name: "pick", type: "choice" },
        { name: "extra", type: "string$" },
      ],
    },
    { name: "pair", base: "", fields: [{ name: "a", type: "uint32" }, { name: "b", type: "name" }] },
  ],
  actions: [{ name: "doit", type: "doit", ricardian_contract: "" }],
  variants: [{ name: "choice", types: ["uint32", "pair"] }],
};

const KEY = "PUB_K1_6zpSNY1YoLxNt2VsvJjoDfBueU6xC1M1ERJw1UoekL1NK2aD4t";
const VALUE = {
  owner: "alice.gm",
  flags: [1, 2, 255],
  big: "18446744073709551615",
  neg: "-9007199254740993",
  small: -2,
  count: 300,
  delta: -77,
  ok: true,
  note: null,
  blob: "00ff10",
  hash: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
  key: KEY,
  when: "2026-10-06T12:00:00",
  at: "2026-10-06T12:00:00.500",
  slot: "2026-10-06T12:00:00.500",
  sym: "4,EOS",
  code: "USDT",
  fee: { quantity: "0.0100 EOS", contract: "eosio.token" },
  pick: ["pair", { a: 7, b: "bob" }],
};

describe("names, keys and signatures", () => {
  it("names round-trip like WharfKit", () => {
    for (const n of ["eosio", "eosio.token", "alice.gm", "a", "zzzzzzzzzzzzj", "1", "core.vaulta", "tethertether"]) {
      expect(nameToBigInt(n)).toBe(Name.from(n).value.value.toString() === "" ? 0n : BigInt(Name.from(n).value.toString()));
      expect(nameFromBigInt(nameToBigInt(n))).toBe(n);
    }
    expect(isName("eosio.")).toBe(false);
    expect(isName("zzzzzzzzzzzzz")).toBe(false);
    expect(isAccountName("eosio.token")).toBe(true);
    expect(isAccountName("Eosio")).toBe(false);
    expect(isAccountName("toolongname123")).toBe(false);
  });

  it("keys: PUB_K1 and legacy EOS spellings, checksums enforced", () => {
    const wk = PublicKey.from(KEY);
    expect(hex(parsePublicKey(KEY))).toBe(hex(wk.data.array));
    expect(hex(parsePublicKey(wk.toLegacyString()))).toBe(hex(wk.data.array));
    expect(publicKeyString(parsePublicKey(KEY))).toBe(KEY);
    expect(() => parsePublicKey(`${KEY.slice(0, -1)}5`)).toThrow();
  });

  it("SIG_K1 strings match WharfKit", () => {
    const rs = fromHex("11".repeat(32) + "22".repeat(32));
    const s = signatureString(rs, 1);
    const wk = Signature.from(s);
    expect(wk.toString()).toBe(s);
    expect(wk.data.array[0]).toBe(32);
  });
});

describe("ABI serialisation", () => {
  it("encodes and decodes every supported type like WharfKit", () => {
    const mine = encodeActionData(DAPP_ABI, "doit", VALUE);
    const theirs = Serializer.encode({ object: VALUE, abi: ABI.from(DAPP_ABI as never), type: "doit" });
    expect(hex(mine)).toBe(theirs.hexString);
    const back = decodeActionData(DAPP_ABI, "doit", mine);
    expect(back).toEqual({ ...VALUE });
  });

  it("eosio.token transfer without an ABI round trip, and the transfer shape check", () => {
    const t = { from: "alice.gm", to: "bob", quantity: "1.5000 EOS", memo: "hi" };
    expect(hex(encodeActionData(TOKEN_ABI, "transfer", t))).toBe(Serializer.encode({ object: t, abi: ABI.from(TOKEN_ABI as never), type: "transfer" }).hexString);
    expect(isTokenTransfer(TOKEN_ABI, "transfer")).toBe(true);
    expect(isTokenTransfer(DAPP_ABI, "doit")).toBe(false);
  });

  it("refuses what it can't read", () => {
    const bad: Abi = { structs: [{ name: "x", base: "", fields: [{ name: "f", type: "float64" }] }], actions: [{ name: "x", type: "x" }] };
    expect(() => encodeActionData(bad, "x", { f: 1 })).toThrow(AbiError);
    expect(() => decodeActionData(bad, "x", new Uint8Array(8))).toThrow(AbiError);
    expect(() => decodeActionData(TOKEN_ABI, "transfer", fromHex("00"))).toThrow();
    expect(() => decodeActionData(TOKEN_ABI, "issue", new Uint8Array())).toThrow(AbiError);
    const t = encodeActionData(TOKEN_ABI, "transfer", { from: "a", to: "b", quantity: "1 X", memo: "" });
    expect(() => decodeActionData(TOKEN_ABI, "transfer", new Uint8Array([...t, 0]))).toThrow(/left over/);
  });
});

describe("transactions", () => {
  const data = hex(encodeActionData(TOKEN_ABI, "transfer", { from: "alice.gm", to: "bob", quantity: "1.5000 EOS", memo: "hi" }));
  const tx: TransactionJson = {
    expiration: "2026-10-06T12:00:00",
    ref_block_num: 4660,
    ref_block_prefix: 3735928559,
    max_net_usage_words: 0,
    max_cpu_usage_ms: 0,
    delay_sec: 0,
    context_free_actions: [],
    actions: [{ account: "eosio.token", name: "transfer", authorization: [{ actor: "alice.gm", permission: "active" }], data }],
    transaction_extensions: [],
  };
  const chainId = "73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d";

  it("packs, ids and digests like WharfKit", () => {
    const wk = Transaction.from({ ...tx, transaction_extensions: [], actions: tx.actions.map((a) => Action.from(a)) });
    const packed = packTransaction(tx);
    expect(hex(packed)).toBe(Serializer.encode({ object: wk }).hexString);
    expect(transactionId(packed)).toBe(wk.id.hexString);
    expect(hex(signingDigest(chainId, packed))).toBe(wk.signingDigest(chainId).hexString);
    expect(unpackTransaction(packed)).toEqual(tx);
  });

  it("TAPoS from a block id", () => {
    const id = "115295f5c53487176d0c821bfdf8bd44261573ace810f6fb68f38626cee854f3";
    expect(tapos(id)).toEqual({ ref_block_num: 0x95f5, ref_block_prefix: 0x1b820c6d });
  });
});
