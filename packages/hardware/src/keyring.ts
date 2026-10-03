/**
 * HardwareKeyring: the background's single entry point for hardware accounts. It is to hardware
 * accounts what ClipVault is to phrase accounts: it holds the (public-only) account list, enforces
 * approval binding, routes sign() to the right device, and checks every returned signature.
 */
import type { DappRequest, DecodedRequest, Signature, SignablePayload, SignatureScheme } from "@clip-wallet/core";
import { HardwareApprovals } from "./approvals.js";
import { HardwareErrors } from "./errors.js";
import type { HardwareAccount, HardwareKind, HardwareSigner } from "./types.js";
import { isHardwareAccountId } from "./types.js";
import { assertVerifies } from "./verify.js";

/** Same shape as the vault's VaultStorage (chrome.storage.local in the extension). Public data only. */
export interface HardwareStorage {
  get(key: string): Promise<string | undefined | null>;
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface HardwareKeyringOptions {
  signers: Partial<Record<HardwareKind, HardwareSigner>>;
  storage: HardwareStorage;
  now?: () => number;
  storageKey?: string;
}

const SCHEME_CURVE: Partial<Record<SignatureScheme, string>> = {
  "ecdsa-secp256k1": "secp256k1",
  "schnorr-secp256k1": "secp256k1",
  ed25519: "ed25519",
};

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
    this.signers = opts.signers;
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
      const i = rec.accounts.findIndex((x) => x.id === a.id);
      if (i >= 0) rec.accounts[i] = { ...a, label: rec.accounts[i]!.label ?? a.label, hederaAccountId: rec.accounts[i]!.hederaAccountId ?? a.hederaAccountId };
      else rec.accounts.push(a);
    }
    await this.save(rec);
  }

  async updateAccount(id: string, patch: Pick<Partial<HardwareAccount>, "label" | "hederaAccountId" | "address">): Promise<void> {
    const rec = await this.load();
    const a = rec.accounts.find((x) => x.id === id);
    if (!a) throw HardwareErrors.unknownAccount();
    Object.assign(a, patch);
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

  async sign(payload: SignablePayload, ctx: { request: DappRequest; decoded: DecodedRequest }): Promise<Signature> {
    const account = await this.account(payload.accountId);
    if (!account) throw HardwareErrors.unknownAccount();
    if (SCHEME_CURVE[payload.scheme] !== account.curve) throw HardwareErrors.unsupported("this kind of signature for this account");
    if (!(payload.bytes instanceof Uint8Array) || payload.bytes.length === 0) throw HardwareErrors.badSignature("empty payload");
    if (!this.approvals.consume(payload)) throw HardwareErrors.noApproval();
    const sig = await this.signer(account.hardware.kind).sign(payload, { ...ctx, account });
    assertVerifies(sig, payload, account.publicKey);
    return sig;
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
