import { describe, expect, it, vi } from "vitest";
import type { Family } from "@clip-wallet/core";
import type { ClipVault } from "@clip-wallet/vault";
import config from "./clip.config";
import { MemoryKV } from "../src/shared/storage";
import { createDependencies } from "../src/background/wiring";
import { PasskeyCeremonies, b64url } from "../src/background/passkey-proxy";
import { PLATFORM_KEYS, PlatformService, type BackupClientLike } from "../src/background/platform";
import { FAST_ARGON2, PASSWORD } from "./helpers";

/** In-memory stand-in for services/backup + @clip-wallet/backup-client (the real pair is tested end to end in services/backup). */
function fakeBackupServer() {
  const blobs = new Map<string, { blob: Uint8Array; credentialId: string; rpId: string | null; createdAt: number }>();
  let n = 0;
  const factory = (session: { token: string; expiresAt: number } | null): BackupClientLike => {
    const c: BackupClientLike = {
      session,
      get signedIn() {
        return !!c.session;
      },
      startSignIn: async (email) => ({ email, verifier: "v".repeat(43), startedAt: Date.now() }),
      completeSignIn: async (_link, pending) => {
        if (pending.verifier !== "v".repeat(43)) throw new Error("bad verifier");
        c.session = { token: "t".repeat(43), expiresAt: Date.now() + 60_000 };
      },
      signOut: async () => {
        c.session = null;
      },
      list: async () => [...blobs.entries()].map(([id, b]) => ({ id, createdAt: b.createdAt, credentialId: b.credentialId, rpId: b.rpId })),
      upload: async (blob, meta) => {
        const id = `b${++n}`;
        blobs.set(id, { blob, ...meta, createdAt: Date.now() });
        return { id };
      },
      download: async (id) => {
        const b = blobs.get(id)!;
        return { blob: b.blob, meta: { id, createdAt: b.createdAt, credentialId: b.credentialId, rpId: b.rpId } };
      },
      remove: async (id) => {
        blobs.delete(id);
      },
    };
    return c;
  };
  return { blobs, factory };
}

/** A real ClipVault, built the way the background builds it (tests may not import the vault directly). */
function newVault(): ClipVault {
  const deps = createDependencies({ kv: new MemoryKV(), mocks: true, config, iconUrl: "x", currency: async () => "USD", vaultOptions: FAST_ARGON2 });
  return deps.vault as unknown as ClipVault;
}

const META = { rpId: "wallet.example", rpName: "Clip", mode: "web-bridge" as const, bridgeUrl: "https://wallet.example/passkey" };
/** Stand-in PRF output: fixed test bytes (what an authenticator would return for BACKUP_PRF_INPUT). Not a key. */
const PRF = new Uint8Array(32).fill(0x5a);

function setup(server = fakeBackupServer(), families: Family[] = ["evm", "solana"]) {
  const vault = newVault();
  const kv = new MemoryKV();
  const ceremonies = new PasskeyCeremonies(() => META);
  const changed = vi.fn();
  const onRestored = vi.fn(async () => undefined);
  const svc = new PlatformService({ vault, kv, ceremonies, ceremonyMeta: () => META, backup: server.factory, families: () => families, changed, onRestored });
  return { vault, kv, ceremonies, svc, server, changed, onRestored };
}

async function signIn(s: ReturnType<typeof setup>) {
  await s.svc.handle({ type: "backupStartSignIn", email: "me@example.com" });
  expect((await s.svc.backupStatus()).pendingEmail).toBe("me@example.com");
  await s.svc.handle({ type: "backupCompleteSignIn", link: "https://wallet.example/#token=x" });
}

