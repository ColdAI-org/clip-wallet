/**
 * For hosts whose WebAuthn runs in a different context than the engine (an MV3 service worker can't call
 * navigator.credentials): the engine implements PrfProvider as a proxy and hands the page a ceremony to
 * run (passkeyBegin → page runs WebAuthn → passkeyFinish). Mobile doesn't need this: the native passkey /
 * biometric module runs in the same JS context, so it calls WalletEngine.enrollPasskeyWith directly.
 */
import type { PasskeyCeremony } from "@clip-wallet/ui";
import { ClipError } from "@clip-wallet/core";
import type { PrfProvider } from "./types.js";

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
  mode: "extension" | "web-bridge" | "native";
  bridgeUrl: string;
}

export class PasskeyCeremonies {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly meta: () => CeremonyMeta,
    private readonly randomUUID: () => string,
    private readonly randomBytes: (n: number) => Uint8Array,
  ) {}

  begin(op: "enroll" | "unlock", run: (prf: PrfProvider) => Promise<unknown>): Promise<PasskeyCeremony> {
    for (const [id, p] of this.pending) {
      p.settle({ error: "superseded" });
      this.pending.delete(id);
    }
    const id = this.randomUUID();
    let settle!: (r: Result) => void;
    const result = new Promise<Result>((res) => (settle = res));

    return new Promise<PasskeyCeremony>((resolveCeremony, rejectBegin) => {
      let asked = false;
      const ceremony = (prfInput: Uint8Array, credentialId?: Uint8Array): PasskeyCeremony => {
        const m = this.meta();
        return {
          id,
          op,
          rpId: m.rpId,
          rpName: m.rpName,
          mode: m.mode === "native" ? "extension" : m.mode,
          bridgeUrl: m.bridgeUrl,
          userId: b64url(this.randomBytes(16)),
          userName: m.rpName,
          prfInput: b64url(prfInput),
          credentialId: credentialId ? b64url(credentialId) : undefined,
        } as PasskeyCeremony;
      };
      const await_ = async () => {
        const r = await result;
        if ("error" in r) throw new ClipError("Passkey setup was cancelled. Your password still works.", "passkey/cancelled");
        return r;
      };
      const prf: PrfProvider = {
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
