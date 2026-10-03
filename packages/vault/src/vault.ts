/**
 * ClipVault: the only holder of phrases and private keys. Implements the core `Vault` contract plus
 * additive methods the background needs (registerApproval, passkeys, changePassword, reset).
 *
 * Key hierarchy:
 *   password --Argon2id--> KEK --wraps--> VEK (random 32 bytes) --encrypts--> blob (BIP-39 entropy)
 *   passkey PRF output --HKDF--> PWK --wraps--> the same VEK            (optional, one per passkey)
 * While unlocked only the 64-byte BIP-39 seed is held in memory; KEK/VEK/entropy are wiped right after use.
 */
import {
  FAMILIES,
  type Account,
  type ChildAddress,
  type Family,
  type Signature,
  type SignablePayload,
  type SignatureScheme,
  type Vault,
} from "@clip-wallet/core";
import { ApprovalRegistry, hashSignablePayload } from "./approvals.js";
import { defaultAddressOf, type AddressContext, type AddressOf, type BitcoinAddressType, type BitcoinNetwork } from "./address.js";
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
import {
  CURVE_OF,
  accountNodePath,
  checkIndex,
  curveOf,
  deriveFamilyKey,
  deriveKey,
  derivationPath,
  type AlgorandScheme,
  type DerivedKey,
  type KeySource,
  type PathOptions,
  type StarknetScheme,
} from "./derive.js";
import type { Network2, TonWalletVersion } from "./encodings.js";
import { emptyMeta, openMeta, sealMeta, type VaultMeta } from "./meta.js";
import { hashWasmArgon2id, type Argon2idFn } from "./kdf.js";
import { VaultErrors } from "./errors.js";
import { passkeyBackup, passkeyWrapKey, type PasskeyPrf } from "./passkey.js";
import { entropyToPhrase, newPhrase, phraseToEntropy, phraseToSeed, type PhraseLength } from "./phrase.js";
import { signBip32Ed25519, signEcdsa, signEd25519, signSchnorr, signSr25519, signStark } from "./sign.js";
import { systemClock, type Clock, type VaultStorage } from "./storage.js";

export interface ClipVaultOptions {
  storage: VaultStorage;
  /** Default: Date.now + global timers. Tests inject a fake. */
  clock?: Clock;
  /** Auto-lock after this much inactivity. Default 15 minutes. 0 disables (not recommended). */
  autoLockMs?: number;
  /** Argon2id cost for newly written records. Default DEFAULT_ARGON2 (64 MiB, t=3, p=1). */
  argon2?: Argon2Params;
  /** Argon2id implementation. Default hash-wasm (WebAssembly); React Native passes a native one (see kdf.ts). */
  argon2id?: Argon2idFn;
  /** Default "testnet" (coin type 1', tb1 addresses). Mainnet needs an explicit build flag in the app. */
  bitcoinNetwork?: BitcoinNetwork;
  /** Default "testnet": Cardano base addresses use network id 0 (addr_test…). */
  cardanoNetwork?: Network2;
  /** Default "testnet": TON wallet v5r1 ids use the testnet global id (-3) and "0Q…" addresses. */
  tonNetwork?: Network2;
  /**
   * Starknet account class for `Account.address` (OpenZeppelin-style constructor(public_key)).
   * Default STARKNET_OZ_ACCOUNT_CLASS_HASH. Inject `addressOf` to delegate to chains-starknet instead.
   */
  starknetAccountClassHash?: string;
  /** Which wallet's Stark key derivation to follow. Default "argent-x". See README "Starknet". */
  starknetScheme?: StarknetScheme;
  /** Algorand derivation. Default "arc52" (Pera Universal Wallet); "slip10" = Trust Wallet. See README "Algorand". */
  algorandScheme?: AlgorandScheme;
  /** TON wallet contract for `Account.address`. Default "v5r1" (Tonkeeper); "v4r2" = Trust Wallet. */
  tonWalletVersion?: TonWalletVersion;
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
  /** Encrypted VaultMeta (account indexes, labels, handed-out change addresses). See meta.ts. */
  meta?: SealedBox;
  createdAt: number;
}

const AAD_PW = "clip-vault/v1/pw-wrap";
const AAD_BLOB = "clip-vault/v1/blob";
const aadPasskey = (credentialIdB64: string) => `clip-vault/v1/passkey-wrap/${credentialIdB64}`;

