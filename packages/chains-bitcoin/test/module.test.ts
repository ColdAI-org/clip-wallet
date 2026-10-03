import type { DappRequest, Signature } from "@clip-wallet/core";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { base64, hex } from "@scure/base";
import { RawWitness, SigHash, Transaction, p2tr, p2wpkh } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { createBitcoinModule } from "../src/module.js";
import { BITCOIN_MAINNET, BITCOIN_NETWORKS, BITCOIN_SIGNET, BITCOIN_TESTNET4, networkById } from "../src/networks.js";
import { ownScripts, ownTaprootAddress, taprootOutputKey } from "../src/keys.js";
import { TX_OPTS } from "../src/psbt.js";
import { BIP84_TR_T4, BOB_T4, MY_TR_T4, MY_WPKH_T4, NO_TAPROOT_ACCOUNT, OTHER_PUB, SEND_ROUTES, T4, TEST_ACCOUNT, UTXO_A, UTXO_C, ctx, mockFetch } from "./helpers.js";
import { MSG_SIGS, SEND_PSBT, SEND_SIGS } from "./signatures.js";

const pub = TEST_ACCOUNT.publicKey;
const ecdsa = (h: string): Signature => ({ scheme: "ecdsa-secp256k1", bytes: hex.decode(h.length === 130 ? h.slice(2) : h), publicKey: pub });
const schnorrSig = (h: string): Signature => ({ scheme: "schnorr-secp256k1", bytes: hex.decode(h), publicKey: pub });
const SEND_SIGNATURES = [ecdsa(SEND_SIGS[0]), schnorrSig(SEND_SIGS[1])];

async function sendRequest(mod = createBitcoinModule({ newId: () => "send-1" }), routes: Record<string, unknown> = SEND_ROUTES) {
  const m = mockFetch(routes);
  const c = ctx(m);
  const req = await mod.buildTransfer({ asset: c.network.nativeAsset, to: BOB_T4, amount: "120000" }, c);
  return { mod, m, c, req };
}

/** A dapp PSBT: one foreign P2WPKH input, one of ours, paying the foreign party. */
function marketplacePsbt(ourSighash?: number) {
  const tx = new Transaction(TX_OPTS);
  const foreign = p2wpkh(OTHER_PUB).script;
  const own = ownScripts(TEST_ACCOUNT);
  tx.addInput({ txid: hex.decode("11".repeat(32)), index: 0, witnessUtxo: { script: foreign, amount: 10_000n } });
  const ours: Parameters<Transaction["addInput"]>[0] = { txid: hex.decode("22".repeat(32)), index: 3, witnessUtxo: { script: own.wpkh, amount: 50_000n } };
  if (ourSighash !== undefined) ours.sighashType = ourSighash;
  tx.addInput(ours);
  tx.addOutput({ script: foreign, amount: 40_000n });
  tx.addOutput({ script: own.wpkh, amount: 19_000n });
  return base64.encode(tx.toPSBT());
}

const req = (method: string, params: unknown, via: "injected" | "walletconnect" = "injected", origin = "https://market.example.com"): DappRequest => ({
  id: `${method}-${Math.random()}`,
  origin,
  via,
  family: "bitcoin",
  networkId: BITCOIN_TESTNET4,
  method,
  params,
});

