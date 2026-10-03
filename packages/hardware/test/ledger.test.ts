/**
 * Ledger, replayed from APDU sessions recorded against the real Ledger apps (Ethereum 1.22.5,
 * Solana 1.15.2, Bitcoin Test 2.5.1, Hedera 1.9.2) in Speculos on a Nano S Plus, seeded with the public
 * BIP-39 test vector. The replayer fails the test if our code sends any APDU byte that differs.
 */
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ClipError } from "@clip-wallet/core";
import type { HardwareAccount } from "../src/index.js";
import { hardwarePath } from "../src/index.js";
import * as I from "./inputs.js";
import { approve, fixture, keyringWith, replay } from "./helpers.js";

const evm = I.ACCOUNTS.evm.accounts as HardwareAccount[];
const sol = I.ACCOUNTS.solana.accounts as HardwareAccount[];
const hed = I.ACCOUNTS.hedera.accounts as HardwareAccount[];
const btc = I.ACCOUNTS.bitcoin.accounts as HardwareAccount[];
const SEPOLIA = "eip155:11155111";

async function rejects(p: Promise<unknown>, code: string, words?: RegExp): Promise<ClipError> {
  const e = await p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
  if (words) expect((e as ClipError).userMessage).toMatch(words);
  return e as ClipError;
}

