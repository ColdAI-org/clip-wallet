/**
 * @clip-wallet/backup-client — talks to services/backup. Holds no key material: it moves the opaque blob
 * produced by vault.createPasskeyBackup and the sign-in session.
 *
 *   const c = new BackupClient({ baseUrl });
 *   const pending = await c.startSignIn("me@example.com");    // emails a link; keep `pending` on this device
 *   await c.completeSignIn(pastedLink, pending);               // → session (store it; c.session)
 *   const { id } = await c.upload(blob, { credentialId, rpId });
 *   const list = await c.list();  const rec = await c.download(id);
 *
 *   // or Google / Apple (OIDC; the service never holds keys, social sign-in only finds your backups):
 *   const { authorizationUrl, pending } = await c.startSocialSignIn("google", returnTo);
 *   const ended = await chrome.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });
 *   await c.completeSocialSignIn(ended, pending);
 *
 * @module
 */
import { ClipError } from "@clip-wallet/core";
import {
  API_VERSION,
  type BackupMeta,
  type BackupRecord,
  type ErrorBody,
  type ProvidersResponse,
  type SessionResponse,
  type SocialProvider,
  type SocialSessionResponse,
  type SocialStartResponse,
  b64url,
  fromB64url,
  isPasskeyBackupBlob,
  normaliseEmail,
  sha256b64url,
  socialResultFromUrl,
  tokenFromLink,
} from "./protocol.js";

/** `url` without trailing slashes (a scan, not a regex: linear on any input). */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export * from "./protocol.js";

export interface BackupClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** A session from an earlier sign-in. */
  session?: { token: string; expiresAt: number } | null;
  now?: () => number;
  /** Randomness for sign-in verifiers (tests pin it; default crypto.getRandomValues). */
  randomBytes?: (n: number) => Uint8Array;
}

/** Kept by the device that started a Google/Apple sign-in, until the flow returns. Never sent until finish. */
export interface PendingSocialSignIn {
  provider: SocialProvider;
  verifier: string;
  state: string;
  startedAt: number;
}

/** Kept by the device that started sign-in (memory or session storage), never sent until verify. */
export interface PendingSignIn {
  email: string;
  verifier: string;
  startedAt: number;
}

const PLAIN: Record<string, string> = {
  "rate-limited": "Too many tries. Wait a few minutes and try again.",
  "bad-email": "That email address doesn't look right.",
  "link-invalid": "That sign-in link has expired or was already used. Ask for a new one.",
  "link-other-device": "Open the sign-in link on the device where you asked for it.",
  unauthorized: "You've been signed out of backups. Sign in again with your email.",
  "too-many-backups": "You already have the most backups we keep. Delete an old one first.",
  "bad-blob": "That backup isn't in a format we can store.",
  "not-found": "We couldn't find that backup.",
  "email-unavailable": "We can't send sign-in emails right now. Try again later.",
  unavailable: "The backup service isn't available right now. Try again later.",
  "provider-unavailable": "That sign-in option isn't set up for backups. Use your email instead.",
  "bad-return": "This version of the wallet can't use that sign-in option.",
  "state-invalid": "That sign-in expired. Try again.",
  "social-cancelled": "Sign-in was cancelled.",
  "social-failed": "We couldn't sign you in with that account. Try again, or use your email.",
};

export class BackupClient {
  session: { token: string; expiresAt: number } | null;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly random: (n: number) => Uint8Array;

  constructor(opts: BackupClientOptions) {
    this.base = `${withoutTrailingSlashes(opts.baseUrl)}/${API_VERSION}`;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.session = opts.session ?? null;
    this.now = opts.now ?? Date.now;
    this.random = opts.randomBytes ?? ((n) => crypto.getRandomValues(new Uint8Array(n)));
  }

