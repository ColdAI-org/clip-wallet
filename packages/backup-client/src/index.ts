/**
 * @clip-wallet/backup-client — talks to services/backup. Holds no key material: it moves the opaque blob
 * produced by vault.createPasskeyBackup and the sign-in session.
 *
 *   const c = new BackupClient({ baseUrl });
 *   const pending = await c.startSignIn("me@example.com");    // emails a link; keep `pending` on this device
 *   await c.completeSignIn(pastedLink, pending);               // → session (store it; c.session)
 *   const { id } = await c.upload(blob, { credentialId, rpId });
 *   const list = await c.list();  const rec = await c.download(id);
 */
import { ClipError } from "@clip-wallet/core";
import {
  API_VERSION,
  type BackupMeta,
  type BackupRecord,
  type ErrorBody,
  type SessionResponse,
  b64url,
  fromB64url,
  isPasskeyBackupBlob,
  normaliseEmail,
  sha256b64url,
  tokenFromLink,
} from "./protocol.js";

export * from "./protocol.js";

export interface BackupClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** A session from an earlier sign-in. */
  session?: { token: string; expiresAt: number } | null;
  now?: () => number;
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
};

export class BackupClient {
  session: { token: string; expiresAt: number } | null;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly now: () => number;

  constructor(opts: BackupClientOptions) {
    this.base = `${opts.baseUrl.replace(/\/+$/, "")}/${API_VERSION}`;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.session = opts.session ?? null;
    this.now = opts.now ?? Date.now;
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
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await this.call("POST", "/auth/start", { email, challenge: await sha256b64url(verifier) }, false);
    return { email, verifier, startedAt: this.now() };
  }

  async completeSignIn(pastedLinkOrToken: string, pending: PendingSignIn): Promise<void> {
    const token = tokenFromLink(pastedLinkOrToken);
    if (!token) throw new ClipError("Paste the whole link from the email.", "backup/link-invalid");
    const r = await this.call<SessionResponse>("POST", "/auth/verify", { token, verifier: pending.verifier }, false);
    this.session = { token: r.session, expiresAt: r.expiresAt };
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