describe("networks and addresses", () => {
  it("CAIP-2 ids from genesis hashes", () => {
    expect(BITCOIN_NETWORKS.map((n) => n.id)).toEqual([
      "bip122:000000000019d6689c085ae165831e93",
      "bip122:00000000da84f2bafbbc53dee25a72ae",
      "bip122:00000008819873e925422c1ff0f99f7c",
    ]);
    expect(BITCOIN_NETWORKS.filter((n) => n.testnet).map((n) => n.id)).toEqual([BITCOIN_TESTNET4, BITCOIN_SIGNET]);
  });

  it("isAddress: bech32, bech32m, legacy; rejects junk and EVM", () => {
    const mod = createBitcoinModule();
    for (const a of ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", MY_WPKH_T4, MY_TR_T4]) {
      expect(mod.isAddress(a)).toBe(true);
    }
    for (const a of ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", "hello"]) expect(mod.isAddress(a)).toBe(false);
  });

  it("networksForAddress: mainnet vs both testnets (→ network-matters)", () => {
    const mod = createBitcoinModule();
    expect(mod.networksForAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", BITCOIN_NETWORKS).map((n) => n.id)).toEqual([BITCOIN_MAINNET]);
    expect(mod.networksForAddress(MY_WPKH_T4, BITCOIN_NETWORKS).map((n) => n.id)).toEqual([BITCOIN_TESTNET4, BITCOIN_SIGNET]);
  });

  it("addressFromPublicKey encodes per network", () => {
    const mod = createBitcoinModule();
    expect(mod.addressFromPublicKey(hex.decode(pub), networkById(BITCOIN_MAINNET)!)).toBe(TEST_ACCOUNT.address);
    expect(mod.addressFromPublicKey(hex.decode(pub), networkById(BITCOIN_TESTNET4)!)).toMatch(/^tb1q/);
  });
});

describe("balances", () => {
  it("sums P2WPKH and P2TR addresses, confirmed + mempool", async () => {
    const mod = createBitcoinModule();
    const stats = (f: number, s: number, mf = 0, ms = 0) => ({ chain_stats: { funded_txo_sum: f, spent_txo_sum: s }, mempool_stats: { funded_txo_sum: mf, spent_txo_sum: ms } });
    const m = mockFetch({ [`/address/${MY_WPKH_T4}`]: stats(100_000, 20_000, 5_000), [`/address/${MY_TR_T4}`]: stats(1_000, 0, 0, 500) });
    expect(await mod.getBalances(ctx(m))).toEqual([{ asset: expect.objectContaining({ key: "btc-testnet", decimals: 8 }), amount: "85500" }]);
  });

  it("lists inscriptions as NFTs only with an ord index", async () => {
    const ord = "https://ord.example";
    const mod = createBitcoinModule({ ordinalsIndexUrls: { [BITCOIN_TESTNET4]: ord } });
    const m = mockFetch({ [`/address/${MY_TR_T4}`]: { inscriptions: ["abc123i0"] }, [`/address/${MY_WPKH_T4}`]: { inscriptions: [] } });
    const n = await mod.getNfts(ctx(m));
    expect(n).toEqual([expect.objectContaining({ standard: "ordinal", tokenId: "abc123i0", mediaUrl: `${ord}/content/abc123i0` })]);
    expect(await createBitcoinModule().getNfts(ctx(m))).toEqual([]);
  });
});

describe("send: buildTransfer → decode → prepare → finalize", () => {
  it("builds the PSBT with largest-first coins, RBF and change to the primary address", async () => {
    const { req } = await sendRequest();
    expect(req).toMatchObject({ id: "send-1", method: "bitcoin:signAndSendTransaction", family: "bitcoin", networkId: BITCOIN_TESTNET4 });
    const psbt = (req.params as { inputs: { psbt: string }[] }).inputs[0]!.psbt;
    expect(psbt).toBe(SEND_PSBT);
    const tx = Transaction.fromPSBT(base64.decode(psbt), TX_OPTS);
    expect([hex.encode(tx.getInput(0).txid!), hex.encode(tx.getInput(1).txid!)]).toEqual([UTXO_A, UTXO_C]); // 100k then 50k
    expect(tx.getInput(0).sequence).toBe(0xfffffffd);
    expect(tx.getOutput(0).amount).toBe(120_000n);
    expect(tx.getOutput(1).amount).toBe(150_000n - 120_000n - 396n); // 198 vB × 2 sat/vB
  });

  it("decodes in plain words with fee, change and the ordinals caution", async () => {
    const { mod, c, req } = await sendRequest();
    const d = await mod.decode(req, c);
    expect(d.title).toBe(`Send 0.0012 BTC to ${BOB_T4.slice(0, 7)}…${BOB_T4.slice(-4)}`);
    expect(d.fee).toEqual({ asset: expect.objectContaining({ key: "btc-testnet" }), amount: "396" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ symbol: "BTC" }), delta: "-120396" }]);
    expect(d.lines).toContainEqual({ label: "Change back to you", value: "0.00029604 BTC" });
    expect(d.lines).toContainEqual({ label: "Can be sped up later", value: "Yes" });
    expect(d.lines.find((l) => l.label === "Network fee")?.value).toMatch(/^0.00000396 BTC \(\d+(\.\d)? sat\/vB\)$/);
    expect(d.simulated).toBe(true);
    expect(d.warnings.map((w) => w.code)).toEqual(["simulation-failed"]); // no ord index → can't check collectibles
  });

  it("prepare: BIP-143 ecdsa digest + BIP-341 schnorr digest with the merkle root (empty, BIP-86)", async () => {
    const { mod, c, req } = await sendRequest();
    const payloads = await mod.prepare(req, c, "approval-9");
    expect(payloads.map((p) => p.scheme)).toEqual(["ecdsa-secp256k1", "schnorr-secp256k1"]);
    expect(payloads.every((p) => p.approvalId === "approval-9" && p.accountId === "bitcoin:0" && p.bytes.length === 32)).toBe(true);
    // The fixture signatures came from @scure/btc-signer's own signer: they verify only if our digests match its sighash.
    const own = ownScripts(TEST_ACCOUNT);
    expect(secp256k1.verify(hex.decode(SEND_SIGS[0]), payloads[0]!.bytes, own.pubkey, { prehash: false })).toBe(true);
    expect(schnorr.verify(hex.decode(SEND_SIGS[1]), payloads[1]!.bytes, own.trOutputKey!)).toBe(true);
    // The vault computes H_TapTweak(P ‖ merkleRoot) itself: we hand it the merkle root, never the tweak.
    expect(payloads[1]!.options?.taprootTweak).toEqual(new Uint8Array(0));
    expect(payloads[0]!.options).toBeUndefined();
  });

  it("finalize: inserts signatures, finalizes, broadcasts and returns the txid", async () => {
    const { mod, c, req, m } = await sendRequest();
    await mod.prepare(req, c, "a");
    const res = (await mod.finalize(req, SEND_SIGNATURES, c)) as { txid: string; psbt: string }[];
    expect(res[0]!.txid).toBe("f".repeat(64));
    const post = m.requests.find((r) => r.method === "POST")!;
    expect(post.url).toBe("https://mempool.space/testnet4/api/tx");
    const signed = Transaction.fromRaw(hex.decode(post.body!), TX_OPTS);
    expect(signed.isFinal).toBe(true);
    const w0 = signed.getInput(0).finalScriptWitness!;
    expect(w0).toHaveLength(2); // DER sig + pubkey
    expect(w0[0]![w0[0]!.length - 1]).toBe(SigHash.ALL);
    expect(signed.getInput(1).finalScriptWitness).toHaveLength(1); // 64-byte schnorr, SIGHASH_DEFAULT
    expect(signed.getInput(1).finalScriptWitness![0]).toHaveLength(64);
    expect(mod.pendingCount()).toBe(0);
  });

  it("normalises a high-s ECDSA signature", async () => {
    const { mod, c, req } = await sendRequest();
    await mod.prepare(req, c, "a");
    const n = secp256k1.Point.CURVE().n;
    const s = secp256k1.Signature.fromBytes(hex.decode(SEND_SIGS[0]), "compact");
    const high = new secp256k1.Signature(s.r, n - s.s).toBytes("compact");
    await expect(mod.finalize(req, [ecdsa(hex.encode(high)), SEND_SIGNATURES[1]!], c)).resolves.toBeTruthy();
  });

  it("rejects a wrong signature and broadcasts nothing", async () => {
    const { mod, c, req, m } = await sendRequest();
    await mod.prepare(req, c, "a");
    await expect(mod.finalize(req, [SEND_SIGNATURES[0]!, schnorrSig(MSG_SIGS.tr)], c)).rejects.toMatchObject({ code: "bad-signature" });
    await expect(mod.finalize(req, [SEND_SIGNATURES[0]!], c)).rejects.toMatchObject({ code: "signature-count" });
    expect(m.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("skips unconfirmed coins and refuses when funds are short", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch(SEND_ROUTES));
    await expect(mod.buildTransfer({ asset: c.network.nativeAsset, to: BOB_T4, amount: "500000" }, c)).rejects.toMatchObject({ code: "insufficient-funds" });
    await expect(mod.buildTransfer({ asset: c.network.nativeAsset, to: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", amount: "1" }, c)).rejects.toMatchObject({ code: "bad-address" });
  });
});

describe("ordinals guard", () => {
  const ord = "https://ord.example";
  const inscribedA = { [`/output/${UTXO_A}:0`]: { inscriptions: ["x"] } };

  it("with an index: inscribed coins are never selected", async () => {
    const mod = createBitcoinModule({ ordinalsIndexUrls: { [BITCOIN_TESTNET4]: ord }, newId: () => "o" });
    const routes = { ...SEND_ROUTES, ...inscribedA, [`/output/${"b".repeat(64)}:1`]: { inscriptions: [] }, [`/output/${UTXO_C}:0`]: { inscriptions: [] } };
    const c = ctx(mockFetch(routes));
    const r = await mod.buildTransfer({ asset: c.network.nativeAsset, to: BOB_T4, amount: "40000" }, c);
    const tx = Transaction.fromPSBT(base64.decode((r.params as { inputs: { psbt: string }[] }).inputs[0]!.psbt), TX_OPTS);
    const used = Array.from({ length: tx.inputsLength }, (_, i) => hex.encode(tx.getInput(i).txid!));
    expect(used).not.toContain(UTXO_A);
    const d = await mod.decode(r, c);
    expect(d.warnings).toEqual([]);
  });

  it("with an index: a dapp PSBT spending an inscribed coin is refused", async () => {
    const mod = createBitcoinModule({ ordinalsIndexUrls: { [BITCOIN_TESTNET4]: ord } });
    const c = ctx(mockFetch(inscribedA));
    const r = req("bitcoin:signTransaction", { inputs: [{ psbt: SEND_PSBT, inputsToSign: [] }] });
    const d = await mod.decode(r, c);
    expect(d.warnings.find((w) => w.code === "inscribed-utxo")?.level).toBe("danger");
    await expect(mod.prepare(r, c, "a")).rejects.toMatchObject({ code: "inscribed-utxo" });
  });
});

describe("dapp PSBTs (Wallet Standard / sats-connect / WalletConnect)", () => {
  it("marketplace-style: foreign input, ours signed with SINGLE|ANYONECANPAY → caution", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch({}));
    const psbt = marketplacePsbt(SigHash.SINGLE_ANYONECANPAY);
    const r = req("bitcoin:signTransaction", { inputs: [{ psbt, inputsToSign: [{ address: MY_WPKH_T4, signingIndexes: [1], sigHash: SigHash.SINGLE_ANYONECANPAY }] }] });
    const d = await mod.decode(r, c);
    expect(d.title).toBe("Pay 0.00031 BTC in a transaction from market.example.com");
    expect(d.lines).toContainEqual({ label: "Other coin 1", value: "0.0001 BTC" });
    expect(d.lines).toContainEqual({ label: "Your coin 2", value: "0.0005 BTC" });
    expect(d.fee).toBeUndefined(); // not all inputs are ours: we don't claim who pays
    expect(d.warnings.find((w) => w.code === "blind-signing")?.level).toBe("caution");
    const payloads = await mod.prepare(r, c, "a");
    expect(payloads).toHaveLength(1);
  });

  it("SIGHASH_NONE → danger", async () => {
    const mod = createBitcoinModule();
    const r = req("signPsbt", { psbt: marketplacePsbt(), signInputs: [{ address: MY_WPKH_T4, index: 1, sighashTypes: [SigHash.NONE] }] }, "walletconnect");
    const d = await mod.decode(r, ctx(mockFetch({})));
    expect(d.warnings.find((w) => w.code === "blind-signing")).toMatchObject({ level: "danger" });
  });

  it("refuses to sign an input that isn't ours", async () => {
    const mod = createBitcoinModule();
    const r = req("signPsbt", { psbt: marketplacePsbt(), signInputs: { [MY_WPKH_T4]: [0] } }, "walletconnect");
    await expect(mod.decode(r, ctx(mockFetch({})))).rejects.toMatchObject({ code: "not-our-input" });
  });

  it("refuses inputsToSign for another account's address", async () => {
    const mod = createBitcoinModule();
    const r = req("bitcoin:signTransaction", { inputs: [{ psbt: marketplacePsbt(), inputsToSign: [{ address: BOB_T4, signingIndexes: [1] }] }] });
    await expect(mod.decode(r, ctx(mockFetch({})))).rejects.toMatchObject({ code: "wrong-account" });
  });

  it("WalletConnect signPsbt returns { psbt } with our input finalized", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch(SEND_ROUTES));
    const r = req("signPsbt", { psbt: SEND_PSBT, signInputs: [{ address: MY_WPKH_T4, index: 0 }, { address: MY_TR_T4, index: 1 }], broadcast: false }, "walletconnect");
    await mod.prepare(r, c, "a");
    const res = (await mod.finalize(r, SEND_SIGNATURES, c)) as { psbt: string };
    const tx = Transaction.fromPSBT(base64.decode(res.psbt), TX_OPTS);
    expect(tx.getInput(0).finalScriptWitness).toBeTruthy();
    expect(tx.isFinal).toBe(true);
  });

  it("WalletConnect sendTransfer builds, signs and returns { txid }", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch(SEND_ROUTES));
    const r = { ...req("sendTransfer", { account: MY_WPKH_T4, recipientAddress: BOB_T4, amount: "120000" }, "walletconnect"), id: "wc-send" };
    const d = await mod.decode(r, c);
    expect(d.title).toMatch(/^Send 0.0012 BTC to /);
    await mod.prepare(r, c, "a");
    expect(await mod.finalize(r, SEND_SIGNATURES, c)).toEqual({ txid: "f".repeat(64) });
  });

  it("injected bitcoin:sendTransfer (sats-connect recipients) uses the same path", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch(SEND_ROUTES));
    const r = { ...req("bitcoin:sendTransfer", { recipients: [{ address: BOB_T4, amount: 120000 }] }), id: "inj-send" };
    await mod.prepare(r, c, "a");
    expect(await mod.finalize(r, SEND_SIGNATURES, c)).toEqual({ txid: "f".repeat(64) });
  });

  it("rejects malformed input in plain words", async () => {
    const mod = createBitcoinModule();
    await expect(mod.decode(req("bitcoin:signTransaction", { inputs: [{ psbt: "not a psbt" }] }), ctx(mockFetch({})))).rejects.toMatchObject({ code: "bad-psbt" });
    await expect(mod.decode(req("bitcoin:teleport", {}), ctx(mockFetch({})))).rejects.toMatchObject({ code: "unsupported-method" });
  });
});

