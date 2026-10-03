import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { MapKV } from "./helpers.js";
import { ContactBook, addressKey, encryptedContactStore, initialOf, plainContactStore, type AppDataCipher } from "../src/index.js";

const ALICE = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const SOL = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";

/** Reversible stand-in for the vault's sealing (the real one is tested in packages/vault). */
const fakeCipher: AppDataCipher = {
  seal: async (p) => ({ nonce: "n", ct: Buffer.from(p).toString("base64").split("").reverse().join("") }),
  open: async (b) => Buffer.from(b.ct.split("").reverse().join(""), "base64").toString(),
};

const validators = {
  evm: (a: string) => isAddress(a),
  solana: (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
  hedera: (a: string) => /^0\.0\.\d+(-[a-z]{5})?$/.test(a) || isAddress(a),
};

let n = 0;
function book(store = plainContactStore(new MapKV())) {
  return new ContactBook({ store, validators, now: () => 1000, randomId: () => `c${++n}` });
}

describe("ContactBook", () => {
  it("adds, validates per family, and sorts by name", async () => {
    const b = book();
    await b.add({ name: "  Zoe ", addresses: [{ family: "evm", address: ALICE }] });
    const alex = await b.add({ name: "Alex", addresses: [{ family: "solana", address: SOL, label: "Phantom" }], notes: "Met at ETHDenver", handle: "@Alex" });
    expect(alex).toMatchObject({ name: "Alex", handle: "alex", notes: "Met at ETHDenver" });
    expect((await b.list()).map((c) => c.name)).toEqual(["Alex", "Zoe"]);
    await expect(b.add({ name: "Bad", addresses: [{ family: "evm", address: "0x123" }] })).rejects.toMatchObject({ code: "contacts/bad-address" });
    await expect(b.add({ name: "Btc", addresses: [{ family: "bitcoin", address: "tb1q" }] })).rejects.toMatchObject({ code: "contacts/family" });
    await expect(b.add({ name: "", addresses: [{ family: "evm", address: ALICE }] })).rejects.toMatchObject({ code: "contacts/name" });
    await expect(b.add({ name: "No address", addresses: [] })).rejects.toMatchObject({ code: "contacts/no-address" });
  });

  it("an address belongs to one contact; names are unique", async () => {
    const b = book();
    await b.add({ name: "Alex", addresses: [{ family: "evm", address: ALICE }] });
    await expect(b.add({ name: "Sam", addresses: [{ family: "evm", address: ALICE.toLowerCase() }] })).rejects.toMatchObject({ code: "contacts/address-taken" });
    await expect(b.add({ name: "alex", addresses: [{ family: "solana", address: SOL }] })).rejects.toMatchObject({ code: "contacts/duplicate-name" });
  });

  it("strips control and bidi characters from names", async () => {
    const b = book();
    const c = await b.add({ name: "Al‮ex​", addresses: [{ family: "evm", address: ALICE }] });
    expect(c.name).toBe("Alex");
  });

  it("updates and removes", async () => {
    const b = book();
    const c = await b.add({ name: "Alex", addresses: [{ family: "evm", address: ALICE }], notes: "x" });
    const u = await b.update(c.id, { name: "Alex B", addresses: [{ family: "evm", address: ALICE }, { family: "solana", address: SOL }] });
    expect(u.notes).toBeUndefined();
    expect(u.addresses).toHaveLength(2);
    await b.remove(c.id);
    expect(await b.list()).toEqual([]);
    await expect(b.update(c.id, { name: "x", addresses: [{ family: "evm", address: ALICE }] })).rejects.toMatchObject({ code: "contacts/not-found" });
  });

  it("searches by name word, accents, handle and address, filtered by family", async () => {
    const b = book();
    await b.add({ name: "José Álvarez", addresses: [{ family: "evm", address: ALICE }], handle: "jose" });
    await b.add({ name: "Sam", addresses: [{ family: "solana", address: SOL }] });
    expect((await b.search("alv")).map((m) => m.contact.name)).toEqual(["José Álvarez"]);
    expect((await b.search("@jos")).map((m) => m.contact.name)).toEqual(["José Álvarez"]);
    expect((await b.search("0x9858")).map((m) => m.contact.name)).toEqual(["José Álvarez"]);
    expect((await b.search("YWrH")).map((m) => m.contact.name)).toEqual(["Sam"]);
    expect((await b.search("", "solana")).map((m) => m.contact.name)).toEqual(["Sam"]);
    expect(await b.search("sam", "evm")).toEqual([]);
  });

  it("looks up exact addresses with each family's case rules", async () => {
    const b = book();
    await b.add({ name: "Alex", addresses: [{ family: "evm", address: ALICE }, { family: "hedera", address: "0.0.1234" }] });
    expect((await b.byAddress(ALICE.toLowerCase()))?.contact.name).toBe("Alex");
    expect((await b.byAddress("0.0.1234-abcde", "hedera"))?.contact.name).toBe("Alex");
    expect(await b.byAddress(ALICE, "solana")).toBeNull();
    expect(addressKey("solana", SOL)).toBe(SOL);
    expect(addressKey("solana", SOL.toLowerCase())).not.toBe(SOL);
  });

  it("flags look-alike addresses (address poisoning) but not the real one", async () => {
    const b = book();
    await b.add({ name: "Alex", addresses: [{ family: "evm", address: ALICE }] });
    const poisoned = "0x9858aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaDa94";
    const hits = await b.lookalikes(poisoned, "evm");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ contact: { name: "Alex" }, samePrefix: 4, sameSuffix: 4 });
    expect(await b.lookalikes(ALICE)).toEqual([]);
    expect(await b.lookalikes("0x1234567890AbcdEF1234567890aBcdef12345678")).toEqual([]);
  });

  it("encrypted store: nothing readable at rest, reads back, migrates a plain list", async () => {
    const kv = new MapKV();
    await plainContactStore(kv).write([{ id: "old", name: "Old", addresses: [{ family: "evm", address: ALICE }], createdAt: 1, updatedAt: 1 }]);
    const b = book(encryptedContactStore(kv, fakeCipher));
    expect((await b.list()).map((c) => c.name)).toEqual(["Old"]);
    await b.add({ name: "Alex", addresses: [{ family: "solana", address: SOL }] });
    expect(JSON.stringify([...kv.data.values()])).not.toContain("Alex");
    const again = book(encryptedContactStore(kv, fakeCipher));
    expect((await again.list()).map((c) => c.name)).toEqual(["Alex", "Old"]);
  });

  it("a store that can't be opened gives a plain error; malformed rows are dropped", async () => {
    const broken = book(encryptedContactStore(new MapKV(), { seal: fakeCipher.seal, open: async () => Promise.reject(new Error("bad tag")) }));
    await broken.add({ name: "A", addresses: [{ family: "evm", address: ALICE }] }).catch(() => undefined);
    const kv = new MapKV();
    await kv.set("clip/social/contacts", { v: 1, contacts: [{ id: 1 }, { id: "x", name: "Ok", addresses: [{ family: "nope", address: "a" }] }, { id: "y", name: "Fine", addresses: [{ family: "evm", address: ALICE }] }] });
    expect((await book(plainContactStore(kv)).list()).map((c) => c.name)).toEqual(["Fine"]);
    const kv2 = new MapKV();
    await kv2.set("clip/social/contacts", { v: 1, box: { nonce: "n", ct: "zz" } });
    await expect(book(encryptedContactStore(kv2, { ...fakeCipher, open: async () => Promise.reject(new Error("tag")) })).list()).rejects.toMatchObject({ code: "contacts/unreadable" });
  });

  it("avatar initials work across scripts", () => {
    expect(initialOf("alex")).toBe("A");
    expect(initialOf("élodie")).toBe("É");
    expect(initialOf("山田")).toBe("山");
    expect(initialOf("👩‍💻 dev")).toBe("👩‍💻");
    expect(initialOf("  ")).toBe("?");
  });
});
