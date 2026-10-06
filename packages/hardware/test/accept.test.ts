/**
 * acceptSignature: the background's side when the device ran somewhere else (the approval window).
 * The signature comes from a replayed Ledger session (test/fixtures/ledger-evm-sign-tx.apdus); the
 * accepting keyring has no device signers at all, only accounts and approvals.
 */
import { describe, expect, it } from "vitest";
import { ClipError, type Signature, type SignablePayload } from "@clip-wallet/core";
import { HardwareKeyring, fromWire, signatureFromWire, signatureToWire, toWire, type HardwareAccount } from "../src/core.js";
import * as I from "./inputs.js";
import { approve, keyringWith, memoryStorage, replay } from "./helpers.js";

const evm = I.ACCOUNTS.evm.accounts as HardwareAccount[];
const SEPOLIA = "eip155:11155111";

async function code(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ClipError);
  return (e as ClipError).code;
}

/** The approved payload and the Ledger's signature over it. */
async function deviceSignature(): Promise<{ payload: SignablePayload; sig: Signature }> {
  const tx = I.evmTx();
  const payload = I.payload(evm[0]!.id, "ecdsa-secp256k1", tx.digest, { format: "evm-tx", bytes: tx.raw, chainId: I.SEPOLIA });
  const { signer, store } = replay("evm-sign-tx");
  const device = await keyringWith(signer, evm);
  approve(device, payload);
  const sig = await device.sign(payload, { request: I.request("evm", "eth_sendTransaction", SEPOLIA), decoded: I.decoded(SEPOLIA) });
  store.ensureQueueEmpty();
  return { payload, sig };
}

async function verifier(): Promise<HardwareKeyring> {
  const k = new HardwareKeyring({ storage: memoryStorage() });
  await k.addAccounts(evm);
  return k;
}

describe("acceptSignature (device signed elsewhere, background verifies)", () => {
  it("accepts the device's signature over the approved payload, once", async () => {
    const { payload, sig } = await deviceSignature();
    const k = await verifier();
    approve(k, payload);
    expect(k.isApproved(payload)).toBe(true);
    // Through the wire form, as the approval window sends it.
    const got = await k.acceptSignature(payload, signatureFromWire(signatureToWire(sig)));
    expect(got).toEqual(sig);
    expect(k.isApproved(payload)).toBe(false);
    // Replay: the same signature again is refused.
    expect(await code(k.acceptSignature(payload, sig))).toBe("hw/no-approval");
  });

  it("rejects a bad signature and keeps the approval for the real one", async () => {
    const { payload, sig } = await deviceSignature();
    const k = await verifier();
    approve(k, payload);
    const flipped = new Uint8Array(sig.bytes);
    flipped[10]! ^= 1;
    expect(await code(k.acceptSignature(payload, { ...sig, bytes: flipped }))).toBe("hw/bad-signature");
    expect(await code(k.acceptSignature(payload, { ...sig, recovery: 1 - sig.recovery! }))).toBe("hw/bad-signature");
    expect(await code(k.acceptSignature(payload, { ...sig, scheme: "ed25519" }))).toBe("hw/bad-signature");
    expect(await code(k.acceptSignature(payload, { ...sig, bytes: new Uint8Array(3) }))).toBe("hw/bad-signature");
    await expect(k.acceptSignature(payload, sig)).resolves.toEqual(sig);
  });

  it("rejects a signature by another key (another account's device)", async () => {
    const { payload, sig } = await deviceSignature();
    const k = new HardwareKeyring({ storage: memoryStorage() });
    const other = { ...evm[1]!, id: evm[0]!.id, index: 0 };
    await k.addAccounts([other]);
    approve(k, payload);
    expect(await code(k.acceptSignature(payload, sig))).toBe("hw/bad-signature");
  });

  it("rejects a signature for anything but the approved payload", async () => {
    const { payload, sig } = await deviceSignature();
    const k = await verifier();
    approve(k, payload);
    // Different bytes: the signature doesn't verify over them.
    const otherBytes = { ...payload, bytes: new Uint8Array(32).fill(7) };
    expect(await code(k.acceptSignature(otherBytes, sig))).toBe("hw/bad-signature");
    // Same digest, different raw (what the device was shown): never approved.
    const otherRaw = { ...payload, raw: { ...payload.raw!, bytes: new Uint8Array([1, 2, 3]) } };
    expect(await code(k.acceptSignature(otherRaw, sig))).toBe("hw/no-approval");
    // Another approval id.
    expect(await code(k.acceptSignature({ ...payload, approvalId: "someone-else" }, sig))).toBe("hw/no-approval");
    // Nothing registered at all.
    const fresh = await verifier();
    expect(await code(fresh.acceptSignature(payload, sig))).toBe("hw/no-approval");
    // The real one still goes through.
    await expect(k.acceptSignature(payload, sig)).resolves.toEqual(sig);
  });

  it("refuses after lock and after revoke", async () => {
    const { payload, sig } = await deviceSignature();
    const k = await verifier();
    approve(k, payload);
    k.lock();
    expect(await code(k.acceptSignature(payload, sig))).toBe("hw/no-approval");
    approve(k, payload);
    k.revokeApproval(payload.approvalId);
    expect(await code(k.acceptSignature(payload, sig))).toBe("hw/no-approval");
  });

  it("refuses account records that disagree with their id", async () => {
    const k = new HardwareKeyring({ storage: memoryStorage() });
    for (const bad of [
      { ...evm[0]!, index: 5 },
      { ...evm[0]!, family: "solana" as const },
      { ...evm[0]!, curve: "ed25519" as const },
      { ...evm[0]!, publicKey: "zz" },
      { ...evm[0]!, hardware: { ...evm[0]!.hardware, fingerprint: "00000000" } },
      { ...evm[0]!, hardware: { ...evm[0]!.hardware, kind: "keystone" as const } },
    ]) {
      expect(await code(k.addAccounts([bad]))).toBe("hw/unknown-account");
    }
    expect(await k.accounts()).toEqual([]);
  });
});

