/**
 * The vault runs in the service worker and calls PasskeyPrf.enroll/evaluate itself, but WebAuthn only
 * works in a page (a full extension tab; the action popup closes when the passkey sheet appears). So
 * the background implements PasskeyPrf as a proxy:
 *
 *   page ── passkeyBegin ──► background: vault.enrollPasskey(password, proxy)   (not awaited yet)
 *                                 vault ─► proxy.enroll(prfInput) ─► begin() resolves with the ceremony
 *   page ◄── PasskeyCeremony { id, prfInput, rpId, ... }
 *   page runs navigator.credentials.create/get with prf.eval.first = prfInput
 *   page ── passkeyFinish { id, credentialId, prfOutput } ──► proxy resolves → vault wraps/unwraps
 *   page ◄── ok once the vault has finished (or its ClipError)
 *
 * Only the PRF output crosses the bus; the vault wipes it after deriving the wrapping key.
 */
import type { PasskeyCeremony } from "@clip-wallet/ui";
import type { PasskeyPrf } from "@clip-wallet/vault";
import { ClipError } from "@clip-wallet/core";

const TIMEOUT_MS = 3 * 60 * 1000;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Result = { credentialId: string; prfOutput: string } | { error: string };

interface Pending {
  settle: (r: Result) => void;
  done: Promise<unknown>;
  timer: ReturnType<typeof setTimeout>;
}

export interface CeremonyMeta {
  rpId: string | null;
  rpName: string;
  mode: "extension" | "web-bridge";
  bridgeUrl: string;
}

export class PasskeyCeremonies {
  private pending = new Map<string, Pending>();

  constructor(private readonly meta: () => CeremonyMeta) {}

  /**
   * Starts a vault operation that will call the proxy, and resolves with the ceremony the page must run.
   * If the vault fails before asking (wrong password, no passkey enrolled), this rejects with its error.
   */
  begin(op: "enroll" | "unlock", run: (prf: PasskeyPrf) => Promise<unknown>): Promise<PasskeyCeremony> {
    for (const [id, p] of this.pending) {
      // One ceremony at a time.
      p.settle({ error: "superseded" });
      this.pending.delete(id);
    }
    const id = crypto.randomUUID();
    let settle!: (r: Result) => void;
    const result = new Promise<Result>((res) => (settle = res));

    return new Promise<PasskeyCeremony>((resolveCeremony, rejectBegin) => {
      let asked = false;
      const ceremony = (prfInput: Uint8Array, credentialId?: Uint8Array): PasskeyCeremony => ({
        id,
        op,
        ...this.meta(),
        userId: b64url(crypto.getRandomValues(new Uint8Array(16))),
        userName: this.meta().rpName,
        prfInput: b64url(prfInput),
        credentialId: credentialId ? b64url(credentialId) : undefined,
      });
      const await_ = async () => {
        const r = await result;
        if ("error" in r) throw new ClipError("Passkey setup was cancelled. Your password still works.", "passkey/cancelled");
        return r;
      };
      const prf: PasskeyPrf = {
        enroll: async (prfInput) => {
          asked = true;
          resolveCeremony(ceremony(prfInput));
          const r = await await_();
          return { credentialId: fromB64url(r.credentialId), prfOutput: fromB64url(r.prfOutput) };
        },
        evaluate: async (credentialId, prfInput) => {
          asked = true;
          resolveCeremony(ceremony(prfInput, credentialId));
          return fromB64url((await await_()).prfOutput);
        },
      };
      const done = run(prf);
      done.catch((e) => {
        if (!asked) rejectBegin(e);
      });
      const timer = setTimeout(() => {
        settle({ error: "timeout" });
        this.pending.delete(id);
      }, TIMEOUT_MS);
      this.pending.set(id, { settle, done, timer });
    });
  }

  /** Hands the page's result to the waiting vault call and returns once the vault is done. */
  async finish(id: string, r: Result): Promise<void> {
    const p = this.pending.get(id);
    if (!p) throw new ClipError("That passkey request expired. Try again.", "passkey/expired");
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.settle(r);
    if ("error" in r) {
      await p.done.catch(() => undefined);
      return;
    }
    await p.done;
  }
}
