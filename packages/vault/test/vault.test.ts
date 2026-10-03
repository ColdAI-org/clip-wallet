import { beforeEach, describe, expect, it } from "vitest";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ClipError, type SignablePayload } from "@clip-wallet/core";
import {
  BACKUP_PRF_INPUT,
  ClipVault,
  DEFAULT_ARGON2,
  MemoryStorage,
  hashSignablePayload,
  passkeyBackup,
  taprootOutputKey,
  type Clock,
  type PasskeyPrf,
} from "../src/index.js";
import { fromB64, fromHex, randomBytes, toB64, toHex } from "../src/bytes.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct horse battery staple";
const FAST_ARGON2 = { memoryKiB: 256, iterations: 1, parallelism: 1 };

class FakeClock implements Clock {
  t = 1_700_000_000_000;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown) => void this.timers.delete(h as number);
  advance(ms: number) {
    this.t += ms;
    for (const [id, tm] of [...this.timers]) if (tm.at <= this.t) (this.timers.delete(id), tm.fn());
  }
}

/** Deterministic stand-in for a WebAuthn authenticator with the PRF extension. */
class FakePrf implements PasskeyPrf {
  private readonly creds = new Map<string, Uint8Array>();
  calls = 0;
  async enroll(prfInput: Uint8Array) {
    const credentialId = randomBytes(16);
    const secret = randomBytes(32);
    this.creds.set(toHex(credentialId), secret);
    return { credentialId, prfOutput: hmac(sha256, secret, prfInput) };
  }
  async evaluate(credentialId: Uint8Array, prfInput: Uint8Array) {
    this.calls++;
    const secret = this.creds.get(toHex(credentialId));
    if (!secret) throw new Error("unknown credential");
    return hmac(sha256, secret, prfInput);
  }
}

function newVault(over: Partial<ConstructorParameters<typeof ClipVault>[0]> = {}) {
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const vault = new ClipVault({ storage, clock, argon2: FAST_ARGON2, ...over });
  return { vault, storage, clock };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ClipError ? e.code : `non-clip: ${String(e)}`;
  }
  return "no-error";
}

function approve(vault: ClipVault, approvalId: string, payloads: Omit<SignablePayload, "approvalId">[], ttl = 60_000) {
  vault.registerApproval(approvalId, payloads.map(hashSignablePayload), ttl);
  return payloads.map((p) => ({ ...p, approvalId }));
}

describe("lifecycle and encryption at rest", () => {
  it("empty -> import -> unlocked; storage holds no plaintext", async () => {
    const { vault, storage } = newVault();
    expect(await vault.status()).toBe("empty");
    await vault.importPhrase(ABANDON, PW);
    expect(await vault.status()).toBe("unlocked");
    const raw = [...storage.data.values()].join("");
    expect(raw).not.toContain("abandon");
    expect(raw).not.toContain(PW);
    expect(raw).toContain('"alg":"argon2id"');
  });

  it("wrong password fails, right password unlocks", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    await vault.lock();
    expect(await vault.status()).toBe("locked");
    expect(await code(vault.unlock("wrong password!"))).toBe("vault/wrong-password");
    expect(await code(vault.revealPhrase("wrong password!"))).toBe("vault/wrong-password");
    expect(await vault.status()).toBe("locked");
    await vault.unlock(PW);
    expect(await vault.status()).toBe("unlocked");
    expect(await vault.revealPhrase(PW)).toBe(ABANDON);
  });

  it("a new vault in a second instance unlocks from the same storage", async () => {
    const { vault, storage } = newVault();
    await vault.create(PW);
    const phrase = await vault.revealPhrase(PW);
    expect(phrase.split(" ")).toHaveLength(12);
    const again = new ClipVault({ storage, argon2: FAST_ARGON2 });
    expect(await again.status()).toBe("locked");
    await again.unlock(PW);
    expect(await again.revealPhrase(PW)).toBe(phrase);
  });

  it("refuses invalid phrases, short passwords and overwriting an existing vault", async () => {
    const { vault } = newVault();
    expect(await code(vault.importPhrase(ABANDON.replace(/about$/, "abandon"), PW))).toBe("vault/invalid-phrase");
    expect(await code(vault.importPhrase(ABANDON, "short"))).toBe("vault/weak-password");
    await vault.importPhrase(ABANDON, PW);
    expect(await code(vault.create(PW))).toBe("vault/exists");
    await vault.reset();
    expect(await vault.status()).toBe("empty");
  });

  it("tampered ciphertext is detected", async () => {
    const { vault, storage } = newVault();
    await vault.importPhrase(ABANDON, PW);
    const [k, raw] = [...storage.data.entries()][0]!;
    const rec = JSON.parse(raw);
    const ct = fromB64(rec.blob.ct);
    ct[0]! ^= 1;
    rec.blob.ct = toB64(ct);
    storage.data.set(k, JSON.stringify(rec));
    await vault.lock();
    expect(await code(vault.unlock(PW))).toBe("vault/corrupt");
  });

  it("changePassword re-wraps the key", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    await vault.changePassword(PW, "another long password");
    await vault.lock();
    expect(await code(vault.unlock(PW))).toBe("vault/wrong-password");
    await vault.unlock("another long password");
    expect(await vault.revealPhrase("another long password")).toBe(ABANDON);
  });

  it("works with the default (production) Argon2id parameters", async () => {
    const storage = new MemoryStorage();
    const vault = new ClipVault({ storage });
    await vault.importPhrase(ABANDON, PW);
    expect(JSON.parse([...storage.data.values()][0]!).kdf).toMatchObject(DEFAULT_ARGON2);
    await vault.lock();
    await vault.unlock(PW);
    expect(await vault.status()).toBe("unlocked");
    await vault.lock();
  }, 30_000);

  it("derive and sign need an unlocked vault", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    await vault.lock();
    expect(await code(vault.deriveAccount("evm", 0))).toBe("vault/locked");
    expect(() => vault.registerApproval("a", [new Uint8Array(32)], 1000)).toThrow(/locked/);
  });
});