describe("messages", () => {
  const hello = base64.encode(new TextEncoder().encode("Hello Clip"));

  it("bitcoin:signMessage (BIP-322 simple, P2WPKH)", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch({}));
    const r = { ...req("bitcoin:signMessage", { inputs: [{ address: MY_WPKH_T4, message: hello }] }, "injected", "https://app.example.com"), id: "msgWpkh" };
    const d = await mod.decode(r, c);
    expect(d.title).toBe("Sign a message for app.example.com");
    expect(d.lines[0]).toEqual({ label: "Message", value: "Hello Clip" });
    const [p] = await mod.prepare(r, c, "a");
    expect(p!.scheme).toBe("ecdsa-secp256k1");
    const [out] = (await mod.finalize(r, [{ ...ecdsa(MSG_SIGS.wpkh), recovery: 1 }], c)) as { signature: string; signedMessage: string; protocol: string }[];
    expect(out!.protocol).toBe("bip322");
    expect(out!.signedMessage).toBe(hello);
    const w = RawWitness.decode(base64.decode(out!.signature));
    expect(hex.encode(w[1]!)).toBe(pub);
    expect(w[0]![w[0]!.length - 1]).toBe(SigHash.ALL);
  });

  it("WalletConnect signMessage on the taproot address (BIP-322, schnorr + tweak)", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch({}));
    const r = { ...req("signMessage", { address: MY_TR_T4, message: "Hello Clip" }, "walletconnect"), id: "msgTr" };
    const [p] = await mod.prepare(r, c, "a");
    expect(p!.scheme).toBe("schnorr-secp256k1");
    expect(p!.options?.taprootTweak).toEqual(new Uint8Array(0));
    const out = (await mod.finalize(r, [schnorrSig(MSG_SIGS.tr)], c)) as { address: string; signature: string };
    expect(out.address).toBe(MY_TR_T4);
    expect(RawWitness.decode(base64.decode(out.signature))[0]).toHaveLength(64);
  });

  it("legacy ECDSA (BIP-137) signature for P2WPKH has header 39 + recovery", async () => {
    const mod = createBitcoinModule();
    const c = ctx(mockFetch({}));
    const r = { ...req("signMessage", { message: "Hello Clip", protocol: "ecdsa" }, "walletconnect"), id: "msgEcdsa" };
    await mod.prepare(r, c, "a");
    const out = (await mod.finalize(r, [ecdsa(MSG_SIGS.ecdsa)], c)) as { signature: string };
    const bytes = base64.decode(out.signature);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(39 + 0);
  });

  it("sign-in message for another domain → domain-mismatch", async () => {
    const mod = createBitcoinModule();
    const text = `bank.example.net wants you to sign in with your Bitcoin account:\n${MY_WPKH_T4}`;
    const r = req("signMessage", { address: MY_WPKH_T4, message: text }, "walletconnect", "https://evil.example.com");
    const d = await mod.decode(r, ctx(mockFetch({})));
    expect(d.title).toBe("Sign in to bank.example.net");
    expect(d.warnings.find((w) => w.code === "domain-mismatch")?.level).toBe("danger");
  });

  it("refuses a message for an address that isn't ours", async () => {
    const mod = createBitcoinModule();
    await expect(mod.decode(req("signMessage", { address: BOB_T4, message: "x" }, "walletconnect"), ctx(mockFetch({})))).rejects.toMatchObject({ code: "wrong-account" });
  });
});

