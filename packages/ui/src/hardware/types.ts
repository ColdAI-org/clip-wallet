/**
 * What the hardware screens need from the background. The extension implements this over its message
 * bus (docs/phase2/integration/hardware.md); tests use a fake. Public data only.
 */
import type { UiMessageId } from "../i18n";

export type HardwareKindView = "ledger" | "keystone";
export type HardwareFamilyView = "evm" | "solana" | "bitcoin" | "hedera";
export type PathStyleView = "standard" | "ledger-live" | "ledger-legacy";

export interface HardwareAccountView {
  id: string;
  family: HardwareFamilyView;
  index: number;
  address: string;
  derivationPath: string;
  label?: string;
  hardware: { kind: HardwareKindView; fingerprint: string; pathStyle: PathStyleView; deviceName?: string };
  /** True when this is the account the wallet uses for its family (one account per family today). */
  active?: boolean;
}

/** A Keystone sign request as the background hands it to the approval window. */
export interface KeystoneRequestView {
  /** UR type ("eth-sign-request", "sol-sign-request", "crypto-psbt"). */
  type: string;
  /** CBOR payload, hex. */
  cborHex: string;
  /** UR types the device will answer with. */
  expect: string[];
}

export interface HardwareClient {
  /** Ledger: must be called from a click (WebHID permission prompt). */
  ledgerAccounts(family: HardwareFamilyView, start: number, count: number, pathStyle?: PathStyleView): Promise<HardwareAccountView[]>;
  /** Keystone: hand over a complete account-export UR; returns which families it unlocked. */
  keystoneImport(ur: { type: string; cborHex: string }): Promise<{ fingerprint: string; families: HardwareFamilyView[] }>;
  keystoneAccounts(family: HardwareFamilyView, start: number, count: number, pathStyle?: PathStyleView): Promise<HardwareAccountView[]>;
  addAccounts(ids: string[]): Promise<void>;
  listAccounts(): Promise<HardwareAccountView[]>;
  renameAccount(id: string, label: string): Promise<void>;
  forgetDevice(kind: HardwareKindView, fingerprint: string): Promise<void>;
  /** Use this hardware account for its family, or `null` to go back to the recovery-phrase account. */
  setActive(family: HardwareFamilyView, accountId: string | null): Promise<void>;
}

/**
 * How each family is described. `title` and `assets` are UI catalog message ids (render with t()); `app` is
 * the name of the device app, which stays as is in every language.
 */
export const FAMILY_WORDS: Record<HardwareFamilyView, { title: UiMessageId; app: string; assets: UiMessageId }> = {
  evm: { title: "hardware.family.evm.title", app: "Ethereum", assets: "hardware.family.evm.assets" },
  solana: { title: "hardware.family.solana.title", app: "Solana", assets: "hardware.family.solana.assets" },
  bitcoin: { title: "hardware.family.bitcoin.title", app: "Bitcoin", assets: "hardware.family.bitcoin.assets" },
  hedera: { title: "hardware.family.hedera.title", app: "Hedera", assets: "hardware.family.hedera.assets" },
};

/**
 * Which families each device can hold today. Keystone has no Hedera support. Ledger Hedera accounts are
 * Ed25519 and wait for chains-hedera to accept Ed25519 accounts: add "hedera" to `ledger` when it does
 * (docs/phase2/integration/hardware.md, "Hedera").
 */
export const DEVICE_FAMILIES: Record<HardwareKindView, HardwareFamilyView[]> = {
  ledger: ["evm", "solana", "bitcoin"],
  keystone: ["evm", "solana", "bitcoin"],
};

export const shortAddress = (a: string): string => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/**
 * Set on ApprovalView.hardware by the background while a hardware account signs an approved request.
 * The approval window re-fetches on every change broadcast and shows the matching screen.
 */
export type HardwareApprovalState =
  | { kind: "ledger"; stage: "confirm"; app: string; error?: string }
  | { kind: "keystone"; stage: "exchange"; request: KeystoneRequestView; error?: string };

/** The two calls the approval window makes while a Keystone exchange is open. */
export interface HardwareApprovalClient {
  keystoneAnswer(approvalId: string, ur: { type: string; cborHex: string }): Promise<void>;
  /** Stops waiting for the device; the request fails with "Cancelled. Nothing was signed." */
  hardwareCancel(approvalId: string): Promise<void>;
}
