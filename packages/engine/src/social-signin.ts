/**
 * Phase 2.5: "Continue with Google" / "Sign in with Apple" for passkey backups, in the background.
 *
 * Social sign-in only tells the backup service which backups are yours. It never sees, holds or unlocks a key:
 * the backups stay passkey-encrypted ciphertext, and restoring still needs your passkey.
 *
 * Separate from platform.ts so the shared engine files stay untouched; it writes the same session record
 * (PLATFORM_KEYS.backupSession), so PlatformService's backup list/upload/restore just work afterwards.
 * Wiring: docs/phase25/integration/extensibility.md.
 */
import { ClipError } from "@clip-wallet/core";
import type { KV } from "./kv.js";
import { PLATFORM_KEYS } from "./platform.js";

export type SocialProvider = "google" | "apple";

/** Structural match for @clip-wallet/backup-client's BackupClient (social sign-in part). */
export interface SocialBackupClientLike {
  session: { token: string; expiresAt: number } | null;
  providers(): Promise<{ email: boolean; google: boolean; apple: boolean }>;
  startSocialSignIn(provider: SocialProvider, returnTo: string): Promise<{ authorizationUrl: string; pending: { provider: SocialProvider; verifier: string; state: string; startedAt: number } }>;
  completeSocialSignIn(returnedUrl: string, pending: { provider: SocialProvider; verifier: string; state: string; startedAt: number }): Promise<{ provider: SocialProvider }>;
}

export interface SocialSignInDeps {
  /** null = no backup service in this build. */
  backup: ((session: null) => SocialBackupClientLike) | null;
  kv: KV;
  /**
   * Opens the provider's page and resolves with the URL the flow ended on. Extension:
   * `(url) => chrome.identity.launchWebAuthFlow({ url, interactive: true })`. Absent = social sign-in hidden.
   */
  launchWebAuthFlow?: (url: string) => Promise<string | undefined>;
  /** Where the service sends the browser back (extension: chrome.identity.getRedirectURL("backup")). */
  returnUrl?: string;
  changed(): void;
}

export interface BackupProvidersView {
  email: boolean;
  google: boolean;
  apple: boolean;
}

export type SocialSignInRequest = { type: "backupProviders" } | { type: "backupSocialSignIn"; provider: SocialProvider };
export const SOCIAL_SIGNIN_TYPES: ReadonlySet<string> = new Set(["backupProviders", "backupSocialSignIn"]);

/** Shown as "Signed in as …" (the service gets no email from Apple, and we keep none from Google). */
export const SOCIAL_LABEL: Record<SocialProvider, string> = { google: "your Google account", apple: "your Apple Account" };

export class SocialSignInService {
  constructor(private readonly d: SocialSignInDeps) {}

  handles(type: string): type is SocialSignInRequest["type"] {
    return SOCIAL_SIGNIN_TYPES.has(type);
  }

  async handle(m: SocialSignInRequest): Promise<unknown> {
    if (m.type === "backupProviders") return this.providers();
    if (m.provider !== "google" && m.provider !== "apple") throw new ClipError("That sign-in option isn't available.", "backup/provider-unavailable");
    return this.signIn(m.provider);
  }

  private get canLaunch(): boolean {
    return !!this.d.launchWebAuthFlow && !!this.d.returnUrl;
  }

  async providers(): Promise<BackupProvidersView> {
    if (!this.d.backup) return { email: false, google: false, apple: false };
    const p = await this.d.backup(null).providers();
    return { email: p.email, google: p.google && this.canLaunch, apple: p.apple && this.canLaunch };
  }

  async signIn(provider: SocialProvider): Promise<void> {
    if (!this.d.backup || !this.canLaunch) throw new ClipError("That sign-in option isn't available in this version.", "backup/provider-unavailable");
    const c = this.d.backup(null);
    const { authorizationUrl, pending } = await c.startSocialSignIn(provider, this.d.returnUrl!);
    let ended: string | undefined;
    try {
      ended = await this.d.launchWebAuthFlow!(authorizationUrl);
    } catch {
      // chrome.identity rejects when the user closes the window.
      throw new ClipError("Sign-in was cancelled.", "backup/social-cancelled");
    }
    if (!ended) throw new ClipError("Sign-in was cancelled.", "backup/social-cancelled");
    await c.completeSocialSignIn(ended, pending);
    if (!c.session) throw new ClipError("Sign-in didn't complete. Try again.", "backup/unauthorized");
    await this.d.kv.set(PLATFORM_KEYS.backupSession, { ...c.session, email: SOCIAL_LABEL[provider] });
    await this.d.kv.remove(PLATFORM_KEYS.backupPending);
    this.d.changed();
  }
}
