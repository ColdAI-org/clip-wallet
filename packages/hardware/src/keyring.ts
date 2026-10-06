/**
 * HardwareKeyring: the background's single entry point for hardware accounts. It is to hardware
 * accounts what ClipVault is to phrase accounts: it holds the (public-only) account list, enforces
 * approval binding and checks every returned signature.
 *
 * Two ways to get a signature:
 *  - sign(): the keyring drives the device itself (a host that holds the device signers).
 *  - acceptSignature(): the device ran elsewhere (the extension's approval window, which has WebHID and
 *    the camera) and the background only checks what came back. The background keeps its own copy of the
 *    approved payload, so whatever the other side signed, only a signature over those exact bytes by the
 *    account's key is accepted, once.
 */
import type { DappRequest, DecodedRequest, Signature, SignablePayload, SignatureScheme } from "@clip-wallet/core";
import { HardwareApprovals } from "./approvals.js";
import { HardwareErrors } from "./errors.js";
import type { HardwareAccount, HardwareKind, HardwareSigner } from "./types.js";
import { isHardwareAccountId, parseHardwareAccountId } from "./types.js";
import { HARDWARE_CURVE } from "./paths.js";
import { verifiedSignature } from "./verify.js";
import { hardwareAddress, sameAddress } from "./address.js";

/** Same shape as the vault's VaultStorage (chrome.storage.local in the extension). Public data only. */
export interface HardwareStorage {
  get(key: string): Promise<string | undefined | null>;
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface HardwareKeyringOptions {
  /** Device signers for sign(). Optional: a host that only verifies (acceptSignature) passes none. */
  signers?: Partial<Record<HardwareKind, HardwareSigner>>;
  storage: HardwareStorage;
  now?: () => number;
  storageKey?: string;
}

const SCHEME_CURVE: Partial<Record<SignatureScheme, string>> = {
  "ecdsa-secp256k1": "secp256k1",
  "schnorr-secp256k1": "secp256k1",
  ed25519: "ed25519",
};

const PUBLIC_KEY_HEX: Record<string, number[]> = { secp256k1: [66, 130], ed25519: [64] };

/**
 * An account record agrees with its id (kind, seed fingerprint, family, index, path style) and has the
 * family's curve and a well-formed public key. Records can come from a page that ran the device, so the
 * keyring checks them before storing.
 */
function consistentAccount(a: HardwareAccount): boolean {
  const id = parseHardwareAccountId(a.id);
  if (!id || !a.hardware) return false;
  return (
    id.family === a.family &&
    id.index === a.index &&
    id.kind === a.hardware.kind &&
    id.fingerprint === a.hardware.fingerprint &&
    id.pathStyle === a.hardware.pathStyle &&
    a.curve === HARDWARE_CURVE[id.family] &&
    typeof a.publicKey === "string" &&
    !!PUBLIC_KEY_HEX[a.curve]?.includes(a.publicKey.length) &&
    /^[0-9a-f]+$/.test(a.publicKey)
  );
}

/**
 * Audit HW-01: the record's address must be the one its public key gives (see address.ts), and a Hedera account id
 * is never taken from a record. Returns the record with the derived (canonical) address, or undefined.
 */
function withDerivedAddress(a: HardwareAccount): HardwareAccount | undefined {
  let derived: string | undefined;
  try {
    derived = hardwareAddress(a);
  } catch {
    return undefined;
  }
  if (derived === undefined || typeof a.address !== "string" || !sameAddress(a.family, a.address, derived)) return undefined;
  if (a.family === "hedera" && a.hederaAccountId !== undefined) return undefined;
  return { ...a, address: derived };
}

interface Stored {
  v: 1;
  accounts: HardwareAccount[];
}

export class HardwareKeyring {
  private readonly signers: Partial<Record<HardwareKind, HardwareSigner>>;
  private readonly storage: HardwareStorage;
  private readonly storageKey: string;
  private readonly approvals: HardwareApprovals;

  constructor(opts: HardwareKeyringOptions) {
    this.signers = opts.signers ?? {};
    this.storage = opts.storage;
    this.storageKey = opts.storageKey ?? "clip-wallet/hardware/v1";
    this.approvals = new HardwareApprovals(opts.now ?? Date.now);
  }

  /** True for ids this keyring routes (`hw:...`). The background sends these here instead of the vault. */
  owns(accountId: string): boolean {
    return isHardwareAccountId(accountId);
  }

  signer(kind: HardwareKind): HardwareSigner {
    const s = this.signers[kind];
    if (!s) throw HardwareErrors.unsupported(`with a ${kind}`);
    return s;
  }

  async accounts(): Promise<HardwareAccount[]> {
    return (await this.load()).accounts;
  }