/** Which signature schemes each family's key may produce. Anything else is refused before the approval is consumed. */
export const FAMILY_SCHEMES: Record<Family, readonly SignatureScheme[]> = {
  evm: ["ecdsa-secp256k1"],
  hedera: ["ecdsa-secp256k1"],
  solana: ["ed25519"],
  bitcoin: ["ecdsa-secp256k1", "schnorr-secp256k1"],
  sui: ["ed25519"],
  aptos: ["ed25519"],
  near: ["ed25519"],
  stellar: ["ed25519"],
  algorand: ["ed25519"],
  tezos: ["ed25519"],
  ton: ["ed25519"],
  cardano: ["ed25519"], // BIP32-Ed25519 extended key, verifies as Ed25519
  substrate: ["sr25519"],
  starknet: ["stark-ecdsa"],
};

/**
 * OpenZeppelin Account (Cairo) class hash used for the default Starknet `Account.address`.
 * See README "Starknet" for the source and why the address is only a default.
 */
export const STARKNET_OZ_ACCOUNT_CLASS_HASH = "0x540d7f5ec7ecf317e68d48564934cb99259781b1ee3cedbbc37ec5337f8e688";

const MAX_LABEL = 64;

export class ClipVault implements Vault {
  private readonly storage: VaultStorage;
  private readonly clock: Clock;
  private readonly autoLockMs: number;
  private readonly argon2: Argon2Params;
  private readonly argon2id: Argon2idFn;
  private readonly bitcoinNetwork: BitcoinNetwork;
  private readonly cardanoNetwork: Network2;
  private readonly tonNetwork: Network2;
  private readonly starknetAccountClassHash: string;
  private readonly starknetScheme: StarknetScheme;
  private readonly algorandScheme: AlgorandScheme;
  private readonly tonWalletVersion: TonWalletVersion;
  private readonly addressOf: AddressOf;
  private readonly newPhraseWords: PhraseLength;
  private readonly storageKey: string;
  private readonly minPasswordLength: number;
  private readonly approvals: ApprovalRegistry;

  private seed: Uint8Array | null = null;
  /** BIP-39 entropy, kept alongside the seed: Cardano (CIP-3) and Substrate derive from it. Wiped on lock. */
  private entropy: Uint8Array | null = null;
  private lastActivity = 0;
  private timer: unknown = undefined;

  constructor(opts: ClipVaultOptions) {
    this.storage = opts.storage;
    this.clock = opts.clock ?? systemClock;
    this.autoLockMs = opts.autoLockMs ?? 15 * 60 * 1000;
    this.argon2 = opts.argon2 ?? DEFAULT_ARGON2;
    this.argon2id = opts.argon2id ?? hashWasmArgon2id;
    this.bitcoinNetwork = opts.bitcoinNetwork ?? "testnet";
    this.cardanoNetwork = opts.cardanoNetwork ?? "testnet";
    this.tonNetwork = opts.tonNetwork ?? "testnet";
    this.starknetAccountClassHash = opts.starknetAccountClassHash ?? STARKNET_OZ_ACCOUNT_CLASS_HASH;
    this.starknetScheme = opts.starknetScheme ?? "argent-x";
    this.algorandScheme = opts.algorandScheme ?? "arc52";
    this.tonWalletVersion = opts.tonWalletVersion ?? "v5r1";
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
      const kek = await deriveKek(newPassword, kdf, this.argon2id);
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
    const src = this.requireKeys();
    const account = this.accountFor(src, family, index, opts);
    this.touch();
    return account;
  }

  /**
   * The accounts the user has, per family: the indexes added with addAccount() and their labels, read
   * from the encrypted metadata. A family with nothing stored lists its first account (index 0).
   * Defaults to every family; pass `families` to limit the (CPU) work.
   */
  async listAccounts(families: readonly Family[] = FAMILIES): Promise<Account[]> {
    const src = this.requireKeys();
    const meta = await this.readMeta();
    const out: Account[] = [];
    for (const f of families) {
      if (!CURVE_OF[f]) throw new RangeError(`unknown family ${String(f)}`);
      for (const e of meta.accounts[f] ?? [{ index: 0 }]) {
        const a = this.accountFor(src, f, e.index);
        if (e.label) a.label = e.label;
        out.push(a);
      }
    }
    this.touch();
    return out;
  }

