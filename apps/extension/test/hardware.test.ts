/**
 * Hardware accounts, end to end with a recorded Ledger session (APDU replay from packages/hardware/test/fixtures):
 * the account picked for EVM is the Ledger one, approve() asks the approval window (SignAgent) to run the device,
 * and the background verifies the signature against its own copy of the approved payload before finalize().
 * Messages go through the bus schema and JSON, as between the page and the service worker. No keys, no device.
 */
import { describe, expect, it, vi } from "vitest";
import { ClipError, type ChainModule, type DappRequest, type Signature, type SignablePayload } from "@clip-wallet/core";
import { HardwareKeyring, assertVerifies, signatureToWire, type HardwareAccount, type HardwareSigner } from "@clip-wallet/hardware";
import { readFileSync } from "node:fs";
import { keyringWith, memoryStorage, replay } from "../../../packages/hardware/test/helpers";
import * as I from "../../../packages/hardware/test/inputs";
import { SignAgent } from "../src/pages/hardware/agent";
import { Request } from "../src/shared/messages";
import type { HardwareSignJob } from "../src/shared/hardware-job";
import { PASSWORD, makeService } from "./helpers";

const ACCOUNTS = JSON.parse(readFileSync(new URL("../../../packages/hardware/test/fixtures/accounts.json", import.meta.url), "utf8"));
const LEDGER_EVM: HardwareAccount = ACCOUNTS.evm.accounts[0];
const SEPOLIA = "eip155:11155111";
const json = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** A wallet whose EVM account is the Ledger one, and an EVM module that prepares one transaction payload. */
async function setup() {
  const s = makeService();
  const { service, deps } = s;
  await service.handle({ type: "createWallet", password: PASSWORD });
  // The background's keyring only verifies: it holds no device signers.
  deps.hardware = new HardwareKeyring({ storage: memoryStorage() });
  await service.handle(Request.parse(json({ type: "hwAddAccounts", accounts: [LEDGER_EVM] })));
  const tx = I.evmTx();
  const out = { finalized: [] as Signature[] };
  const evm: ChainModule = {
    ...deps.chains.evm!,
    decode: async (r) => ({ requestId: r.id, title: "Send 0.01 ETH", lines: [], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId: r.networkId }),
    prepare: async (_r, ctx, approvalId) => [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: tx.digest, approvalId, raw: { format: "evm-tx", bytes: tx.raw, chainId: 11155111 } }],
    finalize: async (_r, sigs) => {
      out.finalized = sigs;
      return { txHash: "0xabc" };
    },
  };
  deps.chains.evm = evm;
  await service.handle({ type: "hwSetActive", family: "evm", accountId: LEDGER_EVM.id });
  /** The bus as the approval window sees it: zod-validated, JSON both ways. */
  const call = async (m: unknown) => json(await service.handle(Request.parse(json(m))));
  return { ...s, tx, out, call };
}

/** Starts a dapp request and approves it; returns the approve() and request promises. */
async function approveOne(service: Awaited<ReturnType<typeof setup>>["service"], env: Awaited<ReturnType<typeof setup>>["env"]) {
  const req: DappRequest = { id: "r1", origin: "wallet", via: "injected", family: "evm", networkId: SEPOLIA, method: "eth_sendTransaction", params: [] };
  const done = service.request(req);
  done.catch(() => undefined);
  await vi.waitFor(() => expect(env.opened).toHaveLength(1));
  const id = env.opened[0]!;
  const approved = service.handle({ type: "approve", id });
  approved.catch(() => undefined);
  return { id, done, approved };
}

async function errCode(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ClipError);
  return (e as ClipError).code;
}

/** The job the background hands the approval window, once approve() registered the payload. */
async function waitForJob(call: (m: unknown) => Promise<unknown>): Promise<HardwareSignJob> {
  let job: HardwareSignJob | undefined;
  await vi.waitFor(async () => {
    job = ((await call({ type: "hwSignJobs" })) as HardwareSignJob[])[0];
    expect(job).toBeDefined();
  });
  return job!;
}

/** The Ledger's real signature over a different message (personal_sign fixture) by the same account. */
async function otherSignature(): Promise<Signature> {
  const m = I.evmPersonal();
  const p: SignablePayload = I.payload(LEDGER_EVM.id, "ecdsa-secp256k1", m.digest, { format: "evm-personal", bytes: m.raw });
  const { signer } = replay("evm-sign-personal");
  const k = await keyringWith(signer, [LEDGER_EVM]);
  k.registerApproval(p.approvalId, [p], 60_000);
  return k.sign(p, { request: I.request("evm", "personal_sign", SEPOLIA), decoded: I.decoded(SEPOLIA) });
}