describe("wire form", () => {
  it("round-trips bytes and bigints through JSON", () => {
    const v = { a: new Uint8Array([0, 255]), b: [1n, "x", { c: new Uint8Array() }], d: undefined, e: null };
    const back = fromWire<typeof v>(JSON.parse(JSON.stringify(toWire(v))));
    expect(back).toEqual({ a: new Uint8Array([0, 255]), b: [1n, "x", { c: new Uint8Array() }], e: null });
  });
});

describe("audit HW-01: a hardware account's address is derived from its public key", () => {
  const A = I.ACCOUNTS as unknown as Record<"evm" | "solana" | "bitcoin" | "hedera", { accounts: HardwareAccount[] }>;
  const [evm0, sol0, btc0, hed0] = [A.evm.accounts[0]!, A.solana.accounts[0]!, A.bitcoin.accounts[0]!, A.hedera.accounts[0]!];

  it("refuses a record whose address isn't its key's (a page or QR could name any address)", async () => {
    const k = new HardwareKeyring({ storage: memoryStorage() });
    for (const bad of [
      { ...evm0, address: A.evm.accounts[1]!.address },
      { ...evm0, address: "0x000000000000000000000000000000000000dEaD" },
      { ...sol0, address: "11111111111111111111111111111111" },
      { ...btc0, address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx" },
      // The right key's address on the wrong network.
      { ...btc0, address: "bc1q6rz28mcfaxtmd6v789l9rrlrusdprr9p276ldv" },
      // A Hedera Ed25519 key has no address of its own; a page can't name one, or an account id.
      { ...hed0, address: "0.0.1234" },
      { ...hed0, hederaAccountId: "0.0.1234" },
    ]) {
      expect(await code(k.addAccounts([bad]))).toBe("hw/unknown-account");
    }
    expect(await k.accounts()).toEqual([]);
  });

  it("refuses a Bitcoin record whose key isn't the one its xpub gives at its path", async () => {
    const k = new HardwareKeyring({ storage: memoryStorage() });
    const other = A.bitcoin.accounts[1]!;
    for (const bad of [
      { ...btc0, publicKey: other.publicKey, address: other.address },
      { ...btc0, hardware: { ...btc0.hardware, addressIndex: 1 } },
      { ...btc0, hardware: { ...btc0.hardware, accountPath: "m/84'/1'/1'" } },
    ]) {
      expect(await code(k.addAccounts([bad]))).toBe("hw/unknown-account");
    }
  });

  it("stores the derived address (EIP-55 for EVM) and keeps working for honest records", async () => {
    const k = new HardwareKeyring({ storage: memoryStorage() });
    await k.addAccounts([{ ...evm0, address: evm0.address.toLowerCase() }, sol0, btc0, hed0]);
    const byFamily = Object.fromEntries((await k.accounts()).map((a) => [a.family, a.address]));
    expect(byFamily).toEqual({ evm: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", solana: sol0.address, bitcoin: btc0.address, hedera: "" });
  });

  it("updateAccount can't change the address to another one", async () => {
    const k = new HardwareKeyring({ storage: memoryStorage() });
    await k.addAccounts([evm0]);
    expect(await code(k.updateAccount(evm0.id, { address: A.evm.accounts[1]!.address }))).toBe("hw/unknown-account");
    expect((await k.account(evm0.id))!.address).toBe(evm0.address);
    await k.updateAccount(evm0.id, { label: "Cold" });
    expect((await k.account(evm0.id))!.label).toBe("Cold");
  });
});
