/**
 * Background side of hardware signing. The device code (Ledger WebHID, Keystone QR: about 1.5 MB) lives in
 * the approval window, which needs a page for WebHID and the camera anyway; the service worker keeps only
 * the HardwareKeyring's bookkeeping and checks.
 *
 *   approve() → keyring.registerApproval(payloads)       (the background's own copies)
 *   sign(payload) → a job the approval window reads with `hwSignJobs`
 *   window runs the device → `hwSignResult` { signature }
 *   result() → keyring.acceptSignature(own payload copy, signature): verifies over the approved bytes with
 *              the account's public key, then consumes the approval (single use)
 *
 * Nothing the window sends back can change what is verified: the job's payload never leaves this object,
 * the window only names the job it answers. A compromised page can make signing fail, never succeed for
 * other bytes.
 */
import { ClipError, type DappRequest, type DecodedRequest, type Signature, type SignablePayload } from "@clip-wallet/core";
import { HardwareErrors, MAX_APPROVAL_TTL_MS, signatureFromWire, toWire, type HardwareKeyring, type SignatureWire } from "@clip-wallet/hardware/core";
import type { HardwareSignJob } from "../shared/hardware-job";

export const inProgress = () => new ClipError("Your hardware wallet is already signing this request.", "hw/in-progress");

interface Running {
  job: HardwareSignJob;
  payload: SignablePayload;
  resolve(sig: Signature): void;
  reject(e: unknown): void;
}

export class HardwareSignHost {
  /** One device step per approval at a time, by approval id. */
  private readonly running = new Map<string, Running>();

  constructor(
    /** A getter: tests swap the keyring after construction. */
    private readonly keyring: () => HardwareKeyring,
    private readonly onChange: () => void,
    private readonly timeoutMs = MAX_APPROVAL_TTL_MS,
  ) {}

  /** Waits for the approval window to have the device sign `payload`, then verifies the result. */
  async sign(payload: SignablePayload, ctx: { request: DappRequest; decoded: DecodedRequest }): Promise<Signature> {
    const keyring = this.keyring();
    const account = await keyring.account(payload.accountId);
    if (!account) throw HardwareErrors.unknownAccount();
    // Never put an unapproved payload in front of a device.
    if (!keyring.isApproved(payload)) throw HardwareErrors.noApproval();
    if (this.running.has(payload.approvalId)) throw inProgress();
    const job: HardwareSignJob = {
      approvalId: payload.approvalId,
      jobId: crypto.randomUUID(),
      kind: account.hardware.kind,
      payload: toWire(payload),
      account: toWire(account),
      request: toWire(ctx.request),
      decoded: toWire(ctx.decoded),
    };
    return new Promise<Signature>((resolve, reject) => {
      const timer = setTimeout(() => this.settle(job.approvalId, job.jobId)?.reject(HardwareErrors.timedOut()), this.timeoutMs);
      const done = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };
      this.running.set(job.approvalId, {
        job,
        payload,
        resolve: (s) => done(() => resolve(s)),
        reject: (e) => done(() => reject(e)),
      });
      this.onChange();
    });
  }

  /** True while a device step for this approval is open. */
  isRunning(approvalId: string): boolean {
    return this.running.has(approvalId);
  }

  /** What the approval window should run now. */
  jobs(): HardwareSignJob[] {
    return [...this.running.values()].map((r) => r.job);
  }

  /** The window's answer. Throws (and fails the approval) unless it verifies over the approved payload. */
  async result(approvalId: string, jobId: string, signature: SignatureWire): Promise<void> {
    const r = this.take(approvalId, jobId);
    let sig: Signature;
    try {
      sig = await this.keyring().acceptSignature(r.payload, signatureFromWire(signature));
    } catch (e) {
      r.reject(e);
      throw e;
    }
    r.resolve(sig);
  }

  /** The device failed or the user said no on it: the approval fails with the device's plain words. */
  failed(approvalId: string, jobId: string, code: string, message: string): void {
    this.take(approvalId, jobId).reject(new ClipError(message, code));
  }

  cancel(approvalId: string): void {
    this.settle(approvalId)?.reject(HardwareErrors.cancelled());
  }

  /** On lock: every open device step fails. */
  cancelAll(): void {
    for (const id of [...this.running.keys()]) this.cancel(id);
  }

  private take(approvalId: string, jobId: string): Running {
    const r = this.settle(approvalId, jobId);
    if (!r) throw HardwareErrors.noApproval();
    return r;
  }

  /** Removes the running step (only if `jobId` matches, when given) and tells pages. */
  private settle(approvalId: string, jobId?: string): Running | undefined {
    const r = this.running.get(approvalId);
    if (!r || (jobId !== undefined && r.job.jobId !== jobId)) return undefined;
    this.running.delete(approvalId);
    this.onChange();
    return r;
  }
}
