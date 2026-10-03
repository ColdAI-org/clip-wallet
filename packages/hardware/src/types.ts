/**
 * Hardware accounts: the key lives on a Ledger or a Keystone; the extension only ever holds public data.
 */
import type { Account, DappRequest, DecodedRequest, Family, Signature, SignablePayload } from "@clip-wallet/core";

export type HardwareKind = "ledger" | "keystone";

/** Families a hardware wallet can hold in this package today. */
export type HardwareFamily = Extract<Family, "evm" | "solana" | "bitcoin" | "hedera">;
export const HARDWARE_FAMILIES: readonly HardwareFamily[] = ["evm", "solana", "bitcoin", "hedera"];

/**
 * Which path scheme an account was found under. "standard" is the vault's scheme (same phrase, same
 * accounts). The others exist because people already have funds at those paths on their device.
 */
export type PathStyle = "standard" | "ledger-live" | "ledger-legacy";

export interface HardwareInfo {
  kind: HardwareKind;
  /** BIP-32 master key fingerprint, 8 hex chars. Identifies the device's seed, not the device. */
  fingerprint: string;
  /** Full derivation path of this account's key, e.g. m/44'/60'/0'/0/0. */
  path: string;
  pathStyle: PathStyle;
  /** Bitcoin only: the account-level extended public key and its origin path (m/84'/1'/0'). */
  accountXpub?: string;
  accountPath?: string;
  /** Bitcoin only: the address chain/index under accountPath. */
  change?: number;
  addressIndex?: number;
  /** Ledger Hedera only: the app signs by key index, not path. */
  keyIndex?: number;
  /** Optional device label for settings ("Nano X", "Keystone 3 Pro"). */
  deviceName?: string;
}

/** An Account whose key is on a device. `id` is `hw:<kind>:<fingerprint>:<family>:<index>`. */
export interface HardwareAccount extends Account {
  hardware: HardwareInfo;
}

export interface HardwareSignContext {
  request: DappRequest;
  decoded: DecodedRequest;
  /** The keyring fills this from payload.accountId. */
  account: HardwareAccount;
}

/** Parallel to the vault's sign(): what a device can do. */
export interface HardwareSigner {
  kind: HardwareKind;
  /** Accounts found on the device (Ledger) or in the synced keys (Keystone), `count` from `start`. */
  listAccounts(family: HardwareFamily, start: number, count: number, opts?: { pathStyle?: PathStyle; fingerprint?: string }): Promise<HardwareAccount[]>;
  /**
   * Signs one payload. The returned signature MUST verify over `payload.bytes` with the account's
   * public key; callers check that (see verifyFor) before using it.
   */
  sign(payload: SignablePayload, context: HardwareSignContext): Promise<Signature>;
}

const ID_RE = /^hw:(ledger|keystone):([0-9a-f]{8}):([a-z]+):(\d{1,10})(?::(ledger-live|ledger-legacy))?$/;

export function hardwareAccountId(kind: HardwareKind, fingerprint: string, family: HardwareFamily, index: number, style: PathStyle = "standard"): string {
  return `hw:${kind}:${fingerprint.toLowerCase()}:${family}:${index}${style === "standard" ? "" : `:${style}`}`;
}

export function isHardwareAccountId(id: string): boolean {
  return ID_RE.test(id);
}

export function parseHardwareAccountId(id: string): { kind: HardwareKind; fingerprint: string; family: HardwareFamily; index: number; pathStyle: PathStyle } | undefined {
  const m = ID_RE.exec(id);
  if (!m) return undefined;
  const family = m[3] as HardwareFamily;
  if (!HARDWARE_FAMILIES.includes(family)) return undefined;
  return { kind: m[1] as HardwareKind, fingerprint: m[2]!, family, index: Number(m[4]), pathStyle: (m[5] as PathStyle | undefined) ?? "standard" };
}
