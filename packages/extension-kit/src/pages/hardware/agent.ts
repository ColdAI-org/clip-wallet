/**
 * Runs hardware signing in the approval window. The background asks (`hwSignJobs`) for a device to sign a
 * payload it registered after the user approved; this drives the Ledger or Keystone and hands the signature
 * back (`hwSignResult`). The background verifies it against its own copy of the payload and the account's
 * public key before using it, so nothing here is trusted.
 *
 * The device code is loaded only when a job arrives (see devices.ts).
 */
import type { DappRequest, DecodedRequest, SignablePayload } from "@clip-wallet/core";
import { fromWire, signatureToWire, type HardwareAccount, type HardwareKind, type HardwareSigner, type PendingExchangeView } from "@clip-wallet/hardware/core";
import type { ApprovalView, WalletClient } from "@clip-wallet/ui";
import type { HardwareSignJob } from "../../shared/hardware-job";
import type { Request } from "../../shared/messages";

export interface SignAgentDeps {
  /** The wallet bus (rejects with the background's error). */
  call(msg: Request): Promise<unknown>;
  signer(kind: HardwareKind): Promise<HardwareSigner>;
  /** Abort this page's device step for an approval. */
  cancelDevice(approvalId: string): Promise<void> | void;
  /** The Keystone exchange this page has open for an approval. */
  exchange(approvalId: string): PendingExchangeView | undefined;
}

const CODE = /^hw\/[a-z0-9-]{1,40}$/;

/** A device error as the bus carries it: its code and plain words (ClipError from any chunk). */
function failure(e: unknown): { code: string; message: string } {
  const x = e as { code?: unknown; userMessage?: unknown } | undefined;
  const message = typeof x?.userMessage === "string" && x.userMessage ? x.userMessage.slice(0, 300) : "Your hardware wallet couldn't sign this. Nothing was signed.";
  return { code: typeof x?.code === "string" && CODE.test(x.code) ? x.code : "hw/failed", message };
}

export class SignAgent {
  /** Jobs this page is running, by job id. */
  private readonly active = new Map<string, HardwareSignJob>();
  private readonly listeners = new Set<() => void>();
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly deps: SignAgentDeps) {}

  /** Re-reads the background's jobs: starts new ones, aborts ones the background dropped (cancel, lock). */
  async poll(): Promise<void> {
    let jobs: HardwareSignJob[];
    try {
      jobs = (await this.deps.call({ type: "hwSignJobs" })) as HardwareSignJob[];
    } catch {
      jobs = []; // locked or waking up: nothing to sign
    }
    for (const [id, job] of [...this.active]) {
      if (!jobs.some((j) => j.jobId === id)) {
        this.active.delete(id);
        void Promise.resolve(this.deps.cancelDevice(job.approvalId)).catch(() => undefined);
      }
    }
    for (const j of jobs) if (!this.active.has(j.jobId)) void this.run(j);
  }

  /** While a Keystone exchange is open here, the approval shows its QR step. */
  overlay(view: ApprovalView): ApprovalView {
    const x = this.deps.exchange(view.id);
    return x ? { ...view, hardware: { kind: "keystone", stage: "exchange", request: { type: x.type, cborHex: x.cborHex, expect: x.expect } } } : view;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Waits for every job started so far (tests). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  private run(job: HardwareSignJob): Promise<void> {
    this.active.set(job.jobId, job);
    const p = this.sign(job).finally(() => {
      this.running.delete(p);
      this.listeners.forEach((cb) => cb());
    });
    this.running.add(p);
    return p;
  }

  private async sign(job: HardwareSignJob): Promise<void> {
    let answer: Request;
    try {
      const signer = await this.deps.signer(job.kind);
      const sig = await signer.sign(fromWire<SignablePayload>(job.payload), {
        account: fromWire<HardwareAccount>(job.account),
        request: fromWire<DappRequest>(job.request),
        decoded: fromWire<DecodedRequest>(job.decoded),
      });
      answer = { type: "hwSignResult", id: job.approvalId, jobId: job.jobId, signature: signatureToWire(sig) as Extract<Request, { type: "hwSignResult" }>["signature"] };
    } catch (e) {
      answer = { type: "hwSignFailed", id: job.approvalId, jobId: job.jobId, ...failure(e) };
    }
    // Dropped meanwhile (cancelled, locked): the background no longer waits for it.
    if (!this.active.delete(job.jobId)) return;
    // A rejected answer (bad signature, expired) already failed the approval in the background.
    await this.deps.call(answer).catch(() => undefined);
  }
}

/** The approval window's client: the bus client, with this page's device steps shown on its approvals. */
export function withDeviceSteps(base: WalletClient, agent: SignAgent, onDevice: (cb: () => void) => () => void): WalletClient {
  return {
    ...base,
    listApprovals: async () => (await base.listApprovals()).map((v) => agent.overlay(v)),
    getApproval: async (id) => {
      const v = await base.getApproval(id);
      return v && agent.overlay(v);
    },
    onChange: (cb) => {
      const offs = [base.onChange?.(cb), agent.onChange(cb), onDevice(cb)];
      return () => offs.forEach((off) => off?.());
    },
  };
}
