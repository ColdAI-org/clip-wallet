/**
 * Phase 2 "platform" features in the background: passkey backup/restore (services/backup), the recovery-phrase
 * backup flag, multiple accounts with per-site active accounts, and name lookups.
 *
 * New file so the stream merges cleanly; docs/phase2/integration/platform.md has the exact lines that route
 * bus messages here from service.ts and build it in wiring.ts.
 *
 * Key material: the phrase never comes through here. Backup encrypts inside the vault
 * (vault.createPasskeyBackup) and restore decrypts and imports inside it (vault.restorePasskeyBackup).
 * PRF outputs are wiped right after use.
 */
import type { Account, Family } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import { BACKUP_PRF_INPUT } from "@clip-wallet/vault";
import type { KV } from "../shared/storage";
import { b64url, fromB64url, type CeremonyMeta, type PasskeyCeremonies } from "./passkey-proxy";

/* ------------------------------------------------------------------ contracts this file codes against */

/** The vault surface used here. `restorePasskeyBackup` and `addAccount` are requested from the vault-v2 stream. */
export interface PlatformVault {
  status(): Promise<"empty" | "locked" | "unlocked">;
  deriveAccount(family: Family, index: number): Promise<Account>;
  /** Phase 2 (exists in ClipVault): encrypts the phrase under a PRF output, inside the vault. */
  createPasskeyBackup(password: string, prfOutput: Uint8Array): Promise<Uint8Array>;
  /** Decrypts a passkey backup and imports it into an empty vault; the phrase never leaves the vault. */
  restorePasskeyBackup(blob: Uint8Array, prfOutput: Uint8Array, password: string): Promise<void>;
  /** vault-v2 (ClipVault on main): allocates and persists the next account index for a family. */
  addAccount?(family: Family, label?: string): Promise<Account>;
  /** vault-v2: stored accounts (with labels) for these families; account 0 when none stored. */
  listAccounts?(families?: readonly Family[]): Promise<Account[]>;
  /** vault-v2: sets ("" clears) an account label. */
  setAccountLabel?(family: Family, index: number, label: string): Promise<void>;
}

/** Structural match for @clip-wallet/backup-client's BackupClient (so this file needs no new dependency). */
export interface BackupClientLike {
  session: { token: string; expiresAt: number } | null;
  readonly signedIn: boolean;
  startSignIn(email: string): Promise<{ email: string; verifier: string; startedAt: number }>;
  completeSignIn(link: string, pending: { email: string; verifier: string; startedAt: number }): Promise<void>;
  signOut(): Promise<void>;
  list(): Promise<{ id: string; createdAt: number; credentialId: string; rpId: string | null }[]>;
  upload(blob: Uint8Array, meta: { credentialId: string; rpId: string | null }): Promise<{ id: string }>;
  download(id: string): Promise<{ blob: Uint8Array; meta: { id: string; createdAt: number; credentialId: string; rpId: string | null } }>;
  remove(id: string): Promise<void>;
}

export interface NameLookup {
  reverse(address: string, family: Family, networkId?: string): Promise<string | null>;
}

/* ------------------------------------------------------------------ views (structurally = @clip-wallet/ui platform/client.ts) */

export interface BackupStatusView {
  signedIn: boolean;
  email?: string;
  pendingEmail?: string;
  backups: { id: string; createdAt: number }[];
  available: boolean;
}
export interface AccountView {
  id: string;
  family: Family;
  index: number;
  label: string;
  address: string;
  displayAddress?: string;
}
export interface ActiveAccounts {
  defaults: Partial<Record<Family, string>>;
  forOrigin?: Partial<Record<Family, string>>;
}

/** Bus messages handled here (zod schemas: docs/phase2/integration/platform.md). */
export type PlatformRequest =
  | { type: "backupStatus" }
  | { type: "backupStartSignIn"; email: string }
  | { type: "backupCompleteSignIn"; link: string }
  | { type: "backupSignOut" }
  | { type: "backupDelete"; id: string }
  | { type: "passkeyBackupBegin"; password: string }
  | { type: "passkeyRestoreBegin"; backupId: string; password: string }
  | { type: "markPhraseBackedUp" }
  | { type: "listAccounts" }
  | { type: "addAccount"; family: Family }
  | { type: "renameAccount"; id: string; label: string }
  | { type: "getActiveAccounts"; origin?: string }
  | { type: "setActiveAccount"; family: Family; accountId: string | null; origin?: string }
  | { type: "lookupName"; address: string; family: Family; networkId?: string };

export const PLATFORM_REQUEST_TYPES: ReadonlySet<PlatformRequest["type"]> = new Set([
  "backupStatus",
  "backupStartSignIn",
  "backupCompleteSignIn",
  "backupSignOut",
  "backupDelete",
  "passkeyBackupBegin",
  "passkeyRestoreBegin",
  "markPhraseBackedUp",
  "listAccounts",
  "addAccount",
  "renameAccount",
  "getActiveAccounts",
  "setActiveAccount",
  "lookupName",
]);

