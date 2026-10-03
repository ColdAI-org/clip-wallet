/**
 * Wire protocol shared by @clip-wallet/backup-client and services/backup. Pure; no I/O.
 *
 * The server only ever sees: the email address (at sign-in, to send the link; stored as a keyed hash),
 * opaque "CLPB" ciphertext blobs from vault.createPasskeyBackup, the passkey credential id and rp id the
 * blob was made with (public WebAuthn identifiers, so a new device can ask for the right passkey), and
 * timestamps. Never a phrase, a key, or a PRF output.
 */

export const API_VERSION = "v1";

/** "CLPB" ‖ 0x01 ‖ salt(32) ‖ nonce(24) ‖ XChaCha20-Poly1305(entropy 16|32 bytes + tag 16). See packages/vault passkey.ts. */
export const BLOB_MAGIC = [0x43, 0x4c, 0x50, 0x42] as const;
export const BLOB_VERSION = 1;
export const BLOB_MIN_BYTES = 4 + 1 + 32 + 24 + 16 + 16; // 12-word phrase
export const BLOB_MAX_BYTES = 4 + 1 + 32 + 24 + 32 + 16; // 24-word phrase

export const LIMITS = {
  maxBackupsPerAccount: 10,
  maxEmailLength: 254,
  maxCredentialIdBytes: 1023, // WebAuthn: credential ids are at most 1023 bytes
  maxRpIdLength: 253,
  linkTtlMs: 15 * 60_000,
  sessionTtlMs: 30 * 24 * 60 * 60_000,
  maxVerifyAttemptsPerLink: 5,
} as const;

export function isPasskeyBackupBlob(b: Uint8Array): boolean {
  return (
    b.length >= BLOB_MIN_BYTES &&
    b.length <= BLOB_MAX_BYTES &&
    (b.length === BLOB_MIN_BYTES || b.length === BLOB_MAX_BYTES) &&
    BLOB_MAGIC.every((x, i) => b[i] === x) &&
    b[4] === BLOB_VERSION
  );
}

export function normaliseEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e || e.length > LIMITS.maxEmailLength) return null;
  // Deliberately simple: one @, a dot in the domain, no spaces or angle brackets.
  if (!/^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]{2,}$/.test(e)) return null;
  return e;
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function sha256b64url(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return b64url(new Uint8Array(d));
}

/** Pulls the sign-in token out of whatever the user pasted: the whole link, `#…token=…`, or the bare token. */
export function tokenFromLink(input: string): string | null {
  const s = input.trim();
  const m = /(?:[?#&]|^)token=([A-Za-z0-9_-]{43})(?:[&#]|$)/.exec(s);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{43}$/.test(s) ? s : null;
}

/* ------------------------------------------------------------------ JSON shapes */

export interface StartSignInBody {
  email: string;
  /** base64url(SHA-256(verifier)). The verifier never leaves the device that started sign-in. */
  challenge: string;
}
export interface VerifyBody {
  token: string;
  verifier: string;
}
export interface SessionResponse {
  session: string;
  expiresAt: number;
}
export interface BackupMeta {
  id: string;
  createdAt: number;
  /** base64url WebAuthn credential id the blob was encrypted with. */
  credentialId: string;
  /** null = the extension's own origin was the RP. */
  rpId: string | null;
}
export interface UploadBody {
  blob: string;
  credentialId: string;
  rpId: string | null;
}
export interface BackupRecord extends BackupMeta {
  blob: string;
}
export interface ErrorBody {
  error: string;
  message: string;
}

/* ------------------------------------------------------------------ social sign-in (Google / Apple, OIDC) */

export type SocialProvider = "google" | "apple";

/** GET /v1/auth/providers: which sign-in methods this deployment has switched on. */
export interface ProvidersResponse {
  email: boolean;
  google: boolean;
  apple: boolean;
}
export interface SocialStartBody {
  provider: SocialProvider;
  /** base64url(SHA-256(verifier)); also the ID token's nonce. */
  challenge: string;
  /** Must be one of the deployment's OIDC_RETURN_URLS (e.g. chrome.identity's https://<id>.chromiumapp.org/backup). */
  returnTo: string;
}
export interface SocialStartResponse {
  authorizationUrl: string;
}
export interface SocialFinishBody {
  state: string;
  /** One-time code from the redirect fragment. */
  handoff: string;
  verifier: string;
}
export interface SocialSessionResponse extends SessionResponse {
  provider: SocialProvider;
}

/** Reads `state` and `handoff` (or `error`) from the URL the provider flow ended on (fragment or query). */
export function socialResultFromUrl(url: string): { state: string; handoff?: string; error?: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const p = new URLSearchParams(u.hash.replace(/^#/, "") || u.search);
  const state = p.get("state");
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  const handoff = p.get("handoff");
  const error = p.get("error");
  if (handoff && /^[A-Za-z0-9_-]{43}$/.test(handoff)) return { state, handoff };
  return { state, error: error && /^[a-z-]{1,40}$/.test(error) ? error : "failed" };
}