  /** Adds the next account index for `family` (one above the highest stored) and persists it. */
  async addAccount(family: Family, label?: string): Promise<Account> {
    const src = this.requireKeys();
    if (!CURVE_OF[family]) throw new RangeError(`unknown family ${String(family)}`);
    const meta = await this.readMeta();
    const list = meta.accounts[family] ?? [{ index: 0 }];
    const index = list.length ? Math.max(...list.map((e) => e.index)) + 1 : 0;
    checkIndex(index);
    const entry = { index, ...(label ? { label: cleanLabel(label) } : {}) };
    meta.accounts[family] = [...list, entry];
    const account = this.accountFor(src, family, index);
    await this.writeMeta(meta);
    if (entry.label) account.label = entry.label;
    this.touch();
    return account;
  }

  /** Sets (or with "" clears) an account's label. Adds the index to the stored list if it wasn't there. */
  async setAccountLabel(family: Family, index: number, label: string): Promise<void> {
    this.requireKeys();
    if (!CURVE_OF[family]) throw new RangeError(`unknown family ${String(family)}`);
    checkIndex(index);
    const meta = await this.readMeta();
    const list = (meta.accounts[family] ?? [{ index: 0 }]).filter((e) => e.index !== index);
    const clean = cleanLabel(label);
    list.push(clean ? { index, label: clean } : { index });
    meta.accounts[family] = list.sort((a, b) => a.index - b.index);
    await this.writeMeta(meta);
    this.touch();
  }

  /* ------------------------------------------------------------ bitcoin change addresses */

  /**
   * Change address `changeIndex` for a Bitcoin account: m/84'/c'/0'/1/<changeIndex> (or m/86'/… with
   * `bitcoinAddressType: "p2tr"`), i.e. the internal chain of the BIP-84/86 account node that holds every
   * vault Bitcoin account. Records the index as handed out to `accountIndex`, which is what lets sign()
   * use it via `derivationSubPath: "1/<changeIndex>"`.
   */
  async deriveChange(
    family: "bitcoin",
    accountIndex: number,
    changeIndex: number,
    opts: DeriveOptions = {},
  ): Promise<ChildAddress> {
    const src = this.requireKeys();
    if (family !== "bitcoin") throw new RangeError("change addresses are Bitcoin-only");
    checkIndex(accountIndex);
    checkIndex(changeIndex);
    const type = opts.bitcoinAddressType ?? "p2wpkh";
    const meta = await this.readMeta();
    const led = (meta.change[this.changeKey(type)] ??= { next: 0, owners: {} });
    const owner = Object.entries(led.owners).find(([, list]) => list.includes(changeIndex))?.[0];
    if (owner !== undefined && owner !== String(accountIndex)) throw VaultErrors.badPayload("change index belongs to another account");
    if (owner === undefined) {
      (led.owners[String(accountIndex)] ??= []).push(changeIndex);
      led.next = Math.max(led.next, changeIndex + 1);
      await this.writeMeta(meta);
    }
    const child = this.changeAddressFor(src, type, changeIndex);
    this.touch();
    return child;
  }

  /** Hands out the next never-used change address (global counter, so no two accounts share one). */
  async freshChange(family: "bitcoin", accountIndex: number, opts: DeriveOptions = {}): Promise<ChildAddress> {
    this.requireKeys();
    const meta = await this.readMeta();
    const next = meta.change[this.changeKey(opts.bitcoinAddressType ?? "p2wpkh")]?.next ?? 0;
    return this.deriveChange(family, accountIndex, next, opts);
  }

