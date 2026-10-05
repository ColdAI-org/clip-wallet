/**
 * Fresh change addresses (Phase 2): the background passes vault-derived change addresses through
 * ChainContext; coins on them are signed with SignablePayload.derivationSubPath. Public data only; the
 * change-input signature in signatures.ts was produced offline.
 */
import type { ChainContext, ChildAddress, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base64, hex } from "@scure/base";
import { Transaction, p2wpkh } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { segwitAddress } from "../src/keys.js";
import { createBitcoinModule } from "../src/module.js";
import { TX_OPTS } from "../src/psbt.js";
import { BOB_T4, MY_TR_T4, MY_WPKH_T4, SEND_ROUTES, T4, TEST_ACCOUNT, mockFetch, type MockFetch } from "./helpers.js";
import { CHANGE_SPEND_SIG } from "./signatures.js";

/** BIP-84 change key m/84'/0'/0'/1/1 of the public "abandon … about" vector (encoded for testnet4 here). */
const CHANGE_PUB = "03dcf71df71c755b3af46f7e84b4182e6291cec5a8c630f775638a739da29adcb6";
const CHANGE: ChildAddress = {
  address: segwitAddress(hex.decode(CHANGE_PUB), T4),
  publicKey: CHANGE_PUB,
  derivationPath: "m/84'/0'/0'/1/1",
  derivationSubPath: "1/1",
};

const stats = (txCount: number) => ({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: txCount }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } });

function ctxWith(m: MockFetch, extra: Partial<ChainContext>): ChainContext {
  return { network: T4, account: TEST_ACCOUNT, fetch: m.fetch, ...extra };
}

function changeOutput(psbt: string) {
  const tx = Transaction.fromPSBT(base64.decode(psbt), TX_OPTS);
  return tx.getOutput(tx.outputsLength - 1);
}

describe("change goes to a fresh vault-derived address", () => {
  it("buildTransfer asks for a fresh change address and decode still calls it the user's change", async () => {
    let calls = 0;
    const m = mockFetch(SEND_ROUTES);
    const c = ctxWith(m, { freshChangeAddress: async () => (calls++, CHANGE) });
    const mod = createBitcoinModule({ newId: () => "send-c" });
    const req = await mod.buildTransfer({ asset: T4.nativeAsset, to: BOB_T4, amount: "120000" }, c);
    expect(calls).toBe(1);
    const psbt = (req.params as { inputs: { psbt: string }[] }).inputs[0]!.psbt;
    expect(hex.encode(changeOutput(psbt).script!)).toBe(hex.encode(p2wpkh(hex.decode(CHANGE_PUB)).script));
    // decode runs with the same context the background would pass (fresh address not yet in changeAddresses).
    const d = await mod.decode(req, ctxWith(m, {}));
    expect(d.title).toBe(`Send 0.0012 BTC to ${BOB_T4.slice(0, 7)}…${BOB_T4.slice(-4)}`);
    expect(d.lines).toContainEqual({ label: "Change back to you", value: "0.00029604 BTC" });
    expect(d.balanceChanges[0]!.delta).toBe("-120396");
  });

  it("reuses a handed-out change address that was never used, instead of widening the gap", async () => {
    const m = mockFetch({ ...SEND_ROUTES, [`/address/${CHANGE.address}/utxo`]: [], [`/address/${CHANGE.address}`]: stats(0) });
    let calls = 0;
    const c = ctxWith(m, { changeAddresses: [CHANGE], freshChangeAddress: async () => (calls++, CHANGE) });
    const req = await createBitcoinModule().buildTransfer({ asset: T4.nativeAsset, to: BOB_T4, amount: "120000" }, c);
    expect(calls).toBe(0);
    expect(hex.encode(changeOutput((req.params as { inputs: { psbt: string }[] }).inputs[0]!.psbt).script!)).toBe(hex.encode(p2wpkh(hex.decode(CHANGE_PUB)).script));
  });

  it("refuses a change address that doesn't match its key", async () => {
    const m = mockFetch(SEND_ROUTES);
    const c = ctxWith(m, { freshChangeAddress: async () => ({ ...CHANGE, address: BOB_T4 }) });
    await expect(createBitcoinModule().buildTransfer({ asset: T4.nativeAsset, to: BOB_T4, amount: "120000" }, c)).rejects.toMatchObject({ code: "bad-change-address" });
  });

  it("without change support, change returns to the primary address (v1)", async () => {
    const m = mockFetch(SEND_ROUTES);
    const req = await createBitcoinModule().buildTransfer({ asset: T4.nativeAsset, to: BOB_T4, amount: "120000" }, ctxWith(m, {}));
    expect(hex.encode(changeOutput((req.params as { inputs: { psbt: string }[] }).inputs[0]!.psbt).script!)).toBe(hex.encode(p2wpkh(hex.decode(TEST_ACCOUNT.publicKey)).script));
  });
});

