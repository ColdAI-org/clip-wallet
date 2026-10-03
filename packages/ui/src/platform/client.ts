/**
 * Phase 2 "platform" additions to the UI ↔ background contract. Kept in a separate interface so the stream
 * merges without touching client.ts; the integration step makes `WalletClient extends PlatformClient`
 * (docs/phase2/integration/platform.md). Nothing here carries key material: the recovery phrase still only
 * crosses via the existing `revealPhrase`, and passkey ceremonies reuse `passkeyFinish` (PRF output only).
 */
import type { Family, NetworkId } from "@clip-wallet/core";
import type { PasskeyCeremony } from "../lib/passkey";
import type { WalletClient } from "../client";
import type { UiMessageId } from "../i18n/en";

/** Public metadata of one passkey-encrypted backup stored by services/backup. */
export interface PasskeyBackupView {
  id: string;
  createdAt: number;
}

export interface BackupStatusView {
  /** Signed in to the backup service on this device. */
  signedIn: boolean;
  /** Shown back to the user ("Signed in as me@example.com"); held by the background only for display. */
  email?: string;
  /** A sign-in email was sent and is waiting for the link. */
  pendingEmail?: string;
  backups: PasskeyBackupView[];
  /** False when this build has no backup service configured. */
  available: boolean;
}

export interface AccountView {
  /** `${family}:${index}` */
  id: string;
  family: Family;
  index: number;
  /** User label, or "Account N". */
  label: string;
  address: string;
  /** Hedera 0.0.x when known. */
  displayAddress?: string;
}

export interface ActiveAccounts {
  /** Wallet-wide default per family. */
  defaults: Partial<Record<Family, string>>;
  /** Overrides for one site (when `origin` was asked for). */
  forOrigin?: Partial<Record<Family, string>>;
}

export interface PlatformClient {
  /* passkey backup (services/backup) */
  backupStatus(): Promise<BackupStatusView>;
  /** Emails a one-time sign-in link; the background keeps the PKCE verifier for this device. */
  backupStartSignIn(p: { email: string }): Promise<void>;
  /** The link (or its token) the user pasted / opened. */
  backupCompleteSignIn(p: { link: string }): Promise<void>;
  backupSignOut(): Promise<void>;
  backupDelete(p: { id: string }): Promise<void>;
  /**
   * Creates a backup passkey (WebAuthn create with PRF eval = the vault's BACKUP_PRF_INPUT), has the vault
   * encrypt the phrase under its PRF output, and uploads the blob. The vault re-checks the password.
   */
  passkeyBackupBegin(p: { password: string }): Promise<PasskeyCeremony>;
  /** New device: downloads the blob, asks the passkey for its PRF output, and restores into a new vault with `password`. */
  passkeyRestoreBegin(p: { backupId: string; password: string }): Promise<PasskeyCeremony>;

  /* recovery-phrase backup */
  /** Records that the user passed the "I've written it down" check (no phrase involved). */
  markPhraseBackedUp(): Promise<void>;

  /* multiple accounts */
  listAccounts(): Promise<AccountView[]>;
  addAccount(p: { family: Family }): Promise<AccountView>;
  renameAccount(p: { id: string; label: string }): Promise<void>;
  getActiveAccounts(p?: { origin?: string }): Promise<ActiveAccounts>;
  /** `origin` omitted = wallet-wide default; `accountId: null` clears a site override. */
  setActiveAccount(p: { family: Family; accountId: string | null; origin?: string }): Promise<void>;

  /* names */
  /** Reverse lookup for display ("alice.eth"). */
  lookupName?(p: { address: string; family: Family; networkId?: NetworkId }): Promise<string | null>;
}

export type FullClient = WalletClient & PlatformClient;

const REQUIRED: (keyof PlatformClient)[] = ["backupStatus", "listAccounts", "markPhraseBackedUp"];

/** Narrowing helper for screens until WalletClient extends PlatformClient. */
export function asPlatform(client: WalletClient): FullClient {
  const c = client as Partial<FullClient>;
  for (const k of REQUIRED) {
    if (typeof c[k] !== "function") {
      throw new Error(`WalletClient is missing ${k}: wire PlatformClient (docs/phase2/integration/platform.md)`);
    }
  }
  return client as FullClient;
}

/** Plain-words family names for account lists (the network itself stays invisible). English; see familyLabel. */
export const FAMILY_LABEL: Partial<Record<Family, string>> = {
  evm: "Ethereum-style (ETH, USDC, Base, Arbitrum…)",
  hedera: "Hedera (HBAR)",
  solana: "Solana (SOL)",
  bitcoin: "Bitcoin (BTC)",
  sui: "Sui",
  aptos: "Aptos",
  cardano: "Cardano",
  substrate: "Polkadot",
  starknet: "Starknet",
  ton: "TON",
  near: "NEAR",
  stellar: "Stellar",
  tezos: "Tezos",
  algorand: "Algorand",
};

/** Catalog ids for the FAMILY_LABEL entries that carry words or a ticker list; the others are bare network names. */
export const FAMILY_LABEL_ID: Partial<Record<Family, UiMessageId>> = {
  evm: "backup.family.evm",
  hedera: "backup.family.hedera",
  solana: "backup.family.solana",
  bitcoin: "backup.family.bitcoin",
};

/** The family's display name in the current locale (network names themselves are never translated). */
export function familyLabel(family: Family, t: (id: UiMessageId) => string): string {
  const id = FAMILY_LABEL_ID[family];
  return id ? t(id) : (FAMILY_LABEL[family] ?? family);
}