export interface PlatformDeps {
  vault: PlatformVault;
  kv: KV;
  ceremonies: Pick<PasskeyCeremonies, "begin">;
  ceremonyMeta: () => CeremonyMeta;
  /** null = no backup service configured in this build. */
  backup: ((session: { token: string; expiresAt: number } | null) => BackupClientLike) | null;
  /** Families this build enables (accounts are listed for these). */
  families: () => Family[];
  hederaAccountId?: (account: Account) => Promise<string | undefined>;
  names?: NameLookup;
  /** Tell open pages to re-fetch; called after anything that changes accounts. */
  changed(): void;
  /** After a restore made a new, unlocked vault (the service derives accounts and arms auto-lock). */
  onRestored?: () => Promise<void>;
  now?: () => number;
}

export const PLATFORM_KEYS = {
  backupSession: "clip/backup-session",
  backupPending: "clip/backup-pending",
  phraseBackedUp: "clip/phrase-backed-up",
  accountCounts: "clip/account-counts",
  accountLabels: "clip/account-labels",
  activeAccounts: "clip/active-accounts",
} as const;

const MAX_ACCOUNTS_PER_FAMILY = 20;
const PENDING_TTL_MS = 15 * 60_000;

interface StoredSession {
  token: string;
  expiresAt: number;
  email: string;
}
interface StoredActive {
  defaults: Partial<Record<Family, string>>;
  origins: Record<string, Partial<Record<Family, string>>>;
}

function originKey(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    throw new ClipError("That app address isn't valid.", "accounts/bad-origin");
  }
}

export class PlatformService {
  private readonly now: () => number;

  constructor(private readonly d: PlatformDeps) {
    this.now = d.now ?? Date.now;
  }

  handles(type: string): type is PlatformRequest["type"] {
    return PLATFORM_REQUEST_TYPES.has(type as PlatformRequest["type"]);
  }

  async handle(m: PlatformRequest): Promise<unknown> {
    switch (m.type) {
      case "backupStatus":
        return this.backupStatus();
      case "backupStartSignIn":
        return this.startSignIn(m.email);
      case "backupCompleteSignIn":
        return this.completeSignIn(m.link);
      case "backupSignOut":
        return this.signOut();
      case "backupDelete":
        return (await this.client(true)).remove(m.id);
      case "passkeyBackupBegin":
        return this.backupBegin(m.password);
      case "passkeyRestoreBegin":
        return this.restoreBegin(m.backupId, m.password);
      case "markPhraseBackedUp":
        await this.requireUnlocked();
        await this.d.kv.set(PLATFORM_KEYS.phraseBackedUp, this.now());
        return;
      case "listAccounts":
        return this.listAccounts();
      case "addAccount":
        return this.addAccount(m.family);
      case "renameAccount":
        return this.rename(m.id, m.label);
      case "getActiveAccounts":
        return this.getActive(m.origin);
      case "setActiveAccount":
        return this.setActive(m.family, m.accountId, m.origin);
      case "lookupName":
        return this.d.names ? this.d.names.reverse(m.address, m.family, m.networkId).catch(() => null) : null;
    }
  }

  private async requireUnlocked() {
    if ((await this.d.vault.status()) !== "unlocked") throw new ClipError("Your wallet is locked. Unlock it to continue.", "vault/locked");
  }

  /* ------------------------------------------------------------------ backup service */

  private async client(requireSession: boolean): Promise<BackupClientLike> {
    if (!this.d.backup) throw new ClipError("Passkey backup isn't available in this version.", "backup/unavailable");
    const s = await this.d.kv.get<StoredSession>(PLATFORM_KEYS.backupSession);
    const live = s && s.expiresAt > this.now() ? { token: s.token, expiresAt: s.expiresAt } : null;
    if (requireSession && !live) throw new ClipError("Sign in to backups with your email first.", "backup/unauthorized");
    return this.d.backup(live);
  }

  async backupStatus(): Promise<BackupStatusView> {
    if (!this.d.backup) return { signedIn: false, backups: [], available: false };
    const s = await this.d.kv.get<StoredSession>(PLATFORM_KEYS.backupSession);
    const pending = await this.d.kv.get<{ email: string; startedAt: number }>(PLATFORM_KEYS.backupPending);
    const pendingEmail = pending && this.now() - pending.startedAt < PENDING_TTL_MS ? pending.email : undefined;
    const base = pendingEmail ? { pendingEmail } : {};
    if (!s || s.expiresAt <= this.now()) return { signedIn: false, backups: [], available: true, ...base };
    try {
      const list = await (await this.client(true)).list();
      return { signedIn: true, email: s.email, backups: list.map((b) => ({ id: b.id, createdAt: b.createdAt })), available: true };
    } catch (e) {
      if (e instanceof ClipError && e.code === "backup/unauthorized") {
        await this.d.kv.remove(PLATFORM_KEYS.backupSession);
        return { signedIn: false, backups: [], available: true, ...base };
      }
      throw e;
    }
  }