describe("taproot keys (BIP-86 key from Account.taprootPublicKey)", () => {
  it("taproot scripts come from the BIP-86 key, not the BIP-84 key", () => {
    const own = ownScripts(TEST_ACCOUNT);
    expect(hex.encode(own.trInternalKey!)).toBe("cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115");
    expect(hex.encode(own.tr!)).toBe(hex.encode(p2tr(own.trInternalKey!).script));
    expect(hex.encode(own.trOutputKey!)).toBe("a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c"); // BIP-86 vector
    expect(own.trOutputKey).toEqual(taprootOutputKey(own.trInternalKey!));
    expect(ownTaprootAddress(TEST_ACCOUNT, networkById(BITCOIN_MAINNET)!)).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    expect(MY_TR_T4).not.toBe(BIP84_TR_T4);
  });

  it("a P2TR coin of the BIP-84 key is not the account's", async () => {
    const tx = new Transaction(TX_OPTS);
    tx.addInput({ txid: hex.decode("33".repeat(32)), index: 0, witnessUtxo: { script: p2tr(hex.decode(TEST_ACCOUNT.publicKey).slice(1)).script, amount: 10_000n } });
    tx.addOutput({ script: p2wpkh(OTHER_PUB).script, amount: 9_000n });
    const r = req("signPsbt", { psbt: base64.encode(tx.toPSBT()), signInputs: [{ address: MY_TR_T4, index: 0 }] }, "walletconnect");
    await expect(createBitcoinModule().decode(r, ctx(mockFetch({})))).rejects.toMatchObject({ code: "not-our-input" });
  });

  it("refuses a key-path input whose merkle root doesn't give our output key", async () => {
    const own = ownScripts(TEST_ACCOUNT);
    const tx = new Transaction(TX_OPTS);
    tx.addInput({ txid: hex.decode("44".repeat(32)), index: 0, witnessUtxo: { script: own.tr!, amount: 10_000n }, tapInternalKey: own.trInternalKey!, tapMerkleRoot: new Uint8Array(32).fill(7) });
    tx.addOutput({ script: p2wpkh(OTHER_PUB).script, amount: 9_000n });
    const r = req("signPsbt", { psbt: base64.encode(tx.toPSBT()), signInputs: [{ address: MY_TR_T4, index: 0 }] }, "walletconnect");
    await expect(createBitcoinModule().prepare(r, ctx(mockFetch({})), "a")).rejects.toMatchObject({ code: "unsupported-script" });
  });

  describe("an account without taprootPublicKey (hardware, older background)", () => {
    const noTr = (m: ReturnType<typeof mockFetch>) => ({ network: T4, account: NO_TAPROOT_ACCOUNT, fetch: m.fetch });

    it("has no taproot scripts, address or balance lookups", async () => {
      expect(ownScripts(NO_TAPROOT_ACCOUNT).tr).toBeUndefined();
      expect(() => ownTaprootAddress(NO_TAPROOT_ACCOUNT, T4)).toThrow(/Taproot \(bc1p…\) addresses aren't available/);
      const m = mockFetch({ [`/address/${MY_WPKH_T4}`]: { chain_stats: { funded_txo_sum: 7, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } } });
      expect((await createBitcoinModule().getBalances(noTr(m)))[0]!.amount).toBe("7");
      expect(m.requests.some((r) => r.url.includes("tb1p"))).toBe(false);
    });

    it("sends from P2WPKH coins only", async () => {
      const m = mockFetch(SEND_ROUTES);
      const r = await createBitcoinModule().buildTransfer({ asset: T4.nativeAsset, to: BOB_T4, amount: "60000" }, noTr(m));
      const tx = Transaction.fromPSBT(base64.decode((r.params as { inputs: { psbt: string }[] }).inputs[0]!.psbt), TX_OPTS);
      expect(Array.from({ length: tx.inputsLength }, (_, i) => hex.encode(tx.getInput(i).txid!))).toEqual([UTXO_A]);
      expect(m.requests.some((q) => q.url.includes(MY_TR_T4))).toBe(false);
    });

    it("taproot message or PSBT signer → plain taproot-unavailable message", async () => {
      const mod = createBitcoinModule();
      const msg = req("signMessage", { address: MY_TR_T4, message: "Hello Clip" }, "walletconnect");
      await expect(mod.decode(msg, noTr(mockFetch({})))).rejects.toMatchObject({ code: "taproot-unavailable", userMessage: expect.stringMatching(/^Taproot/) });
      const psbt = req("signPsbt", { psbt: SEND_PSBT, signInputs: [{ address: MY_TR_T4, index: 1 }] }, "walletconnect");
      await expect(mod.decode(psbt, noTr(mockFetch({})))).rejects.toMatchObject({ code: "taproot-unavailable" });
    });
  });
});

describe("raw payloads for hardware wallets", () => {
  it("every input payload carries the whole PSBT and its input index", async () => {
    const { mod, c, req } = await sendRequest();
    const payloads = await mod.prepare(req, c, "a");
    expect(payloads.map((p) => p.raw?.format)).toEqual(["psbt", "psbt"]);
    expect(payloads.map((p) => p.raw?.inputIndex)).toEqual([0, 1]);
    const tx = Transaction.fromPSBT(payloads[0]!.raw!.bytes, TX_OPTS);
    expect(tx.inputsLength).toBe(2);
    expect(payloads[1]!.raw!.bytes).toBe(payloads[0]!.raw!.bytes);
  });
});
