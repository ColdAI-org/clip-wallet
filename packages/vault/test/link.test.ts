/**
 * Clip Link key material with REAL crypto (the only place in the repo where it runs end to end):
 * the sync key (KAT on the public BIP-39 vector, re-derived independently with node:crypto HKDF), its domain-
 * restricted signer, X25519 pairing, moving a wallet between two vaults over @clip-wallet/link, and a man in the
 * middle on the relay.
 */
import { hkdfSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { mnemonicToSeed } from "@scure/bip39";
import {
  MemorySyncStore,
  SyncEngine,
  b64url,
  contextFromOffer,
  handleSync,
  memoryChannelPair,
  newOffer,
  pair,
  receiveWallet,
  sendWallet,
  type LinkKV,
} from "@clip-wallet/link";
import { sha256 } from "@noble/hashes/sha2.js";
import { ClipVault, MemoryStorage } from "../src/index.js";

// Public BIP-39 test vector (official). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct horse battery staple";
const FAST = { memoryKiB: 256, iterations: 1, parallelism: 1 };

async function vault(phrase: string | null = ABANDON, clock?: { now(): number }) {
  const v = new ClipVault({ storage: new MemoryStorage(), argon2: FAST, autoLockMs: 0, ...(clock ? { clock } : {}) });
  if (phrase) await v.importPhrase(phrase, PW);
  return v;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("sync keys (label clip/sync/v1)", () => {
  it("known answer for the public vector, re-derived independently", async () => {
    const v = await vault();
    const k = await v.syncKeys();
    expect(hex(k.publicKey)).toBe("bd766f08edcbfc610016164643a76c7150b4757b8e27cd7690ad61a3e0f6e60f");
    expect(k.space).toBe("bcf47c055d6aa967ebe9fb1d4ff47d866aa78e279d144878b93beb29fbb4885e");
    const seed = await mnemonicToSeed(ABANDON, "");
    const root = new Uint8Array(hkdfSync("sha256", seed, "clip-wallet/vault/sync", "clip/sync/v1", 32));
    const sub = (info: string) => new Uint8Array(hkdfSync("sha256", root, new Uint8Array(0), `clip/sync/v1/${info}`, 32));
    expect(hex(ed25519.getPublicKey(sub("auth-ed25519")))).toBe(hex(k.publicKey));
    expect(hex(k.dataKey)).toBe(hex(sub("data-xchacha20")));
    expect(hex(k.idKey)).toBe(hex(sub("record-id")));
    expect(hex(sha256(k.publicKey))).toBe(k.space);
  });

  it("signs sync requests only, and only while unlocked", async () => {
    const v = await vault();
    const k = await v.syncKeys();
    const msg = new TextEncoder().encode("clip-sync-v1\nGET\n/v1/sync/changes?since=0\n1\nn\nh");
    expect(ed25519.verify(await k.sign(msg), msg, k.publicKey)).toBe(true);
    await expect(k.sign(new TextEncoder().encode("anything else"))).rejects.toThrow(RangeError);
    await v.lock();
    await expect(k.sign(msg)).rejects.toMatchObject({ code: "vault/locked" });
    await expect(v.syncKeys()).rejects.toMatchObject({ code: "vault/locked" });
  });

  it("another phrase gives another sync key", async () => {
    const other = await vault("legal winner thank year wave sausage worth useful legal winner thank yellow");
    expect(hex((await other.syncKeys()).publicKey)).not.toBe("bd766f08edcbfc610016164643a76c7150b4757b8e27cd7690ad61a3e0f6e60f");
  });

  it("settings sync with real Ed25519 auth: two devices of one wallet, server verifies with ed25519.verify", async () => {
    const store = new MemorySyncStore();
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      const r = await handleSync(
        { method: init?.method ?? "GET", pathAndQuery: u.pathname + u.search, authorization: new Headers(init?.headers).get("authorization"), body: (init?.body as string) ?? "" },
        { store, verify: (p, m, s) => ed25519.verify(s, m, p) },
      );
      return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
    const kv = (): LinkKV => {
      const m = new Map<string, unknown>();
      return { get: async (k) => m.get(k) as never, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k) };
    };
    const [a, b] = [await vault(), await vault()];
    const ea = new SyncEngine({ baseUrl: "https://s.test", fetch: f, keys: () => a.syncKeys(), kv: kv(), device: "A" });
    const eb = new SyncEngine({ baseUrl: "https://s.test", fetch: f, keys: () => b.syncKeys(), kv: kv(), device: "B" });
    await ea.write("prefs", "locale", "ko");
    await ea.sync();
    await eb.sync();
    expect((await eb.values("prefs"))[0]!.v).toBe("ko");
    // The server holds ciphertext only. (Base64url ciphertext can contain the letters "ko" by chance; it can never
    // contain a quoted JSON value or the key name.)
    const stored = JSON.stringify([...store.spaces.values()].map((s) => [...s.rows.values()]));
    expect(stored).not.toContain('"ko"');
    expect(stored).not.toContain("locale");
  });
});

describe("pairing keys (X25519)", () => {
  it("both sides derive the same link secret; degenerate peer keys are refused", async () => {
    const a = (await vault(null)).pairingKey();
    const b = (await vault(null)).pairingKey();
    const th = new Uint8Array(32).fill(1);
    expect(hex(await a.agree(b.publicKey, th))).toBe(hex(await b.agree(a.publicKey, th)));
    expect(hex(await a.agree(b.publicKey, th))).not.toBe(hex(await a.agree(b.publicKey, new Uint8Array(32).fill(2))));
    await expect(a.agree(new Uint8Array(32), th)).rejects.toThrow(); // all-zero point → all-zero secret
    a.destroy();
    await expect(a.agree(b.publicKey, th)).rejects.toThrow(/expired/);
  });

  it("forgets keys after 15 minutes", async () => {
    let t = 1_000;
    const v = await vault(null, { now: () => t });
    const k = v.pairingKey();
    const peer = (await vault(null)).pairingKey();
    t += 15 * 60_000 + 1;
    await expect(k.agree(peer.publicKey, new Uint8Array(32))).rejects.toThrow(/expired/);
  });
});

async function pairVaults(source: ClipVault, target: ClipVault, tap?: Parameters<typeof memoryChannelPair>[0]) {
  // The new device shows the QR (initiator); the source scans it.
  const ki = target.pairingKey();
  const kr = source.pairingKey();
  const offer = newOffer({ key: ki, purpose: "device-add", relay: "https://relay.test", name: "New laptop" });
  const [chT, chS] = memoryChannelPair(tap);
  const [pt, ps] = await Promise.all([
    pair({ channel: chT, role: "i", key: ki, ctx: contextFromOffer(offer, "i"), me: { name: "New laptop", platform: "extension" }, timeoutMs: 2000 }),
    pair({ channel: chS, role: "r", key: kr, ctx: contextFromOffer(offer, "r"), me: { name: "Phone", platform: "mobile" }, timeoutMs: 2000 }),
  ]);
  return { pt, ps, chT, chS };
}

describe("add this wallet to another device", () => {
  it("moves the wallet: same accounts on the new device, under its own password", async () => {
    const source = await vault();
    const target = await vault(null);
    const { pt, ps, chT, chS } = await pairVaults(source, target);
    expect(pt.sas).toBe(ps.sas);
    const [paT, paS] = await Promise.all([pt.confirm(), ps.confirm()]);
    await expect(sendWallet({ channel: chS, paired: paS, vault: source, password: "not the password" })).rejects.toMatchObject({ code: "vault/wrong-password" });
    await Promise.all([sendWallet({ channel: chS, paired: paS, vault: source, password: PW }), receiveWallet({ channel: chT, paired: paT, vault: target, password: "new device password" })]);
    expect(await target.status()).toBe("unlocked");
    expect((await target.deriveAccount("evm", 0)).address).toBe((await source.deriveAccount("evm", 0)).address);
    await target.lock();
    await target.unlock("new device password");
  });

  it("MITM on the relay with real X25519: codes differ, confirmation fails, the wallet is never exported", async () => {
    const source = await vault();
    const target = await vault(null);
    const mallory = (await vault(null)).pairingKey();
    const spy = vi.spyOn(source, "exportToDevice");
    const tap = (from: "a" | "b", frame: string) => {
      const m = JSON.parse(frame);
      if (from === "b" && m.t === "hello") m.commit = b64url(sha256(mallory.publicKey));
      if (from === "b" && m.t === "reveal") m.k = b64url(mallory.publicKey);
      return JSON.stringify(m);
    };
    const { pt, ps } = await pairVaults(source, target, tap);
    expect(pt.sas).not.toBe(ps.sas);
    const r = await Promise.allSettled([pt.confirm(), ps.confirm()]);
    expect(r.map((x) => x.status)).toEqual(["rejected", "rejected"]);
    expect(spy).not.toHaveBeenCalled();
    expect(await target.status()).toBe("empty");
  });

  it("a box for another pairing can't be imported", async () => {
    const source = await vault();
    const target = await vault(null);
    const { pt, ps } = await pairVaults(source, target);
    const [paT, paS] = await Promise.all([pt.confirm(), ps.confirm()]);
    const box = await source.exportToDevice(PW, paS.pairingKeyId, paS.peerPublicKey, paS.transcriptHash);
    await expect(target.importFromDevice(paT.pairingKeyId, paT.peerPublicKey, new Uint8Array(32), box, "new pw 123")).rejects.toMatchObject({ code: "vault/transfer-failed" });
    expect(await target.status()).toBe("empty");
    await target.importFromDevice(paT.pairingKeyId, paT.peerPublicKey, paT.transcriptHash, box, "new pw 123");
    expect(await target.status()).toBe("unlocked");
    // A vault that already has a wallet refuses.
    await expect(source.importFromDevice(paS.pairingKeyId, paS.peerPublicKey, paS.transcriptHash, box, "x".repeat(10))).rejects.toMatchObject({ code: "vault/exists" });
  });
});