  private async startSignIn(email: string): Promise<void> {
    const pending = await (await this.client(false)).startSignIn(email);
    // The verifier is a per-device sign-in secret (not key material). Kept so a service-worker restart
    // while the user reads their email doesn't lose it; dropped after use or 15 minutes.
    await this.d.kv.set(PLATFORM_KEYS.backupPending, pending);
  }

  private async completeSignIn(link: string): Promise<void> {
    const pending = await this.d.kv.get<{ email: string; verifier: string; startedAt: number }>(PLATFORM_KEYS.backupPending);
    if (!pending || this.now() - pending.startedAt > PENDING_TTL_MS) {
      throw new ClipError("That sign-in has expired. Ask for a new link.", "backup/link-invalid");
    }
    const c = await this.client(false);
    await c.completeSignIn(link, pending);
    await this.d.kv.remove(PLATFORM_KEYS.backupPending);
    if (!c.session) throw new ClipError("Sign-in didn't complete. Try again.", "backup/unauthorized");
    await this.d.kv.set<StoredSession>(PLATFORM_KEYS.backupSession, { ...c.session, email: pending.email });
    this.d.changed();
  }

  private async signOut(): Promise<void> {
    if (this.d.backup) await (await this.client(false)).signOut().catch(() => undefined);
    await this.d.kv.remove(PLATFORM_KEYS.backupSession);
    this.d.changed();
  }

  /** Create a backup passkey (WebAuthn create, PRF eval = BACKUP_PRF_INPUT), encrypt in the vault, upload. */
  private async backupBegin(password: string) {
    await this.requireUnlocked();
    const c = await this.client(true);
    const rpId = this.d.ceremonyMeta().rpId;
    return this.d.ceremonies.begin("enroll", async (prf) => {
      const { credentialId, prfOutput } = await prf.enroll(BACKUP_PRF_INPUT);
      let blob: Uint8Array;
      try {
        blob = await this.d.vault.createPasskeyBackup(password, prfOutput);
      } finally {
        prfOutput.fill(0);
      }
      await c.upload(blob, { credentialId: b64url(credentialId), rpId });
      this.d.changed();
    });
  }

  /** New device: download, ask the stored passkey for its PRF output, restore into the (empty) vault. */
  private async restoreBegin(backupId: string, password: string) {
    if ((await this.d.vault.status()) !== "empty") {
      throw new ClipError("This device already has a wallet. Remove it in Settings before restoring another.", "backup/vault-not-empty");
    }
    const c = await this.client(true);
    const { blob, meta } = await c.download(backupId);
    const here = this.d.ceremonyMeta().rpId;
    if ((meta.rpId ?? null) !== (here ?? null)) {
      throw new ClipError(
        `This backup was made with a passkey for ${meta.rpId ?? "another copy of this extension"}, which this browser can't use here. Restore with your recovery phrase instead.`,
        "backup/rp-mismatch",
      );
    }
    const credentialId = fromB64url(meta.credentialId);
    return this.d.ceremonies.begin("unlock", async (prf) => {
      const prfOutput = await prf.evaluate(credentialId, BACKUP_PRF_INPUT);
      try {
        await this.d.vault.restorePasskeyBackup(blob, prfOutput, password);
      } catch (e) {
        if (e instanceof ClipError && e.code === "vault/backup-mismatch") {
          throw new ClipError("That passkey can't unlock this backup. Try the passkey you used when you made it.", "backup/wrong-passkey");
        }
        throw e;
      } finally {
        prfOutput.fill(0);
      }
      await this.d.onRestored?.();
      this.d.changed();
    });
  }

  /* ------------------------------------------------------------------ accounts */

  private async counts(): Promise<Partial<Record<Family, number>>> {
    return (await this.d.kv.get<Partial<Record<Family, number>>>(PLATFORM_KEYS.accountCounts)) ?? {};
  }

  private async view(a: Account, labels: Record<string, string>): Promise<AccountView> {
    const v: AccountView = { id: a.id, family: a.family, index: a.index, label: labels[a.id] ?? `Account ${a.index + 1}`, address: a.address };
    const display = a.hederaAccountId ?? (a.family === "hedera" && this.d.hederaAccountId ? await this.d.hederaAccountId(a).catch(() => undefined) : undefined);
    if (display) v.displayAddress = display;
    return v;
  }