describe("passkey backup → restore on a new device (real vault crypto)", () => {
  it("backs up without the phrase leaving the vault, restores the same wallet elsewhere", async () => {
    const a = setup();
    await a.vault.create(PASSWORD);
    await signIn(a);
    expect(await a.svc.backupStatus()).toMatchObject({ signedIn: true, email: "me@example.com", backups: [] });

    const ceremony = (await a.svc.handle({ type: "passkeyBackupBegin", password: PASSWORD })) as { id: string; op: string; prfInput: string; rpId: string };
    expect(ceremony).toMatchObject({ op: "enroll", rpId: "wallet.example" });
    await a.ceremonies.finish(ceremony.id, { credentialId: b64url(new Uint8Array([1, 2, 3])), prfOutput: b64url(PRF) });
    const [stored] = [...a.server.blobs.values()];
    expect(stored).toMatchObject({ credentialId: "AQID", rpId: "wallet.example" });
    expect(new TextDecoder().decode(stored!.blob.subarray(0, 4))).toBe("CLPB");

    // New device: empty vault, same backup service, same synced passkey.
    const b = setup(a.server);
    await signIn(b);
    const id = (await b.svc.backupStatus()).backups[0]!.id;
    const rc = (await b.svc.handle({ type: "passkeyRestoreBegin", backupId: id, password: "new device pw 99" })) as { id: string; op: string; credentialId: string };
    expect(rc).toMatchObject({ op: "unlock", credentialId: "AQID" });
    await b.ceremonies.finish(rc.id, { credentialId: "AQID", prfOutput: b64url(PRF) });
    expect(await b.vault.status()).toBe("unlocked");
    expect(b.onRestored).toHaveBeenCalled();
    expect((await b.vault.deriveAccount("evm", 0)).address).toBe((await a.vault.deriveAccount("evm", 0)).address);
  });

  it("the wrong passkey can't restore, and the vault stays empty", async () => {
    const a = setup();
    await a.vault.create(PASSWORD);
    await signIn(a);
    const c = (await a.svc.handle({ type: "passkeyBackupBegin", password: PASSWORD })) as { id: string };
    await a.ceremonies.finish(c.id, { credentialId: "AQID", prfOutput: b64url(PRF) });
    const b = setup(a.server);
    await signIn(b);
    const rc = (await b.svc.handle({ type: "passkeyRestoreBegin", backupId: "b1", password: "new device pw 99" })) as { id: string };
    await expect(b.ceremonies.finish(rc.id, { credentialId: "AQID", prfOutput: b64url(new Uint8Array(32).fill(1)) })).rejects.toMatchObject({ code: "backup/wrong-passkey" });
    expect(await b.vault.status()).toBe("empty");
  });

  it("wrong password on backup is refused by the vault and nothing is uploaded", async () => {
    const a = setup();
    await a.vault.create(PASSWORD);
    await signIn(a);
    const c = (await a.svc.handle({ type: "passkeyBackupBegin", password: "wrong password!" })) as { id: string };
    await expect(a.ceremonies.finish(c.id, { credentialId: "AQID", prfOutput: b64url(PRF) })).rejects.toBeTruthy();
    expect(a.server.blobs.size).toBe(0);
  });

  it("refuses to restore over an existing wallet, or with a passkey for another RP", async () => {
    const a = setup();
    await a.vault.create(PASSWORD);
    await signIn(a);
    await expect(a.svc.handle({ type: "passkeyRestoreBegin", backupId: "b1", password: "x".repeat(10) })).rejects.toMatchObject({ code: "backup/vault-not-empty" });

    const server = fakeBackupServer();
    server.blobs.set("b9", { blob: new Uint8Array(93), credentialId: "AQID", rpId: "other.example", createdAt: 1 });
    const b = setup(server);
    await signIn(b);
    await expect(b.svc.handle({ type: "passkeyRestoreBegin", backupId: "b9", password: "x".repeat(10) })).rejects.toMatchObject({ code: "backup/rp-mismatch" });
  });

  it("no backup service in this build → unavailable, never throws on status", async () => {
    const vault = newVault();
    const svc = new PlatformService({ vault, kv: new MemoryKV(), ceremonies: new PasskeyCeremonies(() => META), ceremonyMeta: () => META, backup: null, families: () => ["evm"], changed: () => undefined });
    expect(await svc.backupStatus()).toEqual({ signedIn: false, backups: [], available: false });
    await expect(svc.handle({ type: "backupStartSignIn", email: "a@b.cd" })).rejects.toMatchObject({ code: "backup/unavailable" });
  });

  it("expired pending sign-in can't be completed", async () => {
    let t = 1_000_000;
    const vault = newVault();
    const kv = new MemoryKV();
    const svc = new PlatformService({ vault, kv, ceremonies: new PasskeyCeremonies(() => META), ceremonyMeta: () => META, backup: fakeBackupServer().factory, families: () => ["evm"], changed: () => undefined, now: () => t });
    await kv.set(PLATFORM_KEYS.backupPending, { email: "a@b.cd", verifier: "v".repeat(43), startedAt: t });
    t += 16 * 60_000;
    await expect(svc.handle({ type: "backupCompleteSignIn", link: "x" })).rejects.toMatchObject({ code: "backup/link-invalid" });
  });
});

