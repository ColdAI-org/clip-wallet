/** Settings sync end to end against the server core (in memory), with two and three devices. */
import { describe, expect, it } from "vitest";
import { SyncEngine, type LinkKV, type SyncSource } from "../src/sync/client.js";
import { MemorySyncStore, handleSync, SyncHttpError } from "../src/sync/server.js";
import { SYNC_LIMITS, decryptRecord, formatAuth, recordId, signedMessage } from "../src/sync/protocol.js";
import { walletSources, SYNC_KV, contactsSource } from "../src/sync/sources.js";
import { b64url } from "../src/bytes.js";
import { fakeSyncKeys, fakeVerify } from "./helpers.js";

class KV implements LinkKV {
  readonly m = new Map<string, unknown>();
  async get<T>(k: string) {
    const v = this.m.get(k);
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
  }
  async set<T>(k: string, v: T) {
    this.m.set(k, JSON.parse(JSON.stringify(v)));
  }
  async remove(k: string) {
    this.m.delete(k);
  }
}

function server(now: () => number) {
  const store = new MemorySyncStore(now);
  const wire: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const body = typeof init?.body === "string" ? init.body : "";
    wire.push(body);
    try {
      const r = await handleSync(
        { method: init?.method ?? "GET", pathAndQuery: u.pathname + u.search, authorization: new Headers(init?.headers).get("authorization"), body },
        { store, verify: fakeVerify, now },
      );
      const text = r.body === null ? null : JSON.stringify(r.body);
      if (text) wire.push(text);
      return new Response(text, { status: r.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      if (e instanceof SyncHttpError) return new Response(JSON.stringify({ error: e.code }), { status: e.status });
      throw e;
    }
  }) as typeof fetch;
  return { store, f, wire };
}

function device(name: string, f: typeof fetch, clock: { t: number }, wallet = "wallet-a") {
  const kv = new KV();
  const keys = fakeSyncKeys(wallet);
  const e = new SyncEngine({ baseUrl: "https://sync.test", fetch: f, keys: async () => keys, kv, device: name, now: () => clock.t });
  return { kv, e, keys };
}

