import { type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import {
  createVirtualMachineBCH,
  decodeCashAddress as libDecode,
  decodeTransaction as libDecodeTx,
  encodeCashAddress as libEncode,
  encodeTransaction as libEncodeTx,
  generateSigningSerializationBCH,
  hash160 as libHash160,
  hash256,
  stringify,
} from "@bitauth/libauth";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import {
  BCH_CHIPNET,
  BCH_MAINNET,
  BCH_METHODS,
  BCH_TESTNET4,
  type BchTx,
  createBitcoinCashModule,
  decodeCashAddress,
  decodeTx,
  encodeCashAddress,
  encodeTx,
  messageHash,
  ownScript,
  p2pkhScript,
  scripthash,
  sighash,
  txidOf,
} from "../src/index.js";
import { fromHex, hash160, hex } from "../src/util.js";
import { type Handler, ctxFor, fakeElectrum, signer } from "./helpers.js";
import { FIX } from "./signatures.js";

const PUB = fromHex(FIX.publicKey);
const MINE = p2pkhScript(hash160(PUB));
const OTHER = p2pkhScript(hash160(fromHex(FIX.otherPublicKey)));
const SH = scripthash(MINE);
const CAT = "f0".repeat(16) + "0f".repeat(16);
const TX_A = "a1".repeat(32);
const TX_B = "b2".repeat(32);
const TX_C = "c3".repeat(32);

const coins = [
  { tx_hash: TX_A, tx_pos: 0, height: 300000, value: 50_000 },
  { tx_hash: TX_B, tx_pos: 1, height: 0, value: 20_000 },
  { tx_hash: TX_C, tx_pos: 2, height: 300001, value: 1000, token_data: { category: CAT, amount: "500" } },
];

function electrum(over: Partial<Record<string, (params: unknown[]) => unknown>> = {}, down: string[] = []) {
  const handler: Handler = (method, params) => {
    const f = over[method];
    if (f) return f(params);
    switch (method) {
      case "blockchain.scripthash.get_balance":
        return { confirmed: 50_000, unconfirmed: 21_000 };
      case "blockchain.scripthash.listunspent":
        return coins;
      case "blockchain.relayfee":
        return 0.00001;
      case "blockchain.transaction.broadcast":
        return hex(txidOf(fromHex(params[0] as string)));
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return fakeElectrum(handler, down);
}

const req = (method: string, params: unknown, extra: Partial<DappRequest> = {}): DappRequest => ({
  id: `r-${Math.random().toString(36).slice(2)}`,
  origin: "https://tapswap.example",
  via: "walletconnect",
  family: "bitcoincash",
  networkId: BCH_CHIPNET.id,
  method,
  params,
  ...extra,
});

async function run(mod: ReturnType<typeof createBitcoinCashModule>, r: DappRequest, ctx = ctxFor()) {
  const d = await mod.decode(r, ctx);
  const payloads = await mod.prepare(r, ctx, "approval-1");
  const result = await mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
  return { d, payloads, result };
}

/** libauth's BCH 2023 VM: every input's unlocking script runs against its source output. */
function vmVerify(raw: Uint8Array, sources: { locking: Uint8Array; value: bigint; token?: unknown }[]) {
  const transaction = libDecodeTx(raw);
  if (typeof transaction === "string") throw new Error(transaction);
  const sourceOutputs = sources.map((s) => ({ lockingBytecode: s.locking, valueSatoshis: s.value, ...(s.token ? { token: s.token } : {}) }));
  return createVirtualMachineBCH().verify({ transaction, sourceOutputs } as never);
}

describe("CashAddr", () => {
  const mod = createBitcoinCashModule();
  it("derives the P2PKH CashAddr of the abandon vector, as libauth encodes it", () => {
    expect(mod.addressFromPublicKey(PUB, BCH_MAINNET)).toBe(FIX.mainnet);
    expect(mod.addressFromPublicKey(PUB, BCH_CHIPNET)).toBe(FIX.testnet);
    expect(mod.addressFromPublicKey(secp256k1.Point.fromHex(FIX.publicKey).toBytes(false), BCH_TESTNET4)).toBe(FIX.testnet);
    expect(libEncode({ prefix: "bitcoincash", type: "p2pkh", payload: libHash160(PUB) }).address).toBe(FIX.mainnet);
    expect(mod.derivationPath(2)).toBe("m/44'/145'/0'/0/2");
  });

  it("decodes with or without prefix, checks the checksum and refuses legacy and mixed case", () => {
    expect(mod.isAddress(FIX.mainnet)).toBe(true);
    expect(mod.isAddress(FIX.mainnet.split(":")[1]!)).toBe(true);
    expect(mod.isAddress(FIX.mainnet.toUpperCase())).toBe(true);
    expect(mod.isAddress(FIX.mainnet.slice(0, -1) + "7")).toBe(false);
    expect(mod.isAddress("bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahQ3q6")).toBe(false);
    expect(mod.isAddress("1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu")).toBe(false);
    expect(mod.networksForAddress(FIX.testnet, [BCH_CHIPNET, BCH_TESTNET4, BCH_MAINNET]).map((n) => n.name)).toEqual(["Bitcoin Cash Chipnet", "Bitcoin Cash Testnet4"]);
    expect(mod.networksForAddress(FIX.mainnet.split(":")[1]!, [BCH_CHIPNET, BCH_MAINNET]).map((n) => n.id)).toEqual([BCH_MAINNET.id]);
  });

  it("token-aware and P2SH32 addresses agree with libauth", () => {
    const h32 = fromHex("ab".repeat(32));
    const z = libEncode({ prefix: "bchtest", type: "p2pkhWithTokens", payload: hash160(PUB) }).address;
    expect(encodeCashAddress("bchtest", 2, hash160(PUB))).toBe(z);
    expect(decodeCashAddress(z)).toMatchObject({ kind: "p2pkh", tokenAware: true, prefix: "bchtest" });
    const p2sh32 = libEncode({ prefix: "bitcoincash", type: "p2sh", payload: h32 }).address;
    expect(encodeCashAddress("bitcoincash", 1, h32)).toBe(p2sh32);
    expect(hex(decodeCashAddress(p2sh32)!.hash)).toBe(hex(h32));
    const lib = libDecode(FIX.otherMainnet);
    expect(typeof lib !== "string" && hex(lib.payload)).toBe(hex(hash160(fromHex(FIX.otherPublicKey))));
  });

  it("uses bip122 fork-block ids that don't collide with Bitcoin's", () => {
    expect(BCH_MAINNET.id).toBe("bip122:000000000000000000651ef99cb9fcbe");
    expect(BCH_CHIPNET.id).toBe("bip122:00000000040ba9641ba98a37b2e5ceea");
    expect(BCH_TESTNET4.id).toBe("bip122:000000001dd410c49a788668ce267517");
    expect([BCH_MAINNET.id, BCH_CHIPNET.id, BCH_TESTNET4.id]).not.toContain("bip122:000000000019d6689c085ae165831e93");
  });
});

describe("transactions and sighash match libauth", () => {
  const token = { category: fromHex(CAT), amount: 500n, nft: { capability: "mutable" as const, commitment: fromHex("c0ffee") } };
  const tx: BchTx = {
    version: 2,
    locktime: 123,
    inputs: [
      { txid: fromHex(TX_A), vout: 0, unlocking: new Uint8Array(), sequence: 0xfffffffe },
      { txid: fromHex(TX_C), vout: 2, unlocking: new Uint8Array(), sequence: 0xffffffff },
    ],
    outputs: [
      { value: 1000n, locking: OTHER, token },
      { value: 40_000n, locking: MINE },
      { value: 0n, locking: fromHex("6a0568656c6c6f") },
    ],
  };
  const lib = {
    version: 2,
    locktime: 123,
    inputs: tx.inputs.map((i) => ({ outpointTransactionHash: i.txid, outpointIndex: i.vout, unlockingBytecode: i.unlocking, sequenceNumber: i.sequence })),
    outputs: [
      { valueSatoshis: 1000n, lockingBytecode: OTHER, token: { category: token.category, amount: 500n, nft: { capability: "mutable" as const, commitment: token.nft.commitment } } },
      { valueSatoshis: 40_000n, lockingBytecode: MINE },
      { valueSatoshis: 0n, lockingBytecode: fromHex("6a0568656c6c6f") },
    ],
  };

  it("encodes token outputs and round-trips", () => {
    expect(hex(encodeTx(tx))).toBe(hex(libEncodeTx(lib)));
    expect(hex(encodeTx(decodeTx(encodeTx(tx))))).toBe(hex(encodeTx(tx)));
  });

  it("signing serialization (SIGHASH_ALL|FORKID) including a spent token prefix", () => {
    const sources = [
      { lockingBytecode: MINE, valueSatoshis: 50_000n },
      { lockingBytecode: MINE, valueSatoshis: 1000n, token: { category: fromHex(CAT), amount: 500n } },
    ];
    for (const i of [0, 1]) {
      const ser = generateSigningSerializationBCH({ inputIndex: i, sourceOutputs: sources, transaction: lib } as never, { coveredBytecode: MINE, signingSerializationType: Uint8Array.of(0x41) });
      const spent = i === 0 ? { value: 50_000n } : { value: 1000n, token: { category: fromHex(CAT), amount: 500n } };
      expect(hex(sighash(tx, i, spent, MINE))).toBe(hex(hash256(ser)));
    }
  });
});

describe("wallet sends", () => {
  it("buildTransfer: largest coins first, never a token coin, change to the same address; VM-valid", async () => {
    const e = electrum();
    const mod = createBitcoinCashModule({ factory: e.factory });
    const ctx = ctxFor();
    const r = await mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: FIX.otherTestnet, amount: "30000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, method: BCH_METHODS.signTransaction, family: "bitcoincash" });
    const { d, payloads, result } = await run(mod, r, ctx);
    expect(d.title).toBe("Send 0.0003 BCH to qp8sfd…q4lg");
    expect(d.lines).toEqual([
      { label: "To", value: FIX.otherTestnet },
      { label: "Amount", value: "0.0003 BCH" },
      { label: "You get back", value: "0.00019774 BCH (qqyx49…zx8x, the same address)" },
      { label: "Network fee", value: "0.00000226 BCH" },
    ]);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "bch" }), delta: "-30226" }]);
    expect(d.fee).toMatchObject({ amount: "226" });
    expect(payloads).toHaveLength(1);
    const out = result as { signedTransaction: string; signedTransactionHash: string };
    const raw = fromHex(out.signedTransaction);
    const signed = decodeTx(raw);
    expect(signed.inputs.map((i) => hex(i.txid))).toEqual([TX_A]);
    expect(signed.outputs.map((o) => [o.value, hex(o.locking)])).toEqual([
      [30_000n, hex(OTHER)],
      [19_774n, hex(MINE)],
    ]);
    expect(vmVerify(raw, [{ locking: MINE, value: 50_000n }])).toBe(true);
    const sent = e.calls.find((c) => c.method === "blockchain.transaction.broadcast");
    expect(sent?.params).toEqual([out.signedTransaction]);
    expect(out.signedTransactionHash).toBe(hex(txidOf(raw)));
    expect(e.calls.find((c) => c.method === "blockchain.scripthash.listunspent")?.params[0]).toBe(SH);
  });

  it("refuses a bad signature before broadcasting", async () => {
    const e = electrum();
    const mod = createBitcoinCashModule({ factory: e.factory });
    const ctx = ctxFor();
    const r = await mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: FIX.otherTestnet, amount: "30000" }, ctx);
    const [p] = await mod.prepare(r, ctx, "a");
    const good = signer.sign(p!);
    const bad = good.bytes.slice();
    bad[3] = bad[3]! ^ 1;
    await expect(mod.finalize(r, [{ ...good, bytes: bad }], ctx)).rejects.toMatchObject({ code: "bitcoincash/bad-signature" });
    expect(e.calls.some((c) => c.method === "blockchain.transaction.broadcast")).toBe(false);
  });

  it("refuses dust, own address, other-network and legacy addresses, and token coins can't pay", async () => {
    const mod = createBitcoinCashModule({ factory: electrum({ "blockchain.scripthash.listunspent": () => [coins[2]] }).factory });
    const ctx = ctxFor();
    await expect(mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: FIX.otherTestnet, amount: "545" }, ctx)).rejects.toMatchObject({ code: "bitcoincash/too-small" });
    await expect(mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: FIX.testnet, amount: "1000" }, ctx)).rejects.toMatchObject({ code: "bitcoincash/self-transfer" });
    await expect(mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: FIX.otherMainnet, amount: "1000" }, ctx)).rejects.toMatchObject({ code: "bitcoincash/network-mismatch" });
    await expect(mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", amount: "1000" }, ctx)).rejects.toMatchObject({ code: "bitcoincash/bad-address" });
    await expect(mod.buildTransfer({ asset: BCH_CHIPNET.nativeAsset, to: FIX.otherTestnet, amount: "600" }, ctx)).rejects.toMatchObject({ code: "bitcoincash/insufficient-funds" });
  });

  it("balances: confirmed + unconfirmed BCH and fungible CashTokens; falls back to the next server", async () => {
    const e = electrum({}, [BCH_CHIPNET.rpcUrls[0]!]);
    const mod = createBitcoinCashModule({ factory: e.factory });
    const b = await mod.getBalances(ctxFor());
    expect(b.map((x) => [x.asset.key, x.amount])).toEqual([
      ["bch", "71000"],
      [`cashtoken:${CAT}`, "500"],
    ]);
    expect(e.calls.every((c) => c.url === BCH_CHIPNET.rpcUrls[1])).toBe(true);
    expect(await mod.receiveAddress(ctxFor())).toBe(FIX.testnet);
    expect(await mod.receiveAddress(ctxFor(BCH_MAINNET))).toBe(FIX.mainnet);
  });

  it("all servers down: a plain-words error", async () => {
    const mod = createBitcoinCashModule({ factory: electrum({}, BCH_CHIPNET.rpcUrls).factory });
    await expect(mod.getBalances(ctxFor())).rejects.toMatchObject({ code: "bitcoincash/offline" });
  });
});

