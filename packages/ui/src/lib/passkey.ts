/**
 * WebAuthn side of passkey unlock, using the PRF extension.
 *
 * `PasskeyPrf` is structurally identical to @clip-wallet/vault's interface: the vault picks a random
 * per-credential `prfInput`, calls `enroll(prfInput)` / `evaluate(credentialId, prfInput)`, and derives
 * its wrapping key from the PRF output. The vault lives in the background service worker, which can't
 * run WebAuthn, so the background implements PasskeyPrf as a proxy that hands each call to a page
 * (see `runPasskeyCeremony` and packages/extension-kit/src/background/passkey-proxy.ts).
 *
 * Where the ceremony runs (verified; sources in packages/extension-kit/src/passkey/bridge.ts):
 *  - Chrome 122+ lets an extension page call navigator.credentials with rp.id = its own extension id,
 *    or a registrable domain it holds host permissions for. Firefox 150+ allows the host-permission form.
 *  - The service worker has no navigator.credentials.
 *  - The action popup closes when the passkey sheet takes focus, so the ceremony runs in a full tab.
 *  - Older browsers can use the web-bridge page on a configured origin.
 */

import type { UiMessageId } from "../i18n/en";

export interface PasskeyPrf {
  enroll(prfInput: Uint8Array): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }>;
  evaluate(credentialId: Uint8Array, prfInput: Uint8Array): Promise<Uint8Array>;
}

export class PasskeyError extends Error {
  /**
   * `userMessage` is the English text (callers without a translator, e.g. the extension bridge, pass only
   * that); `messageId` names the same text in the UI catalog so screens can show it translated.
   */
  constructor(
    public readonly userMessage: string,
    public readonly code: "unsupported" | "no-prf" | "cancelled" | "failed",
    public readonly messageId?: UiMessageId,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

/** Translated text for an error from a passkey ceremony; falls back to `fallback` (usually userMessageOf). */
export function passkeyErrorText(e: unknown, t: (id: UiMessageId) => string, fallback: (e: unknown) => string): string {
  return e instanceof PasskeyError && e.messageId ? t(e.messageId) : fallback(e);
}

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface WebAuthnPrfOptions {
  /** null = let the browser use the calling origin's default (extension id in Chrome extension pages). */
  rpId: string | null;
  rpName: string;
  userId: Uint8Array<ArrayBuffer>;
  userName: string;
  credentials?: CredentialsContainer;
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } };
}

/** Copies into a fresh ArrayBuffer-backed view (WebAuthn's BufferSource typing). */
function ab(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(u.length);
  out.set(u);
  return out;
}

function toBytes(v: ArrayBuffer | Uint8Array): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

function mapError(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new PasskeyError("Passkey request was cancelled. You can try again or use your password.", "cancelled", "onboarding.passkeyError.cancelled");
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return new PasskeyError("This browser can't use a passkey here. Your password still works.", "unsupported", "onboarding.passkeyError.unsupported");
  }
  return new PasskeyError("The passkey didn't respond. Your password still works.", "failed", "onboarding.passkeyError.failed");
}

export class WebAuthnPasskeyPrf implements PasskeyPrf {
  constructor(private readonly o: WebAuthnPrfOptions) {}

  private get creds(): CredentialsContainer {
    const c = this.o.credentials ?? (typeof navigator !== "undefined" ? navigator.credentials : undefined);
    if (!c || typeof PublicKeyCredential === "undefined") {
      throw new PasskeyError("This browser can't use a passkey here. Your password still works.", "unsupported", "onboarding.passkeyError.unsupported");
    }
    return c;
  }

