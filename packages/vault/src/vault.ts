/**
 * ClipVault: the only holder of phrases and private keys. Implements the core `Vault` contract plus
 * additive methods the background needs (registerApproval, passkeys, changePassword, reset).
 *
 * Key hierarchy:
 *   password --Argon2id--> KEK --wraps--> VEK (random 32 bytes) --encrypts--> blob (BIP-39 entropy)
 *   passkey PRF output --HKDF--> PWK --wraps--> the same VEK            (optional, one per passkey)
 * While unlocked only the 64-byte BIP-39 seed is held in memory; KEK/VEK/entropy are wiped right after use.
 */
import type { Account, Curve, Family, Signature, SignablePayload, SignatureScheme, Vault } from "@clip-wallet/core";
import { ApprovalRegistry, hashSignablePayload } from "./approvals.js";
import { defaultAddressOf, type AddressOf, type BitcoinAddressType, type BitcoinNetwork } from "./address.js";
import { fromB64, randomBytes, toB64, toHex, wipe } from "./bytes.js";
import {
  DEFAULT_ARGON2,
  deriveKek,
  newKdfRecord,
  open,
  seal,
  type Argon2Params,
  type KdfRecord,
  type SealedBox,
} from "./crypto.js";
import { CURVE_OF, deriveKey, derivationPath } from "./derive.js";
import { VaultErrors } from "./errors.js";
import { passkeyBackup, passkeyWrapKey, type PasskeyPrf } from "./passkey.js";
import { entropyToPhrase, newPhrase, phraseToEntropy, phraseToSeed, type PhraseLength } from "./phrase.js";
import { signEcdsa, signEd25519, signSchnorr } from "./sign.js";
import { systemClock, type Clock, type VaultStorage } from "./storage.js";

export interface ClipVaultOptions {
  storage: VaultStorage;
  /** Default: Date.now + global timers. Tests inject a fake. */
  clock?: Clock;
  /** Auto-lock after this much inactivity. Default 15 minutes. 0 disables (not recommended). */
  autoLockMs?: number;
  /** Argon2id cost for newly written records. Default DEFAULT_ARGON2 (64 MiB, t=3, p=1). */
  argon2?: Argon2Params;
  /** Default "testnet" (coin type 1', tb1 addresses). Mainnet needs an explicit build flag in the app. */
  bitcoinNetwork?: BitcoinNetwork;
  /** Override the built-in address helpers (e.g. delegate to chain modules). */
  addressOf?: AddressOf;
  /** Words for create(). Default 12. */
  newPhraseWords?: PhraseLength;
  storageKey?: string;
  minPasswordLength?: number;
}

export interface DeriveOptions {
  /** Bitcoin only. "p2wpkh" (BIP-84, default) or "p2tr" (BIP-86). Both share the account id `bitcoin:<i>`. */
  bitcoinAddressType?: BitcoinAddressType;
}

export interface PasskeyInfo {
  credentialId: Uint8Array;
  createdAt: number;
}

interface PasskeyRecord {
  credentialId: string;
  prfInput: string;
  salt: string;
  wrap: SealedBox;
  createdAt: number;
}

interface VaultRecord {
  v: 1;
  kdf: KdfRecord;
  pwWrap: SealedBox;
  blob: SealedBox;
  passkeys: PasskeyRecord[];
  createdAt: number;
}

const AAD_PW = "clip-vault/v1/pw-wrap";
const AAD_BLOB = "clip-vault/v1/blob";
const aadPasskey = (credentialIdB64: string) => `clip-vault/v1/passkey-wrap/${credentialIdB64}`;

const SCHEME_CURVE: Record<SignatureScheme, Curve> = {
  "ecdsa-secp256k1": "secp256k1",
  "schnorr-secp256k1": "secp256k1",
  ed25519: "ed25519",
};

export class ClipVault implements Vault {
  private readonly storage: VaultStorage;
  private readonly clock: Clock;
  private readonly autoLockMs: number;
  private readonly argon2: Argon2Params;
  private readonly bitcoinNetwork: BitcoinNetwork;
  private readonly addressOf: AddressOf;
  private readonly newPhraseWords: PhraseLength;
  private readonly storageKey: string;
  private readonly minPasswordLength: number;
  private readonly approvals: ApprovalRegistry;

  private seed: Uint8Array | null = null;
  private lastActivity = 0;
  private timer: unknown = undefined;