describe("dapp requests (wc2-bch-bcr)", () => {
  const contractInput = { outpointTransactionHash: fromHex(TX_B), outpointIndex: 0, sequenceNumber: 0xfffffffe, unlockingBytecode: fromHex("0051") };
  const appTx = (unlockingOther = contractInput.unlockingBytecode) => ({
    version: 2,
    locktime: 0,
    inputs: [{ ...contractInput, unlockingBytecode: unlockingOther }, { outpointTransactionHash: fromHex(TX_A), outpointIndex: 0, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array() }],
    outputs: [
      { lockingBytecode: OTHER, valueSatoshis: 5000n, token: { category: fromHex(CAT), amount: 100n } },
      { lockingBytecode: MINE, valueSatoshis: 45_500n },
    ],
  });
  const sources = (unlockingOther = contractInput.unlockingBytecode) => [
    { ...contractInput, unlockingBytecode: unlockingOther, lockingBytecode: fromHex("a914" + "11".repeat(20) + "87"), valueSatoshis: 5000n, token: { category: fromHex(CAT), amount: 100n }, contract: { artifact: { contractName: "MarketOrder" } } },
    { outpointTransactionHash: fromHex(TX_A), outpointIndex: 0, sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array(), lockingBytecode: MINE, valueSatoshis: 50_000n },
  ];

  it("bch_signTransaction (libauth stringify, no broadcast): decodes and signs only our input", async () => {
    const e = electrum();
    const mod = createBitcoinCashModule({ factory: e.factory });
    const r = req(BCH_METHODS.signTransaction, { transaction: stringify(appTx()), sourceOutputs: stringify(sources()), broadcast: false, userPrompt: "Buy token" });
    const { d, payloads, result } = await run(mod, r);
    // tokens go to the token-aware ("z") spelling of the same P2PKH
    const z = encodeCashAddress("bchtest", 2, hash160(fromHex(FIX.otherPublicKey)));
    expect(d.title).toBe(`Send to ${z.slice(8, 14)}…${z.slice(-4)}`);
    expect(d.lines).toContainEqual({ label: "Amount", value: `0.00005 BCH + 100 × CT-${CAT.slice(0, 6)}` });
    expect(d.lines).toContainEqual({ label: "App contract", value: "MarketOrder" });
    expect(d.lines).toContainEqual({ label: "App says (unverified)", value: "Buy token" });
    expect(d.lines).toContainEqual({ label: "Sent by", value: "tapswap.example (it gets the signed transaction)" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "bch" }), delta: "-4500" }]);
    expect(d.fee).toMatchObject({ amount: "4500" });
    expect(payloads).toHaveLength(1);
    expect(e.calls.some((c) => c.method === "blockchain.transaction.broadcast")).toBe(false);
    const signed = decodeTx(fromHex((result as { signedTransaction: string }).signedTransaction));
    expect(hex(signed.inputs[0]!.unlocking)).toBe("0051");
    expect(signed.inputs[1]!.unlocking.length).toBeGreaterThan(100);
  });

  it("refuses CashScript placeholders, someone else's inputs, and other networks; garbage is blind", async () => {
    const mod = createBitcoinCashModule({ factory: electrum().factory });
    const ctx = ctxFor();
    const placeholder = new Uint8Array([0x41, ...new Uint8Array(65), 0x21, ...new Uint8Array(33)]);
    await expect(mod.decode(req(BCH_METHODS.signTransaction, { transaction: stringify(appTx(placeholder)), sourceOutputs: stringify(sources(placeholder)) }), ctx)).rejects.toMatchObject({
      code: "bitcoincash/unsupported-contract",
    });
    const notMine = sources().map((s) => ({ ...s, lockingBytecode: OTHER }));
    await expect(mod.decode(req(BCH_METHODS.signTransaction, { transaction: stringify(appTx()), sourceOutputs: stringify(notMine) }), ctx)).rejects.toMatchObject({ code: "bitcoincash/not-a-signer" });
    await expect(mod.decode(req(BCH_METHODS.signMessage, { message: "hi" }, { networkId: BCH_MAINNET.id }), ctx)).rejects.toMatchObject({ code: "bitcoincash/network-mismatch" });
    const garbage = req(BCH_METHODS.signTransaction, { transaction: "0200ff", sourceOutputs: "[]" });
    const d = await mod.decode(garbage, ctx);
    expect(d.blind).toBe(true);
    await expect(mod.prepare(garbage, ctx, "a")).rejects.toMatchObject({ code: "bitcoincash/bad-transaction" });
  });

  it("warns when our own CashTokens leave the wallet", async () => {
    const mod = createBitcoinCashModule({ factory: electrum().factory });
    const tx = {
      version: 2,
      locktime: 0,
      inputs: [{ outpointTransactionHash: fromHex(TX_C), outpointIndex: 2, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }],
      outputs: [{ lockingBytecode: OTHER, valueSatoshis: 800n, token: { category: fromHex(CAT), amount: 500n } }],
    };
    const src = [{ ...tx.inputs[0]!, lockingBytecode: MINE, valueSatoshis: 1000n, token: { category: fromHex(CAT), amount: 500n } }];
    const d = await mod.decode(req(BCH_METHODS.signTransaction, { transaction: stringify(tx), sourceOutputs: stringify(src) }), ctxFor());
    expect(d.warnings[0]).toMatchObject({ code: "inscribed-utxo", level: "caution" });
    expect(d.warnings[0]!.msg?.id).toBe("bg.bch.spendsTokens");
    expect(d.balanceChanges).toContainEqual({ asset: expect.objectContaining({ key: `cashtoken:${CAT}` }), delta: "-500" });
  });

  it("bch_signMessage: Electron Cash format, base64, recovers to the account key", async () => {
    const mod = createBitcoinCashModule({ factory: electrum().factory });
    const r = req(BCH_METHODS.signMessage, { message: "Clip Wallet dapp matrix: sign-in check (testnet)" });
    const { d, result } = await run(mod, r);
    expect(d.title).toBe("Sign a message for tapswap.example");
    const sig = Uint8Array.from(atob(result as string), (c) => c.charCodeAt(0));
    expect(sig[0] === 31 || sig[0] === 32).toBe(true);
    const s = secp256k1.Signature.fromBytes(sig.subarray(1), "compact").addRecoveryBit(sig[0]! - 31);
    expect(hex(s.recoverPublicKey(messageHash("Clip Wallet dapp matrix: sign-in check (testnet)")).toBytes(true))).toBe(FIX.publicKey);
    expect(hex(messageHash("hello"))).toBe(hex(hash256(new Uint8Array([24, ...new TextEncoder().encode("Bitcoin Signed Message:\n"), 5, ...new TextEncoder().encode("hello")]))));
    expect(hex(ownScript(ctxFor()))).toBe(hex(MINE));
  });
});