  /** Change addresses handed out to a Bitcoin account (for ChainContext.changeAddresses). */
  async listChange(family: "bitcoin", accountIndex: number, opts: DeriveOptions = {}): Promise<ChildAddress[]> {
    const src = this.requireKeys();
    if (family !== "bitcoin") throw new RangeError("change addresses are Bitcoin-only");
    checkIndex(accountIndex);
    const type = opts.bitcoinAddressType ?? "p2wpkh";
    const meta = await this.readMeta();
    const list = meta.change[this.changeKey(type)]?.owners[String(accountIndex)] ?? [];
    this.touch();
    return list.map((n) => this.changeAddressFor(src, type, n));
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
    const src = this.requireKeys();
    const { family, index } = parseAccountId(payload.accountId);
    if (!FAMILY_SCHEMES[family].includes(payload.scheme)) throw VaultErrors.schemeMismatch();
    if (!(payload.bytes instanceof Uint8Array) || payload.bytes.length === 0) throw VaultErrors.badPayload("empty bytes");
    if (payload.scheme === "ecdsa-secp256k1" && payload.bytes.length !== 32)
      throw VaultErrors.badPayload("ecdsa needs a 32-byte digest");
    if (payload.scheme === "stark-ecdsa" && (payload.bytes.length > 32 || payload.bytes[0]! >= (payload.bytes.length === 32 ? 0x08 : 0x100)))
      throw VaultErrors.badPayload("stark-ecdsa signs a hash below 2^251 (at most 32 bytes)");
    if (payload.options?.taprootTweak && payload.scheme !== "schnorr-secp256k1")
      throw VaultErrors.badPayload("taprootTweak only applies to schnorr");
    const bitcoinAddressType: BitcoinAddressType = payload.scheme === "schnorr-secp256k1" ? "p2tr" : "p2wpkh";
    const path =
      payload.derivationSubPath === undefined
        ? this.pathFor(family, index, bitcoinAddressType)
        : await this.subPathFor(family, index, payload.derivationSubPath, bitcoinAddressType);

    const hash = hashSignablePayload(payload);
    if (!this.approvals.consume(payload.approvalId, hash)) throw VaultErrors.noApproval();

    let key: DerivedKey | undefined;
    try {
      key = deriveFamilyKey(src, family, path, this.pathOptions(bitcoinAddressType));
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
        case "ed25519": {
          const bytes =
            key.curve === "bip32-ed25519" ? signBip32Ed25519(payload.bytes, key.privateKey) : signEd25519(payload.bytes, key.privateKey);
          return { scheme: payload.scheme, bytes, publicKey: toHex(key.publicKey) };
        }
        case "sr25519":
          return { scheme: payload.scheme, bytes: signSr25519(payload.bytes, key.privateKey), publicKey: toHex(key.publicKey) };
        case "stark-ecdsa": {
          const s = signStark(payload.bytes, key.privateKey);
          return { scheme: payload.scheme, bytes: s.bytes, recovery: s.recovery, publicKey: toHex(key.publicKey) };
        }
        default:
          throw VaultErrors.schemeMismatch();
      }
    } catch (e) {
      // The approval was consumed; a refusal by the primitive (e.g. stark hash >= 2^251) is a bad payload.
      if (e instanceof Error && !("userMessage" in e)) throw VaultErrors.badPayload(e.message);
      throw e;
    } finally {
      if (key) wipe(key.privateKey);
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

  private addressContext(bitcoinAddressType: BitcoinAddressType): AddressContext {
    return {
      bitcoinNetwork: this.bitcoinNetwork,
      bitcoinAddressType,
      cardanoNetwork: this.cardanoNetwork,
      tonNetwork: this.tonNetwork,
      tonWalletVersion: this.tonWalletVersion,
      starknetAccountClassHash: this.starknetAccountClassHash,
    };
  }

  private pathOptions(bitcoinAddressType: BitcoinAddressType = "p2wpkh"): PathOptions {
    return {
      bitcoinNetwork: this.bitcoinNetwork,
      bitcoinAddressType,
      starknetScheme: this.starknetScheme,
      algorandScheme: this.algorandScheme,
    };
  }

  private pathFor(family: Family, index: number, bitcoinAddressType: BitcoinAddressType = "p2wpkh"): string {
    return derivationPath(family, index, this.pathOptions(bitcoinAddressType));
  }

  private accountFor(src: KeySource, family: Family, index: number, opts: DeriveOptions = {}): Account {
    const curve = curveOf(family, this.pathOptions());
    const bitcoinAddressType = family === "bitcoin" ? (opts.bitcoinAddressType ?? "p2wpkh") : "p2wpkh";
    const path = this.pathFor(family, index, bitcoinAddressType);
    const key = deriveFamilyKey(src, family, path, this.pathOptions(bitcoinAddressType));
    wipe(key.privateKey);
    const ctx = this.addressContext(bitcoinAddressType);
    if (family === "cardano") {
      const stake = deriveFamilyKey(src, family, `${accountNodePath("cardano", index)}/2/0`);
      wipe(stake.privateKey);
      ctx.cardanoStakePublicKey = stake.publicKey;
    }
    return {
      id: `${family}:${index}`,
      family,
      index,
      curve,
      derivationPath: path,
      publicKey: toHex(key.publicKey),
      address: this.addressOf(family, key.publicKey, ctx),
    };
  }

  private changeKey(type: BitcoinAddressType): string {
    return `bitcoin:${this.bitcoinNetwork}:${type}`;
  }

  private changeAddressFor(src: KeySource, type: BitcoinAddressType, changeIndex: number): ChildAddress {
    const subPath = `1/${changeIndex}`;
    const path = `${accountNodePath("bitcoin", 0, { bitcoinNetwork: this.bitcoinNetwork, bitcoinAddressType: type })}/${subPath}`;
    const key = deriveKey(src, "secp256k1", path);
    wipe(key.privateKey);
    return {
      address: this.addressOf("bitcoin", key.publicKey, this.addressContext(type)),
      publicKey: toHex(key.publicKey),
      derivationPath: path,
      derivationSubPath: subPath,
    };
  }

  /**
   * Full path for a payload's `derivationSubPath`. Bitcoin: only "1/<n>" for a change index handed out to
   * this account. Cardano: "0/<n>", "1/<n>" (payment/internal) or "2/0" (stake) under the CIP-1852 account.
   */
  private async subPathFor(family: Family, index: number, sub: string, type: BitcoinAddressType): Promise<string> {
    if (family === "bitcoin") {
      const m = /^1\/(\d{1,10})$/.exec(sub);
      const n = m ? Number(m[1]) : NaN;
      if (!m || n > 0x7fffffff) throw VaultErrors.badPayload("bitcoin sub-paths are 1/<change index>");
      const meta = await this.readMeta();
      if (!meta.change[this.changeKey(type)]?.owners[String(index)]?.includes(n))
        throw VaultErrors.badPayload("change address was not handed out to this account");
      return `${accountNodePath("bitcoin", index, { bitcoinNetwork: this.bitcoinNetwork, bitcoinAddressType: type })}/${sub}`;
    }
    if (family === "cardano") {
      const m = /^([012])\/(\d{1,10})$/.exec(sub);
      if (!m || Number(m[2]) > 0x7fffffff || (m[1] === "2" && m[2] !== "0"))
        throw VaultErrors.badPayload("cardano sub-paths are 0/<n>, 1/<n> or 2/0");
      return `${accountNodePath("cardano", index)}/${Number(m[1])}/${Number(m[2])}`;
    }
    throw VaultErrors.badPayload(`${family} has no sub-paths`);
  }

  private async readMeta(): Promise<VaultMeta> {
    const seed = this.requireSeed();
    const rec = await this.requireRecord();
    if (!rec.meta) return emptyMeta();
    try {
      return openMeta(seed, rec.meta);
    } catch (e) {
      throw VaultErrors.corrupt(e);
    }
  }

  private async writeMeta(meta: VaultMeta): Promise<void> {
    const seed = this.requireSeed();
    const rec = await this.requireRecord();
    rec.meta = sealMeta(seed, meta);
    await this.save(rec);
  }

  private async initialise(phrase: string, password: string): Promise<void> {
    if (await this.load()) throw VaultErrors.exists();
    this.assertPassword(password);
    const entropy = phraseToEntropy(phrase); // validates
    const vek = randomBytes(32);
    const kdf = newKdfRecord(this.argon2);
    const kek = await deriveKek(password, kdf, this.argon2id);
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
      this.entropy = entropy.slice();
      this.touch();
    } finally {
      wipe(vek, entropy);
    }
  }

  private async unwrapWithPassword(rec: VaultRecord, password: string): Promise<Uint8Array> {
    let kek: Uint8Array | undefined;
    try {
      kek = await deriveKek(password, rec.kdf, this.argon2id);
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
    wipe(this.seed, this.entropy);
    this.seed = null;
    this.entropy = null;
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

  private requireKeys(): KeySource {
    const seed = this.requireSeed();
    return { seed, entropy: this.entropy! };
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
      if (rec.meta && (typeof rec.meta.nonce !== "string" || typeof rec.meta.ct !== "string")) throw new Error("bad meta");
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

function cleanLabel(label: string): string {
  if (typeof label !== "string") throw new TypeError("label must be a string");
  return label.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_LABEL);
}

export function parseAccountId(id: string): { family: Family; index: number } {
  const m = /^([a-z]+):(\d{1,10})$/.exec(id);
  const family = m?.[1] as Family | undefined;
  const index = m ? Number(m[2]) : NaN;
  if (!family || !FAMILIES.includes(family) || !Number.isInteger(index) || index > 0x7fffffff)
    throw VaultErrors.unknownAccount();
  return { family, index };
}
