/**
 * Approval binding. The background calls registerApproval() only after the user approves a DecodedRequest,
 * passing the hashes of exactly the SignablePayloads the chain module prepared. sign() consumes one hash.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type { SignablePayload } from "@clip-wallet/core";
import { concat, toHex, utf8 } from "./bytes.js";

/** Upper bound on approval lifetime regardless of what the caller asks for. */
export const MAX_APPROVAL_TTL_MS = 10 * 60 * 1000;

function lp(b: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, b.length, false);
  return concat(len, b);
}

/**
 * The hash the background registers for each payload. Binds account, scheme, bytes and the taproot tweak
 * (a strictly stronger binding than hashing the bytes alone). approvalId is the registry key, not hashed.
 */
export function hashSignablePayload(p: Pick<SignablePayload, "accountId" | "scheme" | "bytes" | "options">): Uint8Array {
  const tweak = p.options?.taprootTweak;
  return sha256(
    concat(
      utf8("clip-wallet/approval/v1"),
      lp(utf8(p.accountId)),
      lp(utf8(p.scheme)),
      lp(p.bytes),
      tweak ? concat(new Uint8Array([1]), lp(tweak)) : new Uint8Array([0]),
    ),
  );
}

interface Entry {
  expiresAt: number;
  /** hex(hash) -> remaining uses (always 1; a duplicated payload must be listed twice). */
  remaining: Map<string, number>;
}

export class ApprovalRegistry {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number) {}

  register(approvalId: string, payloadHashes: Uint8Array[], ttlMs: number): void {
    if (!approvalId) throw new Error("approvalId required");
    if (this.entries.has(approvalId)) throw new Error("approvalId already registered");
    if (payloadHashes.length === 0) throw new Error("no payload hashes");
    if (!(ttlMs > 0)) throw new Error("ttlMs must be positive");
    const remaining = new Map<string, number>();
    for (const h of payloadHashes) {
      if (h.length !== 32) throw new Error("payload hash must be 32 bytes");
      const k = toHex(h);
      remaining.set(k, (remaining.get(k) ?? 0) + 1);
    }
    this.entries.set(approvalId, { expiresAt: this.now() + Math.min(ttlMs, MAX_APPROVAL_TTL_MS), remaining });
  }

  /** True if this approval would allow this hash right now. Does not consume. */
  check(approvalId: string, hash: Uint8Array): boolean {
    const e = this.live(approvalId);
    return !!e && (e.remaining.get(toHex(hash)) ?? 0) > 0;
  }

  /** Consumes one use. Returns false if not allowed. The approval disappears once every payload is signed. */
  consume(approvalId: string, hash: Uint8Array): boolean {
    const e = this.live(approvalId);
    if (!e) return false;
    const k = toHex(hash);
    const n = e.remaining.get(k) ?? 0;
    if (n <= 0) return false;
    if (n === 1) e.remaining.delete(k);
    else e.remaining.set(k, n - 1);
    if (e.remaining.size === 0) this.entries.delete(approvalId);
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