describe("settings sync", () => {
  it("syncs a write from one device to another", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    const b = device("B", s.f, clock);
    await a.e.write("contacts", "c1", { id: "c1", name: "Alex Rivera" });
    await a.e.sync();
    const r = await b.e.sync();
    expect(r.changed.map((x) => x.v)).toEqual([{ id: "c1", name: "Alex Rivera" }]);
    expect((await b.e.values("contacts")).map((x) => x.v)).toEqual([{ id: "c1", name: "Alex Rivera" }]);
  });

  it("the server never sees plaintext: not in requests, responses or storage", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    await a.e.write("contacts", "alex", { id: "alex", name: "Alex Rivera", addresses: [{ family: "evm", address: "0xFEEDFACE00000000000000000000000000000001" }] });
    await a.e.write("prefs", "locale", "pt-BR");
    await a.e.write("bookmarks", "b1", { id: "b1", url: "https://app.uniswap.org/swap", title: "Uniswap", addedAt: 1 });
    await a.e.sync();
    const everything = JSON.stringify([...s.store.spaces.values()].map((v) => [...v.rows.values()])) + s.wire.join("\n");
    for (const secret of ["Alex Rivera", "alex", "FEEDFACE", "pt-BR", "uniswap", "contacts", "locale", "bookmarks", "prefs"]) {
      expect(everything.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    // Opaque ids: the record id is an HMAC, not the setting's name.
    expect(recordId(a.keys.idKey, "prefs", "locale")).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("concurrent edits converge on both devices (later write wins, nothing diverges)", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    const b = device("B", s.f, clock);
    await a.e.write("prefs", "displayCurrency", "USD");
    await a.e.sync();
    await b.e.sync();
    // Both edit offline; B's edit is later.
    clock.t += 1000;
    await a.e.write("prefs", "displayCurrency", "EUR");
    clock.t += 1000;
    await b.e.write("prefs", "displayCurrency", "JPY");
    await a.e.sync(); // A pushes EUR
    await b.e.sync(); // B's push conflicts (CAS), merges: JPY is later
    await a.e.sync();
    const va = (await a.e.values("prefs")).find((r) => r.id === "displayCurrency")!;
    const vb = (await b.e.values("prefs")).find((r) => r.id === "displayCurrency")!;
    expect(va.v).toBe("JPY");
    expect(vb.v).toBe("JPY");
    expect(va.clock).toEqual(vb.clock);
    expect(va.clock).toEqual({ A: 2, B: 1 });
  });

  it("a write that saw the other one wins even with an older clock time", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    const b = device("B", s.f, clock);
    await a.e.write("prefs", "locale", "de");
    await a.e.sync();
    await b.e.sync();
    clock.t -= 60_000; // B's clock is a minute behind, but it saw "de" before writing "fr"
    await b.e.write("prefs", "locale", "fr");
    await b.e.sync();
    await a.e.sync();
    expect((await a.e.values("prefs")).find((r) => r.id === "locale")!.v).toBe("fr");
  });

  it("deletions sync as tombstones", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    const b = device("B", s.f, clock);
    await a.e.write("hidden", "eip155:1|0xabc", true);
    await a.e.sync();
    await b.e.sync();
    clock.t += 10;
    await b.e.write("hidden", "eip155:1|0xabc", null);
    await b.e.sync();
    const r = await a.e.sync();
    expect(r.changed.map((x) => [x.id, x.v])).toEqual([["eip155:1|0xabc", null]]);
    expect(await a.e.values("hidden")).toEqual([]);
  });

  it("three devices converge after interleaved edits", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const ds = ["A", "B", "C"].map((n) => device(n, s.f, clock));
    for (let i = 0; i < 6; i++) {
      clock.t += 7;
      const d = ds[i % 3]!;
      await d.e.write("accounts", "label:evm:0", `Main ${i}`);
      if (i % 2) await d.e.sync();
    }
    for (let r = 0; r < 2; r++) for (const d of ds) await d.e.sync();
    const vals = await Promise.all(ds.map(async (d) => (await d.e.values("accounts"))[0]!.v));
    expect(new Set(vals).size).toBe(1);
    expect(vals[0]).toBe("Main 5");
  });

  it("another wallet's sync key can't read or overwrite (different space, AEAD-bound ids)", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock, "wallet-a");
    const x = device("X", s.f, clock, "wallet-x");
    await a.e.write("prefs", "locale", "de");
    await a.e.sync();
    const r = await x.e.sync();
    expect(r.pulled).toBe(0);
    // A record moved to another rid fails to decrypt (the rid is in the AEAD's associated data).
    const row = [...[...s.store.spaces.values()][0]!.rows.values()][0]!;
    expect(() => decryptRecord(a.keys.dataKey, "AAAAAAAAAAAAAAAAAAAAAA", row.ct)).toThrow();
  });

  it("the server refuses replays, stale timestamps, bad signatures and oversize records", async () => {
    const now = 1_800_000_000_000;
    const store = new MemorySyncStore(() => now);
    const keys = fakeSyncKeys();
    const req = async (method: string, path: string, body: string, ts = now, nonce = b64url(new Uint8Array(16).fill(1)), sign = true) => {
      const sig = sign ? await keys.sign(signedMessage(method, path, ts, nonce, body)) : new Uint8Array(64);
      return handleSync({ method, pathAndQuery: path, body, authorization: formatAuth({ pub: b64url(keys.publicKey), ts, nonce, sig: b64url(sig) }) }, { store, verify: fakeVerify, now: () => now });
    };
    await expect(req("GET", "/v1/sync/changes?since=0", "")).resolves.toMatchObject({ status: 200 });
    await expect(req("GET", "/v1/sync/changes?since=0", "")).rejects.toMatchObject({ code: "replay" });
    await expect(req("GET", "/v1/sync/changes?since=0", "", now - 6 * 60_000, b64url(new Uint8Array(16).fill(2)))).rejects.toMatchObject({ code: "clock-skew" });
    await expect(req("GET", "/v1/sync/changes?since=0", "", now, b64url(new Uint8Array(16).fill(3)), false)).rejects.toMatchObject({ status: 401 });
    // Signed path differs from requested path → signature fails.
    const sig = await keys.sign(signedMessage("GET", "/v1/sync/changes?since=0", now, b64url(new Uint8Array(16).fill(4)), ""));
    await expect(
      handleSync({ method: "DELETE", pathAndQuery: "/v1/sync", body: "", authorization: formatAuth({ pub: b64url(keys.publicKey), ts: now, nonce: b64url(new Uint8Array(16).fill(4)), sig: b64url(sig) }) }, { store, verify: fakeVerify, now: () => now }),
    ).rejects.toMatchObject({ status: 401 });
    const big = JSON.stringify({ records: [{ rid: "A".repeat(22), base: 0, ct: "A".repeat(SYNC_LIMITS.maxRecordCt + 1) }] });
    await expect(req("POST", "/v1/sync/push", big, now, b64url(new Uint8Array(16).fill(5)))).rejects.toMatchObject({ code: "record-too-large" });
    const many = JSON.stringify({ records: Array.from({ length: 101 }, (_, i) => ({ rid: `${String(i).padStart(22, "A")}`, base: 0, ct: "A".repeat(60) })) });
    await expect(req("POST", "/v1/sync/push", many, now, b64url(new Uint8Array(16).fill(6)))).rejects.toMatchObject({ code: "bad-request" });
  });

  it("wallet sources: a new device takes the server's settings first, then later edits flow both ways", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    const b = device("B", s.f, clock);
    await a.kv.set(SYNC_KV.prefs, { locale: "ja", displayCurrency: "JPY", advanced: true });
    await a.kv.set(SYNC_KV.accountLabels, { "evm:0": "Savings" });
    await a.kv.set(SYNC_KV.accountCounts, { evm: 3 });
    await a.kv.set(SYNC_KV.permissions, [{ id: "p1", origin: "https://app.uniswap.org", family: "evm" }]);
    await a.kv.set(SYNC_KV.hidden, ["eip155:11155111|0xdead"]);
    await a.kv.set(SYNC_KV.bookmarks, [{ id: "b1", url: "https://app.uniswap.org", title: "Uniswap", addedAt: 1 }]);
    let contactsA = [{ id: "c1", name: "Sam" }];
    let contactsB: { id: string; name: string }[] = [];
    const srcA: SyncSource[] = [...walletSources(a.kv), contactsSource({ read: async () => contactsA, write: async (l) => void (contactsA = l as never) })];
    const srcB: SyncSource[] = [...walletSources(b.kv), contactsSource({ read: async () => contactsB, write: async (l) => void (contactsB = l as never) })];
    await a.e.syncSources(srcA);
    // B already has defaults; they must not overwrite A's settings on first sync.
    await b.kv.set(SYNC_KV.prefs, { locale: "system", displayCurrency: "USD", advanced: false });
    await b.kv.set(SYNC_KV.accountCounts, { evm: 1 });
    clock.t += 5000;
    await b.e.syncSources(srcB);
    expect(await b.kv.get(SYNC_KV.prefs)).toEqual({ locale: "ja", displayCurrency: "JPY", advanced: false });
    expect(await b.kv.get(SYNC_KV.accountLabels)).toEqual({ "evm:0": "Savings" });
    expect(await b.kv.get(SYNC_KV.accountCounts)).toEqual({ evm: 3 });
    expect(await b.kv.get(SYNC_KV.permissions)).toEqual([{ id: "p1", origin: "https://app.uniswap.org", family: "evm" }]);
    expect(await b.kv.get(SYNC_KV.hidden)).toEqual(["eip155:11155111|0xdead"]);
    expect(contactsB).toEqual([{ id: "c1", name: "Sam" }]);
    // Later: B renames an account and removes the bookmark; A gets both.
    clock.t += 5000;
    await b.kv.set(SYNC_KV.accountLabels, { "evm:0": "Spending" });
    await b.kv.set(SYNC_KV.bookmarks, []);
    await b.e.syncSources(srcB);
    await a.e.syncSources(srcA);
    expect(await a.kv.get(SYNC_KV.accountLabels)).toEqual({ "evm:0": "Spending" });
    expect(await a.kv.get(SYNC_KV.bookmarks)).toEqual([]);
    // Advanced mode and other local-only prefs never synced.
    expect((await a.kv.get<{ advanced: boolean }>(SYNC_KV.prefs))!.advanced).toBe(true);
  });

  it("the local replica is sealed at rest", async () => {
    const clock = { t: 1_800_000_000_000 };
    const s = server(() => clock.t);
    const a = device("A", s.f, clock);
    await a.e.write("contacts", "c1", { id: "c1", name: "Alex Rivera" });
    expect(JSON.stringify([...a.kv.m.values()])).not.toContain("Alex");
  });
});