  constructor(opts: ClipVaultOptions) {
    this.storage = opts.storage;
    this.clock = opts.clock ?? systemClock;
    this.autoLockMs = opts.autoLockMs ?? 15 * 60 * 1000;
    this.argon2 = opts.argon2 ?? DEFAULT_ARGON2;
    this.bitcoinNetwork = opts.bitcoinNetwork ?? "testnet";
    this.addressOf = opts.addressOf ?? defaultAddressOf;
    this.newPhraseWords = opts.newPhraseWords ?? 12;
    this.storageKey = opts.storageKey ?? "clip-wallet/vault/v1";
    this.minPasswordLength = opts.minPasswordLength ?? 8;
    this.approvals = new ApprovalRegistry(() => this.clock.now());
  }

  /* ------------------------------------------------------------ lifecycle */

  async status(): Promise<"empty" | "locked" | "unlocked"> {
    if (!(await this.load())) return "empty";
    this.checkAutoLock();
    return this.seed ? "unlocked" : "locked";
  }

  async create(password: string): Promise<void> {
    await this.initialise(newPhrase(this.newPhraseWords), password);
  }

  async importPhrase(phrase: string, password: string): Promise<void> {
    await this.initialise(phrase, password);
  }

  async revealPhrase(password: string): Promise<string> {
    const rec = await this.requireRecord();
    const vek = await this.unwrapWithPassword(rec, password);
    const entropy = this.openBlob(rec, vek);
    try {
      return entropyToPhrase(entropy);
    } finally {
      wipe(entropy);
    }
  }

  async unlock(password: string): Promise<void> {
    const rec = await this.requireRecord();
    const vek = await this.unwrapWithPassword(rec, password);
    await this.unlockWithVek(rec, vek);
  }

  async lock(): Promise<void> {
    this.lockSync();
  }

  /** Removes the vault from storage. The app must confirm with the user first. */
  async reset(): Promise<void> {
    this.lockSync();
    await this.storage.remove(this.storageKey);
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    this.assertPassword(newPassword);
    const rec = await this.requireRecord();
    const vek = await this.unwrapWithPassword(rec, oldPassword);
    try {
      const kdf = newKdfRecord(this.argon2);
      const kek = await deriveKek(newPassword, kdf);
      rec.kdf = kdf;
      rec.pwWrap = seal(kek, vek, AAD_PW);
      wipe(kek);
      await this.save(rec);
    } finally {
      wipe(vek);
    }
  }

  /* ------------------------------------------------------------ accounts */

  async deriveAccount(family: Family, index: number, opts: DeriveOptions = {}): Promise<Account> {
    const seed = this.requireSeed();
    const curve = CURVE_OF[family];
    if (!curve) throw new RangeError(`unknown family ${String(family)}`);
    const bitcoinAddressType = family === "bitcoin" ? (opts.bitcoinAddressType ?? "p2wpkh") : "p2wpkh";
    const path = derivationPath(family, index, { bitcoinNetwork: this.bitcoinNetwork, bitcoinAddressType });
    const key = deriveKey(seed, curve, path);
    wipe(key.privateKey);
    this.touch();
    return {
      id: `${family}:${index}`,
      family,
      index,
      curve,
      derivationPath: path,
      publicKey: toHex(key.publicKey),
      address: this.addressOf(family, key.publicKey, { bitcoinNetwork: this.bitcoinNetwork, bitcoinAddressType }),
    };
  }

  /* ------------------------------------------------------------ approvals + signing */

  /**
   * Called by the background ONLY after the user approved the DecodedRequest. `payloadHashes` are
   * hashSignablePayload() of each SignablePayload the chain module prepared. Each hash signs once;
   * the approval is gone when all are used, when it expires (ttl capped at 10 min) or on lock().
   */
  registerApproval(approvalId: string, payloadHashes: Uint8Array[], ttlMs: number): void {
    this.requireSeed();
    this.approvals.register(approvalId, payloadHashes, ttlMs);
  }

  revokeApproval(approvalId: string): void {
    this.approvals.revoke(approvalId);
  }