  async enroll(prfInput: Uint8Array): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }> {
    const salt = ab(prfInput);
    let cred: PublicKeyCredential | null;
    try {
      cred = (await this.creds.create({
        publicKey: {
          rp: { name: this.o.rpName, ...(this.o.rpId ? { id: this.o.rpId } : {}) },
          user: { id: this.o.userId, name: this.o.userName, displayName: this.o.userName },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -8 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          timeout: 120_000,
          extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
    } catch (e) {
      throw mapError(e);
    }
    if (!cred) throw new PasskeyError("Passkey request was cancelled.", "cancelled", "onboarding.passkeyError.cancelledShort");
    const credentialId = new Uint8Array(cred.rawId);
    const ext = cred.getClientExtensionResults() as PrfResults;
    if (ext.prf?.results?.first) {
      return { credentialId, prfOutput: toBytes(ext.prf.results.first) };
    }
    if (ext.prf?.enabled === false || !ext.prf) {
      throw new PasskeyError(
        "This passkey can't unlock a wallet (no PRF support). Your password still works.",
        "no-prf",
        "onboarding.passkeyError.noPrf",
      );
    }
    // Many authenticators report prf.enabled at creation and only evaluate on get().
    return { credentialId, prfOutput: await this.evaluate(credentialId, prfInput) };
  }

  async evaluate(credentialId: Uint8Array, prfInput: Uint8Array): Promise<Uint8Array> {
    let assertion: PublicKeyCredential | null;
    try {
      assertion = (await this.creds.get({
        publicKey: {
          ...(this.o.rpId ? { rpId: this.o.rpId } : {}),
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: "public-key", id: ab(credentialId) }],
          userVerification: "required",
          timeout: 120_000,
          extensions: { prf: { eval: { first: ab(prfInput) } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
    } catch (e) {
      throw mapError(e);
    }
    const first = (assertion?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
    if (!first) {
      throw new PasskeyError(
        "This passkey can't unlock a wallet (no PRF support). Your password still works.",
        "no-prf",
        "onboarding.passkeyError.noPrf",
      );
    }
    return toBytes(first);
  }
}

/* ------------------------------------------------------------------ ceremony protocol */

/** What the background hands a page when the vault asks for a PRF evaluation. */
export interface PasskeyCeremony {
  id: string;
  op: "enroll" | "unlock";
  rpId: string | null;
  rpName: string;
  /** Base64url WebAuthn user handle (enrol only). */
  userId: string;
  userName: string;
  /** Base64url; chosen by the vault, stored beside the wrapped key. */
  prfInput: string;
  /** Base64url; unlock only. */
  credentialId?: string;
  mode: "extension" | "web-bridge";
  bridgeUrl: string;
}

export interface PasskeyPrfFactory {
  create(c: PasskeyCeremony): PasskeyPrf;
}

export interface CeremonyClient {
  passkeyBegin(p: { op: "enroll"; password: string } | { op: "unlock" }): Promise<PasskeyCeremony>;
  passkeyFinish(p: { id: string; credentialId: string; prfOutput: string } | { id: string; error: string }): Promise<void>;
}

/**
 * Runs one ceremony end to end: ask the background (which asks the vault) for the PRF input, run
 * WebAuthn in this page, hand the output back. The vault finishes enrol/unlock before passkeyFinish resolves.
 */
export async function runPasskeyCeremony(
  client: CeremonyClient,
  factory: PasskeyPrfFactory,
  begin: { op: "enroll"; password: string } | { op: "unlock" },
): Promise<void> {
  const c = await client.passkeyBegin(begin);
  const prf = factory.create(c);
  let credentialId: string;
  let prfOutput: Uint8Array;
  try {
    if (c.op === "enroll") {
      const r = await prf.enroll(b64urlDecode(c.prfInput));
      credentialId = b64urlEncode(r.credentialId);
      prfOutput = r.prfOutput;
    } else {
      if (!c.credentialId) throw new PasskeyError("Passkey unlock isn't set up on this device. Use your password.", "unsupported", "onboarding.passkeyError.notSetUp");
      credentialId = c.credentialId;
      prfOutput = await prf.evaluate(b64urlDecode(c.credentialId), b64urlDecode(c.prfInput));
    }
  } catch (e) {
    await client.passkeyFinish({ id: c.id, error: e instanceof PasskeyError ? e.code : "failed" }).catch(() => undefined);
    throw e;
  }
  const encoded = b64urlEncode(prfOutput);
  prfOutput.fill(0);
  await client.passkeyFinish({ id: c.id, credentialId, prfOutput: encoded });
}