  async account(id: string): Promise<HardwareAccount | undefined> {
    return (await this.accounts()).find((a) => a.id === id);
  }

  /** Adds (or refreshes) accounts the user picked on the "Connect a hardware wallet" screen. */
  async addAccounts(accounts: HardwareAccount[]): Promise<void> {
    const rec = await this.load();
    for (const a of accounts) {
      if (!this.owns(a.id)) throw new Error(`not a hardware account id: ${a.id}`);
      const checked = consistentAccount(a) ? withDerivedAddress(a) : undefined;
      if (!checked) throw HardwareErrors.unknownAccount();
      const i = rec.accounts.findIndex((x) => x.id === a.id);
      if (i >= 0) rec.accounts[i] = { ...checked, label: rec.accounts[i]!.label ?? checked.label, hederaAccountId: rec.accounts[i]!.hederaAccountId };
      else rec.accounts.push(checked);
    }
    await this.save(rec);
  }

  async updateAccount(id: string, patch: Pick<Partial<HardwareAccount>, "label" | "hederaAccountId" | "address">): Promise<void> {
    const rec = await this.load();
    const a = rec.accounts.find((x) => x.id === id);
    if (!a) throw HardwareErrors.unknownAccount();
    // The address stays the one the key gives (HW-01); a host may set the Hedera account id it looked up itself.
    if (patch.address !== undefined && !withDerivedAddress({ ...a, address: patch.address, hederaAccountId: undefined })) throw HardwareErrors.unknownAccount();
    Object.assign(a, patch.address !== undefined ? { ...patch, address: a.address } : patch);
    await this.save(rec);
  }

  async removeAccount(id: string): Promise<void> {
    const rec = await this.load();
    rec.accounts = rec.accounts.filter((a) => a.id !== id);
    await this.save(rec);
  }

  /** "Forget this device": removes every account from that device's seed. */
  async removeDevice(kind: HardwareKind, fingerprint: string): Promise<void> {
    const rec = await this.load();
    rec.accounts = rec.accounts.filter((a) => !(a.hardware.kind === kind && a.hardware.fingerprint === fingerprint.toLowerCase()));
    await this.save(rec);
  }

  /** Call ONLY after the user approved the DecodedRequest, with exactly the payloads prepare() returned. */
  registerApproval(approvalId: string, payloads: SignablePayload[], ttlMs: number): void {
    this.approvals.register(approvalId, payloads, ttlMs);
  }

  revokeApproval(approvalId: string): void {
    this.approvals.revoke(approvalId);
  }

  /** Background lock: drop every live approval. */
  lock(): void {
    this.approvals.clear();
  }

  /** True while `payload` is approved and unused: a host checks this before asking a device to sign it. */
  isApproved(payload: SignablePayload): boolean {
    return this.approvals.has(payload);
  }

  /**
   * A signature produced outside this keyring (see the class comment). `payload` must be the caller's own
   * copy of what it registered, never one handed back by the signing side. Checks, in order: the account,
   * that the signature verifies over `payload.bytes` with the account's public key, then consumes the
   * approval (single use). Returns the signature as rebuilt by the verification.
   */
  async acceptSignature(payload: SignablePayload, sig: Signature): Promise<Signature> {
    const account = await this.checked(payload);
    const verified = verifiedSignature(sig, payload, account.publicKey);
    if (!this.approvals.consume(payload)) throw HardwareErrors.noApproval();
    return verified;
  }

  async sign(payload: SignablePayload, ctx: { request: DappRequest; decoded: DecodedRequest }): Promise<Signature> {
    const account = await this.checked(payload);
    if (!this.approvals.consume(payload)) throw HardwareErrors.noApproval();
    const sig = await this.signer(account.hardware.kind).sign(payload, { ...ctx, account });
    return verifiedSignature(sig, payload, account.publicKey);
  }

  private async checked(payload: SignablePayload): Promise<HardwareAccount> {
    const account = await this.account(payload.accountId);
    if (!account) throw HardwareErrors.unknownAccount();
    if (SCHEME_CURVE[payload.scheme] !== account.curve) throw HardwareErrors.unsupported("this kind of signature for this account");
    if (!(payload.bytes instanceof Uint8Array) || payload.bytes.length === 0) throw HardwareErrors.badSignature("empty payload");
    return account;
  }

  private async load(): Promise<Stored> {
    const raw = await this.storage.get(this.storageKey);
    if (!raw) return { v: 1, accounts: [] };
    const rec = JSON.parse(raw) as Stored;
    if (rec.v !== 1 || !Array.isArray(rec.accounts)) throw new Error("bad hardware account record");
    return rec;
  }

  private async save(rec: Stored): Promise<void> {
    await this.storage.set(this.storageKey, JSON.stringify(rec));
  }
}