  async sign(payload: SignablePayload): Promise<Signature> {
    const seed = this.requireSeed();
    const { family, index } = parseAccountId(payload.accountId);
    const curve = CURVE_OF[family];
    if (SCHEME_CURVE[payload.scheme] !== curve) throw VaultErrors.schemeMismatch();
    // Taproot keys are only defined for Bitcoin; Solana is the only ed25519 family in v1.
    if (payload.scheme === "schnorr-secp256k1" && family !== "bitcoin") throw VaultErrors.schemeMismatch();
    if (!(payload.bytes instanceof Uint8Array) || payload.bytes.length === 0) throw VaultErrors.badPayload("empty bytes");
    if (payload.scheme === "ecdsa-secp256k1" && payload.bytes.length !== 32)
      throw VaultErrors.badPayload("ecdsa needs a 32-byte digest");
    if (payload.options?.taprootTweak && payload.scheme !== "schnorr-secp256k1")
      throw VaultErrors.badPayload("taprootTweak only applies to schnorr");

    const hash = hashSignablePayload(payload);
    if (!this.approvals.consume(payload.approvalId, hash)) throw VaultErrors.noApproval();

    const bitcoinAddressType: BitcoinAddressType = payload.scheme === "schnorr-secp256k1" ? "p2tr" : "p2wpkh";
    const path = derivationPath(family, index, { bitcoinNetwork: this.bitcoinNetwork, bitcoinAddressType });
    const key = deriveKey(seed, curve, path);
    try {
      this.touch();
      switch (payload.scheme) {
        case "ecdsa-secp256k1": {
          const s = signEcdsa(payload.bytes, key.privateKey);
          return { scheme: payload.scheme, bytes: s.bytes, recovery: s.recovery, publicKey: toHex(key.publicKey) };
        }
        case "schnorr-secp256k1": {
          const s = signSchnorr(payload.bytes, key.privateKey, payload.options?.taprootTweak);
          return { scheme: payload.scheme, bytes: s.bytes, publicKey: toHex(s.publicKey) };
        }
        case "ed25519":
          return { scheme: payload.scheme, bytes: signEd25519(payload.bytes, key.privateKey), publicKey: toHex(key.publicKey) };
      }
    } finally {
      wipe(key.privateKey);
    }
  }

  /* ------------------------------------------------------------ passkeys */

  /** Adds a passkey unlock path. Requires the password (re-authentication) to reach the VEK. */
  async enrollPasskey(password: string, prf: PasskeyPrf): Promise<PasskeyInfo> {
    const rec = await this.requireRecord();
    const vek = await this.unwrapWithPassword(rec, password);
    const prfInput = randomBytes(32);
    let prfOutput: Uint8Array | undefined;
    let wk: Uint8Array | undefined;
    try {
      const enrolled = await prf.enroll(prfInput);
      prfOutput = enrolled.prfOutput;
      const salt = randomBytes(32);
      wk = passkeyWrapKey(prfOutput, salt);
      const credentialId = toB64(enrolled.credentialId);
      const createdAt = this.clock.now();
      rec.passkeys = rec.passkeys.filter((p) => p.credentialId !== credentialId);
      rec.passkeys.push({
        credentialId,
        prfInput: toB64(prfInput),
        salt: toB64(salt),
        wrap: seal(wk, vek, aadPasskey(credentialId)),
        createdAt,
      });
      await this.save(rec);
      return { credentialId: enrolled.credentialId, createdAt };
    } finally {
      wipe(vek, wk, prfOutput);
    }
  }

  async listPasskeys(): Promise<PasskeyInfo[]> {
    const rec = await this.load();
    return (rec?.passkeys ?? []).map((p) => ({ credentialId: fromB64(p.credentialId), createdAt: p.createdAt }));
  }

  async removePasskey(credentialId: Uint8Array): Promise<void> {
    const rec = await this.requireRecord();
    const id = toB64(credentialId);
    rec.passkeys = rec.passkeys.filter((p) => p.credentialId !== id);
    await this.save(rec);
  }

  /** Unlock with a passkey. Without `credentialId` the most recently enrolled passkey is used. */
  async unlockWithPasskey(prf: PasskeyPrf, credentialId?: Uint8Array): Promise<void> {
    const rec = await this.requireRecord();
    const pk = credentialId
      ? rec.passkeys.find((p) => p.credentialId === toB64(credentialId))
      : rec.passkeys[rec.passkeys.length - 1];
    if (!pk) throw VaultErrors.passkeyUnavailable();
    let prfOutput: Uint8Array | undefined;
    let wk: Uint8Array | undefined;
    let vek: Uint8Array;
    try {
      prfOutput = await prf.evaluate(fromB64(pk.credentialId), fromB64(pk.prfInput));
      wk = passkeyWrapKey(prfOutput, fromB64(pk.salt));
      vek = open(wk, pk.wrap, aadPasskey(pk.credentialId));
    } catch (e) {
      throw VaultErrors.passkeyFailed(e);
    } finally {
      wipe(wk, prfOutput);
    }
    await this.unlockWithVek(rec, vek);
  }