describe("accounts", () => {
  it("returns Account objects for each family", async () => {
    const { vault } = newVault({ bitcoinNetwork: "mainnet" });
    await vault.importPhrase(ABANDON, PW);
    const evm = await vault.deriveAccount("evm", 0);
    expect(evm).toMatchObject({
      id: "evm:0",
      curve: "secp256k1",
      derivationPath: "m/44'/60'/0'/0/0",
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    });
    expect(evm.publicKey).toHaveLength(66);
    expect((await vault.deriveAccount("bitcoin", 0)).address).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    const tr = await vault.deriveAccount("bitcoin", 0, { bitcoinAddressType: "p2tr" });
    expect(tr).toMatchObject({ id: "bitcoin:0", derivationPath: "m/86'/0'/0'/0/0" });
    expect(tr.address).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    const sol = await vault.deriveAccount("solana", 0);
    expect(sol).toMatchObject({ curve: "ed25519", address: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk" });
    const hed = await vault.deriveAccount("hedera", 0);
    expect(hed).toMatchObject({ curve: "secp256k1", derivationPath: "m/44'/3030'/0'/0/0" });
    expect(hed.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("defaults Bitcoin to testnet", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    const btc = await vault.deriveAccount("bitcoin", 0);
    expect(btc.derivationPath).toBe("m/84'/1'/0'/0/0");
    expect(btc.address.startsWith("tb1q")).toBe(true);
  });

  it("accepts an injected addressOf", async () => {
    const { vault } = newVault({ addressOf: (family, pk) => `${family}:${toHex(pk).slice(0, 8)}` });
    await vault.importPhrase(ABANDON, PW);
    expect((await vault.deriveAccount("solana", 0)).address).toMatch(/^solana:[0-9a-f]{8}$/);
  });
});

describe("approval binding and signing", () => {
  let vault: ClipVault;
  let clock: FakeClock;
  beforeEach(async () => {
    ({ vault, clock } = newVault());
    await vault.importPhrase(ABANDON, PW);
  });

  it("ecdsa: signs an approved digest once (low-S, recoverable)", async () => {
    const acct = await vault.deriveAccount("evm", 0);
    const digest = sha256(new TextEncoder().encode("hello"));
    const [p] = approve(vault, "appr-1", [{ accountId: "evm:0", scheme: "ecdsa-secp256k1", bytes: digest }]);
    const sig = await vault.sign(p!);
    expect(sig.bytes).toHaveLength(64);
    expect(sig.publicKey).toBe(acct.publicKey);
    const s = secp256k1.Signature.fromBytes(sig.bytes, "compact");
    expect(s.hasHighS()).toBe(false);
    expect(secp256k1.verify(sig.bytes, digest, fromHex(acct.publicKey), { prehash: false })).toBe(true);
    const recovered = s.addRecoveryBit(sig.recovery!).recoverPublicKey(digest).toBytes(true);
    expect(toHex(recovered)).toBe(acct.publicKey);
    // single use
    expect(await code(vault.sign(p!))).toBe("vault/no-approval");
  });

  it("refuses unapproved, altered or expired payloads", async () => {
    const digest = new Uint8Array(32).fill(9);
    const [p] = approve(vault, "appr-2", [{ accountId: "evm:0", scheme: "ecdsa-secp256k1", bytes: digest }], 5_000);
    expect(await code(vault.sign({ ...p!, approvalId: "nope" }))).toBe("vault/no-approval");
    expect(await code(vault.sign({ ...p!, bytes: new Uint8Array(32).fill(8) }))).toBe("vault/no-approval");
    expect(await code(vault.sign({ ...p!, accountId: "evm:1" }))).toBe("vault/no-approval");
    clock.advance(5_000);
    expect(await code(vault.sign(p!))).toBe("vault/no-approval");
  });

  it("multi-payload approval: each payload signs once, then the approval is gone", async () => {
    const a = { accountId: "evm:0", scheme: "ecdsa-secp256k1" as const, bytes: new Uint8Array(32).fill(1) };
    const b = { ...a, bytes: new Uint8Array(32).fill(2) };
    const [pa, pb] = approve(vault, "appr-3", [a, b]);
    await vault.sign(pa!);
    expect(await code(vault.sign(pa!))).toBe("vault/no-approval");
    await vault.sign(pb!);
    expect(await code(vault.sign(pb!))).toBe("vault/no-approval");
    // id is free again only because the approval was fully consumed
    expect(() => approve(vault, "appr-3", [a])).not.toThrow();
  });

  it("scheme/curve mismatch is refused and does not burn the approval", async () => {
    const bytes = new Uint8Array(32).fill(3);
    const [edOnEvm] = approve(vault, "appr-4", [{ accountId: "evm:0", scheme: "ed25519", bytes }]);
    expect(await code(vault.sign(edOnEvm!))).toBe("vault/scheme-mismatch");
    const [ecOnSol] = approve(vault, "appr-5", [{ accountId: "solana:0", scheme: "ecdsa-secp256k1", bytes }]);
    expect(await code(vault.sign(ecOnSol!))).toBe("vault/scheme-mismatch");
    const [schnorrOnSol] = approve(vault, "appr-6", [{ accountId: "solana:0", scheme: "schnorr-secp256k1", bytes }]);
    expect(await code(vault.sign(schnorrOnSol!))).toBe("vault/scheme-mismatch");
    const [schnorrOnEvm] = approve(vault, "appr-7", [{ accountId: "evm:0", scheme: "schnorr-secp256k1", bytes }]);
    expect(await code(vault.sign(schnorrOnEvm!))).toBe("vault/scheme-mismatch");
  });

  it("ecdsa refuses non-32-byte input; unknown accounts are refused", async () => {
    const [p] = approve(vault, "appr-8", [{ accountId: "evm:0", scheme: "ecdsa-secp256k1", bytes: new Uint8Array(31) }]);
    expect(await code(vault.sign(p!))).toBe("vault/bad-payload");
    expect(await code(vault.sign({ ...p!, accountId: "cosmos:0" }))).toBe("vault/unknown-account");
  });

  it("ed25519 (Solana)", async () => {
    const acct = await vault.deriveAccount("solana", 0);
    const msg = new TextEncoder().encode("solana message");
    const [p] = approve(vault, "appr-9", [{ accountId: "solana:0", scheme: "ed25519", bytes: msg }]);
    const sig = await vault.sign(p!);
    expect(sig.publicKey).toBe(acct.publicKey);
    expect(ed25519.verify(sig.bytes, msg, fromHex(acct.publicKey))).toBe(true);
  });

  it("schnorr (BIP-340) with and without the BIP-86 taproot tweak", async () => {
    const acct = await vault.deriveAccount("bitcoin", 0, { bitcoinAddressType: "p2tr" });
    const msg = sha256(new TextEncoder().encode("sighash"));
    const [plain, tweaked] = approve(vault, "appr-10", [
      { accountId: "bitcoin:0", scheme: "schnorr-secp256k1", bytes: msg },
      { accountId: "bitcoin:0", scheme: "schnorr-secp256k1", bytes: msg, options: { taprootTweak: new Uint8Array() } },
    ]);
    const s1 = await vault.sign(plain!);
    expect(s1.publicKey).toBe(acct.publicKey.slice(2)); // x-only internal key
    expect(schnorr.verify(s1.bytes, msg, fromHex(s1.publicKey))).toBe(true);
    const s2 = await vault.sign(tweaked!);
    expect(s2.publicKey).toBe(toHex(taprootOutputKey(fromHex(acct.publicKey))));
    expect(schnorr.verify(s2.bytes, msg, fromHex(s2.publicKey))).toBe(true);
  });

  it("lock clears approvals", async () => {
    const [p] = approve(vault, "appr-11", [{ accountId: "evm:0", scheme: "ecdsa-secp256k1", bytes: new Uint8Array(32) }]);
    await vault.lock();
    await vault.unlock(PW);
    expect(await code(vault.sign(p!))).toBe("vault/no-approval");
  });
});

describe("auto-lock", () => {
  it("locks after inactivity via timer, activity extends it", async () => {
    const { vault, clock } = newVault({ autoLockMs: 60_000 });
    await vault.importPhrase(ABANDON, PW);
    clock.advance(50_000);
    await vault.deriveAccount("evm", 0); // activity
    clock.advance(50_000);
    expect(await vault.status()).toBe("unlocked");
    clock.advance(10_000);
    expect(await vault.status()).toBe("locked");
    expect(await code(vault.deriveAccount("evm", 0))).toBe("vault/locked");
  });

  it("locks lazily when timers never fire (suspended service worker)", async () => {
    let t = 0;
    const { vault } = newVault({ autoLockMs: 1_000, clock: { now: () => t } });
    await vault.importPhrase(ABANDON, PW);
    t += 999;
    expect(await vault.status()).toBe("unlocked");
    t += 1_001;
    expect(await code(vault.deriveAccount("evm", 0))).toBe("vault/locked");
  });
});

describe("passkey unlock (PRF)", () => {
  it("round trip: enrol, lock, unlock with passkey", async () => {
    const { vault, storage } = newVault();
    await vault.importPhrase(ABANDON, PW);
    const prf = new FakePrf();
    const info = await vault.enrollPasskey(PW, prf);
    expect(await vault.listPasskeys()).toHaveLength(1);
    await vault.lock();

    // fresh instance, same storage, like a restarted service worker
    const again = new ClipVault({ storage, argon2: FAST_ARGON2 });
    await again.unlockWithPasskey(prf, info.credentialId);
    expect(await again.status()).toBe("unlocked");
    expect((await again.deriveAccount("evm", 0)).address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    // password still works too
    await again.lock();
    await again.unlock(PW);
    expect(await again.status()).toBe("unlocked");
  });

  it("wrong PRF output, unknown credential and no enrolment all fail cleanly", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    expect(await code(vault.unlockWithPasskey(new FakePrf()))).toBe("vault/passkey-unavailable");
    const prf = new FakePrf();
    const info = await vault.enrollPasskey(PW, prf);
    await vault.lock();
    const evil: PasskeyPrf = { enroll: prf.enroll.bind(prf), evaluate: async () => randomBytes(32) };
    expect(await code(vault.unlockWithPasskey(evil, info.credentialId))).toBe("vault/passkey-failed");
    expect(await code(vault.unlockWithPasskey(prf, randomBytes(16)))).toBe("vault/passkey-unavailable");
    expect(await vault.status()).toBe("locked");
  });

  it("enrolment requires the password; removal disables the passkey", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    const prf = new FakePrf();
    expect(await code(vault.enrollPasskey("not the password", prf))).toBe("vault/wrong-password");
    const info = await vault.enrollPasskey(PW, prf);
    await vault.removePasskey(info.credentialId);
    await vault.lock();
    expect(await code(vault.unlockWithPasskey(prf, info.credentialId))).toBe("vault/passkey-unavailable");
  });

  it("passkey wrap survives a password change", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    const prf = new FakePrf();
    const info = await vault.enrollPasskey(PW, prf);
    await vault.changePassword(PW, "another long password");
    await vault.lock();
    await vault.unlockWithPasskey(prf, info.credentialId);
    expect(await vault.status()).toBe("unlocked");
  });
});

describe("passkeyBackup (Phase 2)", () => {
  it("encrypts and decrypts a phrase under a PRF output", async () => {
    const prfOut = hmac(sha256, randomBytes(32), BACKUP_PRF_INPUT);
    const blob = passkeyBackup.encrypt(ABANDON, prfOut);
    expect(new TextDecoder().decode(blob.subarray(0, 4))).toBe("CLPB");
    expect(passkeyBackup.decrypt(blob, prfOut)).toBe(ABANDON);
    expect(() => passkeyBackup.decrypt(blob, randomBytes(32))).toThrow();
    const tampered = blob.slice();
    tampered[10]! ^= 1; // header (salt) is authenticated
    expect(() => passkeyBackup.decrypt(tampered, prfOut)).toThrow();
  });

  it("vault.createPasskeyBackup never exposes the phrase to the caller", async () => {
    const { vault } = newVault();
    await vault.importPhrase(ABANDON, PW);
    const prfOut = randomBytes(32);
    const blob = await vault.createPasskeyBackup(PW, prfOut);
    expect(passkeyBackup.decrypt(blob, prfOut)).toBe(ABANDON);
  });
});
