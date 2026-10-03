/**
 * Approval binding for hardware accounts, with the same contract as the vault's ApprovalRegistry:
 * the background registers the payloads it prepared ONLY after the user approved the DecodedRequest;
 * every sign() consumes one; approvals die after the ttl (capped at 10 minutes) or on clear().
 *
 * The hash also covers `raw`, so what the device is shown is part of what was approved.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { SignablePayload } from "@clip-wallet/core";
import { concat, toHex, utf8 } from "./bytes.js";

export const MAX_APPROVAL_TTL_MS = 10 * 60 * 1000;

function lp(b: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, b.length, false);
  return concat(len, b);
}

const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
};

export function hashHardwarePayload(p: Pick<SignablePayload, "accountId" | "scheme" | "bytes" | "options" | "raw">): Uint8Array {
  const tweak = p.options?.taprootTweak;
  const raw = p.raw;
  return sha256(
    concat(
      utf8("clip-wallet/hw-approval/v1"),
      lp(utf8(p.accountId)),
      lp(utf8(p.scheme)),
      lp(p.bytes),
      tweak ? concat(new Uint8Array([1]), lp(tweak)) : new Uint8Array([0]),
      raw
        ? concat(
            new Uint8Array([1]),
            lp(utf8(raw.format)),
            lp(raw.bytes),
            raw.inputIndex === undefined ? new Uint8Array([0]) : concat(new Uint8Array([1]), u32(raw.inputIndex)),
            raw.chainId === undefined ? new Uint8Array([0]) : concat(new Uint8Array([1]), lp(utf8(String(raw.chainId)))),
          )
        : new Uint8Array([0]),
    ),
  );
}

interface Entry {
  expiresAt: number;
  remaining: Map<string, number>;
}

export class HardwareApprovals {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  register(approvalId: string, payloads: SignablePayload[], ttlMs: number): void {
    if (!approvalId) throw new Error("approvalId required");
    if (this.entries.has(approvalId)) throw new Error("approvalId already registered");
    if (payloads.length === 0) throw new Error("no payloads");
    if (!(ttlMs > 0)) throw new Error("ttlMs must be positive");
    const remaining = new Map<string, number>();
    for (const p of payloads) {
      if (p.approvalId !== approvalId) throw new Error("payload belongs to another approval");
      const k = toHex(hashHardwarePayload(p));
      remaining.set(k, (remaining.get(k) ?? 0) + 1);
    }
    this.entries.set(approvalId, { expiresAt: this.now() + Math.min(ttlMs, MAX_APPROVAL_TTL_MS), remaining });
  }

  consume(payload: SignablePayload): boolean {
    const e = this.live(payload.approvalId);
    if (!e) return false;
    const k = toHex(hashHardwarePayload(payload));
    const n = e.remaining.get(k) ?? 0;
    if (n <= 0) return false;
    if (n === 1) e.remaining.delete(k);
    else e.remaining.set(k, n - 1);
    if (e.remaining.size === 0) this.entries.delete(payload.approvalId);
    return true;
  }

  revoke(approvalId: string): void {
    this.entries.delete(approvalId);
  }

  clear(): void {
    this.entries.clear();
  }

  private live(approvalId: string): Entry | undefined {
    const e = this.entries.get(approvalId);
    if (!e) return undefined;
    if (this.now() >= e.expiresAt) {
      this.entries.delete(approvalId);
      return undefined;
    }
    return e;
  }
}