describe("accounts", () => {
  it("lists account 0 per family, adds more, renames, and keeps per-site choices", async () => {
    const s = setup();
    await s.vault.create(PASSWORD);
    expect((await s.svc.listAccounts()).map((a) => [a.id, a.label])).toEqual([
      ["evm:0", "Account 1"],
      ["solana:0", "Account 1"],
    ]);
    const added = await s.svc.addAccount("evm");
    expect(added).toMatchObject({ id: "evm:1", label: "Account 2" });
    expect(added.address).toBe((await s.vault.deriveAccount("evm", 1)).address);
    await s.svc.handle({ type: "renameAccount", id: "evm:1", label: "  Savings\u0007 " });
    expect((await s.svc.listAccounts()).find((a) => a.id === "evm:1")!.label).toBe("Savings");

    await s.svc.handle({ type: "setActiveAccount", family: "evm", accountId: "evm:1", origin: "https://app.uniswap.org/swap" });
    expect((await s.svc.activeAccount("evm", "https://app.uniswap.org")).index).toBe(1);
    expect((await s.svc.activeAccount("evm", "https://other.example")).index).toBe(0);
    expect(await s.svc.handle({ type: "getActiveAccounts", origin: "https://app.uniswap.org" })).toEqual({ defaults: {}, forOrigin: { evm: "evm:1" } });

    await s.svc.handle({ type: "setActiveAccount", family: "evm", accountId: "evm:1" });
    expect((await s.svc.activeAccount("evm", "https://other.example")).index).toBe(1);
    await s.svc.handle({ type: "setActiveAccount", family: "evm", accountId: null, origin: "https://app.uniswap.org" });
    expect(await s.svc.handle({ type: "getActiveAccounts", origin: "https://app.uniswap.org" })).toEqual({ defaults: { evm: "evm:1" }, forOrigin: {} });
    expect(s.changed).toHaveBeenCalled();
  });

  it("refuses unknown accounts, other families, and too many", async () => {
    const s = setup();
    await s.vault.create(PASSWORD);
    await expect(s.svc.handle({ type: "setActiveAccount", family: "evm", accountId: "evm:5" })).rejects.toMatchObject({ code: "accounts/unknown" });
    await expect(s.svc.handle({ type: "setActiveAccount", family: "evm", accountId: "solana:0" })).rejects.toMatchObject({ code: "accounts/unknown" });
    await expect(s.svc.handle({ type: "renameAccount", id: "evm:3", label: "x" })).rejects.toMatchObject({ code: "accounts/unknown" });
    await expect(s.svc.addAccount("bitcoin")).rejects.toMatchObject({ code: "family-unavailable" });
    for (let i = 1; i < 20; i++) await s.svc.addAccount("solana");
    await expect(s.svc.addAccount("solana")).rejects.toMatchObject({ code: "accounts/limit" });
  });

  it("uses vault.addAccount when the vault-v2 stream provides it", async () => {
    const s = setup();
    await s.vault.create(PASSWORD);
    const addAccount = vi.fn(async (family: Family) => s.vault.deriveAccount(family, 1));
    Object.assign(s.vault, { addAccount });
    await s.svc.addAccount("evm");
    expect(addAccount).toHaveBeenCalledWith("evm");
  });

  it("needs an unlocked wallet", async () => {
    const s = setup();
    await expect(s.svc.listAccounts()).rejects.toMatchObject({ code: "vault/locked" });
    await expect(s.svc.handle({ type: "markPhraseBackedUp" })).rejects.toMatchObject({ code: "vault/locked" });
  });
});