  /**
   * Phase 2: encrypts this vault's phrase under a PRF output (use BACKUP_PRF_INPUT) without the phrase
   * ever leaving the vault. Returns an opaque blob; see passkeyBackup for the format. No network calls.
   */
  async createPasskeyBackup(password: string, prfOutput: Uint8Array): Promise<Uint8Array> {
    const phrase = await this.revealPhrase(password);
    return passkeyBackup.encrypt(phrase, prfOutput);
  }

  /* ------------------------------------------------------------ internals */

  private async initialise(phrase: string, password: string): Promise<void> {
    if (await this.load()) throw VaultErrors.exists();
    this.assertPassword(password);
    const entropy = phraseToEntropy(phrase); // validates
    const vek = randomBytes(32);
    const kdf = newKdfRecord(this.argon2);
    const kek = await deriveKek(password, kdf);
    try {
      const rec: VaultRecord = {
        v: 1,
        kdf,
        pwWrap: seal(kek, vek, AAD_PW),
        blob: seal(vek, entropy, AAD_BLOB),
        passkeys: [],
        createdAt: this.clock.now(),
      };
      await this.save(rec);
    } finally {
      wipe(kek, entropy);
    }
    const rec = await this.requireRecord();
    await this.unlockWithVek(rec, vek);
  }

  /** Consumes (wipes) `vek`. */
  private async unlockWithVek(rec: VaultRecord, vek: Uint8Array): Promise<void> {
    let entropy: Uint8Array | undefined;
    try {
      entropy = this.openBlob(rec, vek);
      const seed = await phraseToSeed(entropyToPhrase(entropy));
      this.lockSync();
      this.seed = seed;
      this.touch();
    } finally {
      wipe(vek, entropy);
    }
  }

  private async unwrapWithPassword(rec: VaultRecord, password: string): Promise<Uint8Array> {
    let kek: Uint8Array | undefined;
    try {
      kek = await deriveKek(password, rec.kdf);
      return open(kek, rec.pwWrap, AAD_PW);
    } catch {
      throw VaultErrors.wrongPassword();
    } finally {
      wipe(kek);
    }
  }

  private openBlob(rec: VaultRecord, vek: Uint8Array): Uint8Array {
    try {
      return open(vek, rec.blob, AAD_BLOB);
    } catch (e) {
      throw VaultErrors.corrupt(e);
    }
  }

  private lockSync(): void {
    wipe(this.seed);
    this.seed = null;
    this.approvals.clear();
    if (this.timer !== undefined) this.clock.clearTimeout?.(this.timer);
    this.timer = undefined;
  }

  private touch(): void {
    this.lastActivity = this.clock.now();
    if (this.autoLockMs <= 0 || !this.clock.setTimeout) return;
    if (this.timer !== undefined) this.clock.clearTimeout?.(this.timer);
    this.timer = this.clock.setTimeout(() => this.checkAutoLock(), this.autoLockMs);
  }

  /** Lazy check as well as the timer: MV3 service workers can be suspended and timers skipped. */
  private checkAutoLock(): void {
    if (this.seed && this.autoLockMs > 0 && this.clock.now() - this.lastActivity >= this.autoLockMs) this.lockSync();
  }

  private requireSeed(): Uint8Array {
    this.checkAutoLock();
    if (!this.seed) throw VaultErrors.locked();
    return this.seed;
  }

  private assertPassword(password: string): void {
    if (typeof password !== "string" || [...password].length < this.minPasswordLength) throw VaultErrors.weakPassword();
  }

  private async load(): Promise<VaultRecord | undefined> {
    const raw = await this.storage.get(this.storageKey);
    if (raw === undefined || raw === null) return undefined;
    try {
      const rec = JSON.parse(raw) as VaultRecord;
      if (rec.v !== 1 || !rec.kdf || !rec.pwWrap || !rec.blob) throw new Error("bad record");
      rec.passkeys ??= [];
      return rec;
    } catch (e) {
      throw VaultErrors.corrupt(e);
    }
  }

  private async requireRecord(): Promise<VaultRecord> {
    const rec = await this.load();
    if (!rec) throw VaultErrors.empty();
    return rec;
  }

  private async save(rec: VaultRecord): Promise<void> {
    await this.storage.set(this.storageKey, JSON.stringify(rec));
  }
}

const FAMILIES: readonly Family[] = ["evm", "hedera", "solana", "bitcoin"];

export function parseAccountId(id: string): { family: Family; index: number } {
  const m = /^([a-z]+):(\d{1,10})$/.exec(id);
  const family = m?.[1] as Family | undefined;
  const index = m ? Number(m[2]) : NaN;
  if (!family || !FAMILIES.includes(family) || !Number.isInteger(index) || index > 0x7fffffff)
    throw VaultErrors.unknownAccount();
  return { family, index };
}