describe("Ledger accounts match the vault's paths (same phrase, same accounts)", () => {
  it("EVM m/44'/60'/0'/0/i", async () => {
    const { signer, store } = replay("evm-accounts");
    const list = await signer.listAccounts("evm", 0, 2);
    store.ensureQueueEmpty();
    expect(list).toEqual(evm);
    // packages/vault/test/vectors.test.ts: the vault's evm:0 for the same phrase
    expect(list[0]!.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(list[0]!.derivationPath).toBe("m/44'/60'/0'/0/0");
    expect(list[0]!.id).toMatch(/^hw:ledger:[0-9a-f]{8}:evm:0$/);
  });

  it("EVM Ledger Live style m/44'/60'/i'/0/0 is offered separately", async () => {
    const { signer, store } = replay("evm-accounts-live");
    const [a] = await signer.listAccounts("evm", 1, 1, { pathStyle: "ledger-live" });
    store.ensureQueueEmpty();
    expect(a!.derivationPath).toBe("m/44'/60'/1'/0/0");
    expect(a!.id.endsWith(":ledger-live")).toBe(true);
  });

  it("Solana m/44'/501'/i'/0'", async () => {
    const { signer, store } = replay("solana-accounts");
    const list = await signer.listAccounts("solana", 0, 2);
    store.ensureQueueEmpty();
    expect(list).toEqual(sol);
    expect(list[0]!.address).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
  });

  it("Bitcoin BIP-84 m/84'/1'/0'/0/i from the account xpub, with the real master fingerprint", async () => {
    const { signer, store } = replay("bitcoin-accounts");
    const list = await signer.listAccounts("bitcoin", 0, 2);
    store.ensureQueueEmpty();
    expect(list).toEqual(btc);
    expect(list[0]!.hardware.fingerprint).toBe("73c5da0a");
    expect(list[0]!.address).toBe("tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl");
    expect(list[1]!.derivationPath).toBe("m/84'/1'/0'/0/1");
    expect(list[0]!.hardware.accountXpub).toMatch(/^tpub/);
  });

  it("Hedera: Ed25519 at m/44'/3030'/0'/0'/i' (the Ledger app has no ECDSA keys)", async () => {
    const { signer, store } = replay("hedera-accounts");
    const list = await signer.listAccounts("hedera", 0, 2);
    store.ensureQueueEmpty();
    expect(list).toEqual(hed);
    expect(list[1]!.curve).toBe("ed25519");
    expect(list[1]!.derivationPath).toBe(hardwarePath("hedera", 1));
    expect(list[1]!.address).toBe("");
  });
});

describe("Ledger signing through the keyring (approval-bound, signature checked)", () => {
  it("EVM transaction: device gets the full RLP and returns a signature over the approved digest", async () => {
    const tx = I.evmTx();
    const p = I.payload(evm[0]!.id, "ecdsa-secp256k1", tx.digest, { format: "evm-tx", bytes: tx.raw, chainId: I.SEPOLIA });
    const { signer, store } = replay("evm-sign-tx");
    const k = await keyringWith(signer, evm);
    approve(k, p);
    const sig = await k.sign(p, { request: I.request("evm", "eth_sendTransaction", SEPOLIA), decoded: I.decoded(SEPOLIA) });
    store.ensureQueueEmpty();
    expect(sig.scheme).toBe("ecdsa-secp256k1");
    const rec = secp256k1.Signature.fromBytes(sig.bytes, "compact").addRecoveryBit(sig.recovery!).recoverPublicKey(tx.digest);
    expect(rec.toHex(true)).toBe(evm[0]!.publicKey);
    // one approval, one signature
    await rejects(k.sign(p, { request: I.request("evm", "eth_sendTransaction", SEPOLIA), decoded: I.decoded(SEPOLIA) }), "hw/no-approval");
  });

  it("EVM personal_sign", async () => {
    const m = I.evmPersonal();
    const p = I.payload(evm[0]!.id, "ecdsa-secp256k1", m.digest, { format: "evm-personal", bytes: m.raw });
    const { signer, store } = replay("evm-sign-personal");
    const k = await keyringWith(signer, evm);
    approve(k, p);
    const sig = await k.sign(p, { request: I.request("evm", "personal_sign", SEPOLIA), decoded: I.decoded(SEPOLIA) });
    store.ensureQueueEmpty();
    expect(sig.bytes).toHaveLength(64);
  });

  it("EVM EIP-712 (full typed data sent to the device)", async () => {
    const t = I.evm712();
    const p = I.payload(evm[0]!.id, "ecdsa-secp256k1", t.digest, { format: "eip712", bytes: t.raw });
    const { signer, store } = replay("evm-sign-712");
    const k = await keyringWith(signer, evm);
    approve(k, p);
    await k.sign(p, { request: I.request("evm", "eth_signTypedData_v4", SEPOLIA), decoded: I.decoded(SEPOLIA) });
    store.ensureQueueEmpty();
  });

  it("Solana transaction", async () => {
    const m = I.solTransfer(sol[0]!.publicKey);
    const p = I.payload(sol[0]!.id, "ed25519", m, { format: "solana-tx", bytes: m });
    const { signer, store } = replay("solana-sign-tx");
    const k = await keyringWith(signer, sol);
    approve(k, p);
    const sig = await k.sign(p, { request: I.request("solana", "solana:signTransaction", "solana:devnet"), decoded: I.decoded("solana:devnet") });
    store.ensureQueueEmpty();
    expect(sig.scheme).toBe("ed25519");
  });

  it("Hedera transaction body, signed by key index 1 (the JS lib can only do index 0)", async () => {
    const body = I.hederaTransferBody();
    const p = I.payload(hed[1]!.id, "ed25519", body, { format: "hedera-body", bytes: body });
    const { signer, store } = replay("hedera-sign");
    const k = await keyringWith(signer, hed);
    approve(k, p);
    await k.sign(p, { request: I.request("hedera", "hedera_signTransaction", "hedera:testnet"), decoded: I.decoded("hedera:testnet") });
    store.ensureQueueEmpty();
    expect(fixture("ledger-hedera-sign.apdus")).toMatch(/=> e0040000..01000000/); // index 1, little-endian
  });

  it("Bitcoin PSBT: wallet policy wpkh(@0/**), signature over the approved BIP-143 sighash", async () => {
    const t = I.btcPsbt(btc[0]!.publicKey);
    const p = I.payload(btc[0]!.id, "ecdsa-secp256k1", t.digest, { format: "psbt", bytes: t.psbt, inputIndex: 0 });
    const { signer, store } = replay("bitcoin-sign-psbt");
    const k = await keyringWith(signer, btc);
    approve(k, p);
    await k.sign(p, { request: I.request("bitcoin", "signPsbt", "bip122:testnet"), decoded: I.decoded("bip122:testnet") });
    store.ensureQueueEmpty();
  });

  it("Bitcoin BIP-137 message", async () => {
    const m = I.btcMessage();
    const p = I.payload(btc[0]!.id, "ecdsa-secp256k1", m.digest, { format: "bitcoin-message", bytes: m.raw });
    const { signer, store } = replay("bitcoin-sign-message");
    const k = await keyringWith(signer, btc);
    approve(k, p);
    await k.sign(p, { request: I.request("bitcoin", "signMessage", "bip122:testnet"), decoded: I.decoded("bip122:testnet") });
    store.ensureQueueEmpty();
  });
});

describe("Ledger errors in plain words", () => {
  const pm = I.evmPersonal();
  const p = I.payload(evm[0]!.id, "ecdsa-secp256k1", pm.digest, { format: "evm-personal", bytes: pm.raw });
  const ctx = { request: I.request("evm", "personal_sign", SEPOLIA), decoded: I.decoded(SEPOLIA) };

  it("rejected on the device", async () => {
    const { signer } = replay("evm-reject");
    const k = await keyringWith(signer, evm);
    approve(k, p);
    await rejects(k.sign(p, ctx), "hw/rejected", /You rejected this on your hardware wallet/);
  });

  it("blind signing off (EIP-712 the app can't clear-sign)", async () => {
    const t = I.evm712();
    const q = I.payload(evm[0]!.id, "ecdsa-secp256k1", t.digest, { format: "eip712", bytes: t.raw });
    const { signer } = replay("evm-sign-712-blind-off");
    const k = await keyringWith(signer, evm);
    approve(k, q);
    await rejects(k.sign(q, ctx), "hw/blind-signing-off", /turn on "Blind signing" in the Ethereum app/);
  });

  it("wrong app open (recorded: the Solana app answering an EVM request)", async () => {
    const { signer } = replay("solana-wrong-app");
    await rejects(signer.listAccounts("evm", 0, 1), "hw/wrong-app", /^Open the Ethereum app on your Ledger/);
  });

  // The next three are hand-written exchanges (status words from Ledger's docs), not recordings.
  it("locked device", async () => {
    const { signer } = replay("=> b001000000\n<= 5515\n", { raw: true });
    await rejects(signer.listAccounts("evm", 0, 1), "hw/locked", /^Unlock your Ledger/);
  });

  it("on the dashboard (no app open)", async () => {
    // GET_APP_AND_VERSION from the dashboard reports "BOLOS"
    const { signer } = replay("=> b001000000\n<= 0105424f4c4f5305312e302e3001029000\n", { raw: true });
    await rejects(signer.listAccounts("solana", 0, 1), "hw/wrong-app", /^Open the Solana app on your Ledger/);
  });

  it("a different Ledger (or passphrase) than the one the account came from", async () => {
    const { signer } = replay("evm-sign-tx");
    const other = { ...evm[0]!, publicKey: evm[1]!.publicKey };
    const tx = I.evmTx();
    const q = I.payload(other.id, "ecdsa-secp256k1", tx.digest, { format: "evm-tx", bytes: tx.raw });
    const k = await keyringWith(signer, [other]);
    approve(k, q);
    await rejects(k.sign(q, ctx), "hw/wrong-device", /different recovery phrase/);
  });

  it("no raw: the Ethereum app can't sign a bare digest, so we stop before touching the device", async () => {
    const { signer, store } = replay(fixture("ledger-evm-sign-tx.apdus").split("\n").slice(0, 4).join("\n"), { raw: true });
    const q = I.payload(evm[0]!.id, "ecdsa-secp256k1", I.evmTx().digest);
    const k = await keyringWith(signer, evm);
    approve(k, q);
    await rejects(k.sign(q, ctx), "hw/no-raw");
    store.ensureQueueEmpty();
  });

  it("raw that doesn't hash to the approved bytes is refused before the device sees it", async () => {
    const { signer } = replay(fixture("ledger-evm-sign-tx.apdus").split("\n").slice(0, 4).join("\n"), { raw: true });
    const tx = I.evmTx();
    const q = I.payload(evm[0]!.id, "ecdsa-secp256k1", I.evmPersonal().digest, { format: "evm-tx", bytes: tx.raw });
    const k = await keyringWith(signer, evm);
    approve(k, q);
    await rejects(k.sign(q, ctx), "hw/bad-signature");
  });

  it("Solana messages: the Ledger app only signs its off-chain envelope, so we refuse", async () => {
    const { signer } = replay(fixture("ledger-solana-sign-tx.apdus").split("\n").slice(0, 4).join("\n"), { raw: true });
    const msg = new TextEncoder().encode("Sign in to clip.test");
    const q = I.payload(sol[0]!.id, "ed25519", msg, { format: "solana-message", bytes: msg });
    const k = await keyringWith(signer, sol);
    approve(k, q);
    await rejects(k.sign(q, { request: I.request("solana", "solana:signMessage", "solana:devnet"), decoded: I.decoded("solana:devnet") }), "hw/unsupported", /Solana sign-in messages/);
  });

  it("unapproved payloads never reach the device", async () => {
    const { signer, store } = replay("", { raw: true });
    const k = await keyringWith(signer, evm);
    await rejects(k.sign(p, ctx), "hw/no-approval");
    store.ensureQueueEmpty();
  });
});