describe("coins on change addresses", () => {
  const CHANGE_UTXO = "e".repeat(64);
  const routes = {
    [`/address/${MY_WPKH_T4}/utxo`]: [],
    [`/address/${MY_TR_T4}/utxo`]: [],
    [`/address/${CHANGE.address}/utxo`]: [{ txid: CHANGE_UTXO, vout: 1, value: 200_000, status: { confirmed: true } }],
    [`/address/${CHANGE.address}`]: stats(1),
    "/fee-estimates": { "3": 2 },
    "/tx": "f".repeat(64),
  };

  async function spend() {
    const m = mockFetch(routes);
    const c = ctxWith(m, { changeAddresses: [CHANGE] });
    const mod = createBitcoinModule({ newId: () => "spend-change" });
    const req = await mod.buildTransfer({ asset: T4.nativeAsset, to: BOB_T4, amount: "120000" }, c);
    return { m, c, mod, req };
  }

  it("are spendable: prepare asks the vault for the change key via derivationSubPath", async () => {
    const { c, mod, req } = await spend();
    const d = await mod.decode(req, c);
    expect(d.lines).toContainEqual(expect.objectContaining({ label: "Your coin 1", value: "0.002 BTC" }));
    const payloads = await mod.prepare(req, c, "ap");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ accountId: "bitcoin:0", scheme: "ecdsa-secp256k1", derivationSubPath: "1/1", approvalId: "ap" });
    // The offline fixture signature (made with the change key) verifies only if the digest used the change key's scriptCode.
    expect(secp256k1.verify(hex.decode(CHANGE_SPEND_SIG), payloads[0]!.bytes, hex.decode(CHANGE_PUB), { prehash: false })).toBe(true);
  });

  it("finalize puts the change key in the witness and broadcasts", async () => {
    const { c, mod, req, m } = await spend();
    await mod.prepare(req, c, "ap");
    const sig: Signature = { scheme: "ecdsa-secp256k1", bytes: hex.decode(CHANGE_SPEND_SIG), publicKey: CHANGE_PUB };
    expect(await mod.finalize(req, [sig], c)).toEqual([{ txid: "f".repeat(64), psbt: expect.any(String) }]);
    const signed = Transaction.fromRaw(hex.decode(m.requests.find((r) => r.method === "POST")!.body!), TX_OPTS);
    expect(hex.encode(signed.getInput(0).finalScriptWitness![1]!)).toBe(CHANGE_PUB);
  });

  it("a signature from the account key is rejected for a change input", async () => {
    const { c, mod, req } = await spend();
    await mod.prepare(req, c, "ap");
    const wrong: Signature = { scheme: "ecdsa-secp256k1", bytes: new Uint8Array(64).fill(1), publicKey: TEST_ACCOUNT.publicKey };
    await expect(mod.finalize(req, [wrong], c)).rejects.toMatchObject({ code: "bad-signature" });
  });

  it("balances include change addresses", async () => {
    const bal = (f: number) => ({ chain_stats: { funded_txo_sum: f, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } });
    const m = mockFetch({ [`/address/${MY_WPKH_T4}`]: bal(1_000), [`/address/${MY_TR_T4}`]: bal(0), [`/address/${CHANGE.address}`]: bal(200_000) });
    expect((await createBitcoinModule().getBalances(ctxWith(m, { changeAddresses: [CHANGE] })))[0]!.amount).toBe("201000");
  });
});