  get signedIn(): boolean {
    return !!this.session && this.session.expiresAt > this.now();
  }

  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth) {
      if (!this.signedIn) throw new ClipError(PLAIN.unauthorized!, "backup/unauthorized");
      headers.authorization = `Bearer ${this.session!.token}`;
    }
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (e) {
      throw new ClipError("We couldn't reach the backup service. Check your connection and try again.", "backup/unreachable", e);
    }
    const json = (await res.json().catch(() => null)) as (T & Partial<ErrorBody>) | null;
    if (!res.ok) {
      const code = json?.error ?? (res.status === 429 ? "rate-limited" : res.status >= 500 ? "unavailable" : "failed");
      if (code === "unauthorized") this.session = null;
      throw new ClipError(PLAIN[code] ?? "The backup service couldn't do that. Try again.", `backup/${code}`);
    }
    return json as T;
  }

  async startSignIn(rawEmail: string): Promise<PendingSignIn> {
    const email = normaliseEmail(rawEmail);
    if (!email) throw new ClipError(PLAIN["bad-email"]!, "backup/bad-email");
    const verifier = b64url(this.random(32));
    await this.call("POST", "/auth/start", { email, challenge: await sha256b64url(verifier) }, false);
    return { email, verifier, startedAt: this.now() };
  }

  async completeSignIn(pastedLinkOrToken: string, pending: PendingSignIn): Promise<void> {
    const token = tokenFromLink(pastedLinkOrToken);
    if (!token) throw new ClipError("Paste the whole link from the email.", "backup/link-invalid");
    const r = await this.call<SessionResponse>("POST", "/auth/verify", { token, verifier: pending.verifier }, false);
    this.session = { token: r.session, expiresAt: r.expiresAt };
  }

  /** Which sign-in methods this backup service has switched on. Unknown/unreachable = none. */
  async providers(): Promise<ProvidersResponse> {
    try {
      const r = await this.call<Partial<ProvidersResponse>>("GET", "/auth/providers", undefined, false);
      return { email: r.email === true, google: r.google === true, apple: r.apple === true };
    } catch {
      return { email: false, google: false, apple: false };
    }
  }

  /**
   * Starts "Continue with Google" / "Sign in with Apple". Open `authorizationUrl` (extension:
   * chrome.identity.launchWebAuthFlow) and pass the URL it ends on to completeSocialSignIn with `pending`.
   */
  async startSocialSignIn(provider: SocialProvider, returnTo: string): Promise<{ authorizationUrl: string; pending: PendingSocialSignIn }> {
    const verifier = b64url(this.random(32));
    const r = await this.call<SocialStartResponse>("POST", "/auth/oidc/start", { provider, challenge: await sha256b64url(verifier), returnTo }, false);
    let state: string | null = null;
    try {
      state = new URL(r.authorizationUrl).searchParams.get("state");
    } catch {
      state = null;
    }
    if (!state) throw new ClipError(PLAIN["social-failed"]!, "backup/social-failed");
    return { authorizationUrl: r.authorizationUrl, pending: { provider, verifier, state, startedAt: this.now() } };
  }

  async completeSocialSignIn(returnedUrl: string, pending: PendingSocialSignIn): Promise<{ provider: SocialProvider }> {
    const res = socialResultFromUrl(returnedUrl);
    if (!res || res.state !== pending.state) throw new ClipError(PLAIN["state-invalid"]!, "backup/state-invalid");
    if (!res.handoff) {
      const code = res.error === "cancelled" ? "social-cancelled" : "social-failed";
      throw new ClipError(PLAIN[code]!, `backup/${code}`);
    }
    const r = await this.call<SocialSessionResponse>("POST", "/auth/oidc/finish", { state: res.state, handoff: res.handoff, verifier: pending.verifier }, false);
    this.session = { token: r.session, expiresAt: r.expiresAt };
    return { provider: r.provider };
  }

  async signOut(): Promise<void> {
    if (this.signedIn) await this.call("POST", "/auth/sign-out").catch(() => undefined);
    this.session = null;
  }

  async list(): Promise<BackupMeta[]> {
    return (await this.call<{ backups: BackupMeta[] }>("GET", "/backups")).backups;
  }

  async upload(blob: Uint8Array, meta: { credentialId: string; rpId: string | null }): Promise<{ id: string }> {
    if (!isPasskeyBackupBlob(blob)) throw new ClipError(PLAIN["bad-blob"]!, "backup/bad-blob");
    return this.call<{ id: string }>("POST", "/backups", { blob: b64url(blob), credentialId: meta.credentialId, rpId: meta.rpId });
  }

  async download(id: string): Promise<{ blob: Uint8Array; meta: BackupMeta }> {
    const r = await this.call<BackupRecord>("GET", `/backups/${encodeURIComponent(id)}`);
    const blob = fromB64url(r.blob);
    if (!blob || !isPasskeyBackupBlob(blob)) throw new ClipError("That backup is damaged and can't be used.", "backup/bad-blob");
    const { blob: _b, ...meta } = r;
    return { blob, meta };
  }

  async remove(id: string): Promise<void> {
    await this.call("DELETE", `/backups/${encodeURIComponent(id)}`);
  }

  /** Deletes every backup and session for this email. */
  async deleteAccount(): Promise<void> {
    await this.call("DELETE", "/account");
    this.session = null;
  }
}
