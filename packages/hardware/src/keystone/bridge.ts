/**
 * Background side of the Keystone QR exchange. KeystoneSigner.sign() waits here while the approval
 * window shows the request QR and scans the answer: the window reads `current(approvalId)` and calls
 * `answer()` or `cancel()` over the message bus. Only public data crosses (a sign request, a signature).
 */
import { HardwareErrors } from "../errors.js";
import type { KeystoneExchange, KeystoneQrChannel } from "./signer.js";
import { urFromJson, urToJson, type UR, type UrJson } from "./ur.js";

export interface PendingExchangeView extends UrJson {
  expect: string[];
  title: string;
}

interface Waiting {
  view: PendingExchangeView;
  resolve(ur: UR): void;
  reject(e: unknown): void;
}

export class KeystoneBridge implements KeystoneQrChannel {
  private readonly waiting = new Map<string, Waiting>();
  /** `onChange` is the background's broadcast() so the approval window re-fetches. */
  constructor(private readonly onChange: () => void = () => undefined) {}

  exchange(x: KeystoneExchange): Promise<UR> {
    this.waiting.get(x.approvalId)?.reject(HardwareErrors.cancelled());
    return new Promise<UR>((resolve, reject) => {
      const done = (fn: () => void) => {
        this.waiting.delete(x.approvalId);
        fn();
        this.onChange();
      };
      this.waiting.set(x.approvalId, {
        view: { ...urToJson(x.request.ur), expect: x.expect, title: x.title },
        resolve: (ur) => done(() => resolve(ur)),
        reject: (e) => done(() => reject(e)),
      });
      this.onChange();
    });
  }

  current(approvalId: string): PendingExchangeView | undefined {
    return this.waiting.get(approvalId)?.view;
  }

  answer(approvalId: string, ur: UrJson): void {
    const w = this.waiting.get(approvalId);
    if (!w) throw HardwareErrors.noApproval();
    if (!w.view.expect.includes(ur.type)) throw HardwareErrors.wrongQr("the signature");
    w.resolve(urFromJson(ur));
  }

  cancel(approvalId: string): void {
    this.waiting.get(approvalId)?.reject(HardwareErrors.cancelled());
  }

  /** On lock: every open exchange fails. */
  cancelAll(): void {
    for (const id of [...this.waiting.keys()]) this.cancel(id);
  }
}