describe("hardware accounts: the approval window signs, the background verifies", () => {
  it("signs an approved EVM transaction on the Ledger in the window and finalizes with the verified signature", async () => {
    const { service, env, tx, out, call } = await setup();
    expect(service.cachedAccount("evm")?.id).toBe(LEDGER_EVM.id);
    expect(await service.handle({ type: "hwListAccounts" })).toEqual([expect.objectContaining({ id: LEDGER_EVM.id, active: true })]);

    const { signer, store } = replay("evm-sign-tx");
    const agent = new SignAgent({ call, signer: async () => signer, cancelDevice: () => undefined, exchange: () => undefined });
    const { done, approved } = await approveOne(service, env);
    await waitForJob(call);
    // The window wakes on the background's change broadcast.
    await agent.poll();
    await agent.idle();
    await expect(approved).resolves.toBeUndefined();
    await expect(done).resolves.toEqual({ txHash: "0xabc" });
    store.ensureQueueEmpty();

    expect(out.finalized).toHaveLength(1);
    expect(() => assertVerifies(out.finalized[0]!, { accountId: LEDGER_EVM.id, scheme: "ecdsa-secp256k1", bytes: tx.digest, approvalId: "x" }, LEDGER_EVM.publicKey)).not.toThrow();
    expect(await call({ type: "hwSignJobs" })).toEqual([]);

    // Back to the phrase account.
    await service.handle({ type: "hwSetActive", family: "evm", accountId: null });
    expect(service.cachedAccount("evm")?.id).toBe("evm:0");
  });

  it("rejects a bad signature from the window and fails the approval", async () => {
    const { service, env, out, call } = await setup();
    const { signer } = replay("evm-sign-tx");
    // A page that tampers with the device's answer.
    const tampering: HardwareSigner = {
      kind: "ledger",
      listAccounts: async () => [],
      sign: async (p, c) => {
        const s = await signer.sign(p, c);
        const bytes = new Uint8Array(s.bytes);
        bytes[40]! ^= 1;
        return { ...s, bytes };
      },
    };
    const agent = new SignAgent({ call, signer: async () => tampering, cancelDevice: () => undefined, exchange: () => undefined });
    const { done, approved } = await approveOne(service, env);
    await waitForJob(call);
    await agent.poll();
    await agent.idle();
    expect(await errCode(approved)).toBe("hw/bad-signature");
    expect(out.finalized).toEqual([]);
    // The request stays in the queue; nothing was sent.
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(1);
    service.handle({ type: "reject", id: env.opened[0]! }).catch(() => undefined);
    await done.catch(() => undefined);
  });

  it("rejects a valid signature over anything but the approved payload", async () => {
    const { service, env, out, call } = await setup();
    const { id, approved } = await approveOne(service, env);
    const job = await waitForJob(call);
    // The account's real signature, but over another message.
    const sig = await otherSignature();
    expect(await errCode(call({ type: "hwSignResult", id, jobId: job.jobId, signature: signatureToWire(sig) }))).toBe("hw/bad-signature");
    expect(await errCode(approved)).toBe("hw/bad-signature");
    expect(out.finalized).toEqual([]);
  });

  it("rejects a replayed answer and answers for jobs it didn't ask for", async () => {
    const { service, env, out, call } = await setup();
    const { signer } = replay("evm-sign-tx");
    let sent: { jobId: string; signature: unknown } | undefined;
    const recording: HardwareSigner = { kind: "ledger", listAccounts: async () => [], sign: (p, c) => signer.sign(p, c) };
    const agent = new SignAgent({
      call: async (m) => {
        const x = m as { type: string; jobId: string; signature: unknown };
        if (x.type === "hwSignResult") sent = { jobId: x.jobId, signature: x.signature };
        return call(m);
      },
      signer: async () => recording,
      cancelDevice: () => undefined,
      exchange: () => undefined,
    });
    const { id, done, approved } = await approveOne(service, env);
    const job = await waitForJob(call);
    // An answer for a job id the background never handed out.
    expect(await errCode(call({ type: "hwSignResult", id, jobId: crypto.randomUUID(), signature: { scheme: "ecdsa-secp256k1", bytes: "00".repeat(64), recovery: 0, publicKey: LEDGER_EVM.publicKey } }))).toBe("hw/no-approval");
    await agent.poll();
    await agent.idle();
    await expect(approved).resolves.toBeUndefined();
    await expect(done).resolves.toEqual({ txHash: "0xabc" });
    expect(sent?.jobId).toBe(job.jobId);
    expect(out.finalized).toHaveLength(1);
    // Replay of the accepted answer: refused (single use), nothing finalized twice.
    expect(await errCode(call({ type: "hwSignResult", id, jobId: sent!.jobId, signature: sent!.signature }))).toBe("hw/no-approval");
    expect(out.finalized).toHaveLength(1);
  });

  it("cancel and lock end the device step", async () => {
    const { service, env, call } = await setup();
    const cancelDevice = vi.fn();
    const never: HardwareSigner = { kind: "ledger", listAccounts: async () => [], sign: () => new Promise(() => undefined) };
    const agent = new SignAgent({ call, signer: async () => never, cancelDevice, exchange: () => undefined });
    const first = await approveOne(service, env);
    await waitForJob(call);
    await agent.poll();
    // A second Approve while the device is busy doesn't revoke the first.
    expect(await errCode(service.handle({ type: "approve", id: first.id }))).toBe("hw/in-progress");
    await call({ type: "hwCancel", id: first.id });
    expect(await errCode(first.approved)).toBe("hw/cancelled");
    await agent.poll();
    expect(cancelDevice).toHaveBeenCalledWith(first.id);

    // Approve again, then lock: the open step fails and the window drops it.
    const again = service.handle({ type: "approve", id: first.id });
    again.catch(() => undefined);
    await waitForJob(call);
    await agent.poll();
    await service.lock();
    expect(await errCode(again)).toBe("hw/cancelled");
    await agent.poll();
    expect(cancelDevice).toHaveBeenCalledTimes(2);
  });

  it("refuses account records that don't match their id", async () => {
    const { service } = await setup();
    const bad = { ...LEDGER_EVM, id: "hw:ledger:4418d0b4:evm:3" };
    expect(await errCode(service.handle(Request.parse(json({ type: "hwAddAccounts", accounts: [bad] }))))).toBe("hw/unknown-account");
    expect(Request.safeParse({ type: "hwAddAccounts", accounts: [{ ...LEDGER_EVM, extra: 1 }] }).success).toBe(false);
  });
});