  async listAccounts(): Promise<AccountView[]> {
    await this.requireUnlocked();
    const labels = (await this.d.kv.get<Record<string, string>>(PLATFORM_KEYS.accountLabels)) ?? {};
    if (this.d.vault.listAccounts) {
      const list = await this.d.vault.listAccounts(this.d.families());
      return Promise.all(list.map((a) => this.view(a, a.label ? { ...labels, [a.id]: a.label } : labels)));
    }
    const counts = await this.counts();
    const out: AccountView[] = [];
    for (const f of this.d.families()) {
      const n = Math.max(1, counts[f] ?? 1);
      for (let i = 0; i < n; i++) out.push(await this.view(await this.d.vault.deriveAccount(f, i), labels));
    }
    return out;
  }

  async addAccount(family: Family): Promise<AccountView> {
    await this.requireUnlocked();
    if (!this.d.families().includes(family)) throw new ClipError("This kind of account isn't available in this version yet.", "family-unavailable");
    const counts = await this.counts();
    const n = this.d.vault.listAccounts ? (await this.d.vault.listAccounts([family])).length : Math.max(1, counts[family] ?? 1);
    if (n >= MAX_ACCOUNTS_PER_FAMILY) throw new ClipError(`You can have up to ${MAX_ACCOUNTS_PER_FAMILY} accounts of this kind.`, "accounts/limit");
    const acct = this.d.vault.addAccount ? await this.d.vault.addAccount(family) : await this.d.vault.deriveAccount(family, n);
    await this.d.kv.set(PLATFORM_KEYS.accountCounts, { ...counts, [family]: Math.max(n, acct.index + 1) });
    this.d.changed();
    return this.view(acct, (await this.d.kv.get<Record<string, string>>(PLATFORM_KEYS.accountLabels)) ?? {});
  }

  private async rename(id: string, label: string): Promise<void> {
    const clean = label.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 32);
    if (!clean) throw new ClipError("Give the account a name.", "accounts/bad-label");
    if (!(await this.known(id))) throw new ClipError("We couldn't find that account.", "accounts/unknown");
    if (this.d.vault.setAccountLabel) {
      const [f, i] = id.split(":");
      await this.d.vault.setAccountLabel(f as Family, Number(i), clean);
    } else {
      const labels = (await this.d.kv.get<Record<string, string>>(PLATFORM_KEYS.accountLabels)) ?? {};
      await this.d.kv.set(PLATFORM_KEYS.accountLabels, { ...labels, [id]: clean });
    }
    this.d.changed();
  }

  private async known(id: string): Promise<boolean> {
    const m = /^([a-z]+):(\d+)$/.exec(id);
    if (!m) return false;
    const f = m[1] as Family;
    if (!this.d.families().includes(f)) return false;
    if (this.d.vault.listAccounts) return (await this.d.vault.listAccounts([f])).some((a) => a.id === id);
    return Number(m[2]) < Math.max(1, (await this.counts())[f] ?? 1);
  }

  private async active(): Promise<StoredActive> {
    return (await this.d.kv.get<StoredActive>(PLATFORM_KEYS.activeAccounts)) ?? { defaults: {}, origins: {} };
  }

  private async getActive(origin?: string): Promise<ActiveAccounts> {
    const a = await this.active();
    return origin ? { defaults: a.defaults, forOrigin: a.origins[originKey(origin)] ?? {} } : { defaults: a.defaults };
  }

  private async setActive(family: Family, accountId: string | null, origin?: string): Promise<void> {
    if (accountId !== null && (!accountId.startsWith(`${family}:`) || !(await this.known(accountId)))) {
      throw new ClipError("We couldn't find that account.", "accounts/unknown");
    }
    const a = await this.active();
    if (origin) {
      const k = originKey(origin);
      const site = { ...(a.origins[k] ?? {}) };
      if (accountId === null) delete site[family];
      else site[family] = accountId;
      a.origins[k] = site;
    } else if (accountId === null) delete a.defaults[family];
    else a.defaults[family] = accountId;
    await this.d.kv.set(PLATFORM_KEYS.activeAccounts, a);
    this.d.changed();
  }

  /** The account id a site chose for a family in Settings → Accounts (no wallet-default fallback). */
  async siteChoice(family: Family, origin: string): Promise<string | undefined> {
    const id = (await this.active()).origins[originKey(origin)]?.[family];
    return id && (await this.known(id)) ? id : undefined;
  }

  /**
   * The account a site sees for a family: its override, else the wallet default, else account 0.
   * service.ts calls this from accountsFor() / ctx() (see the integration doc).
   */
  async activeAccount(family: Family, origin?: string): Promise<Account> {
    const a = await this.active();
    const id = (origin ? a.origins[originKey(origin)]?.[family] : undefined) ?? a.defaults[family] ?? `${family}:0`;
    const index = (await this.known(id)) ? Number(id.split(":")[1]) : 0;
    return this.d.vault.deriveAccount(family, index);
  }
}
