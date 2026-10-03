/** Encrypted app data (contacts): round trip, namespace separation, tamper detection, lock state. */
import { describe, expect, it } from "vitest";
import { ClipVault, MemoryStorage } from "../src/index.js";
import { openAppData, sealAppData } from "../src/appdata.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct horse battery staple";
const FAST_ARGON2 = { memoryKiB: 256, iterations: 1, parallelism: 1 };

async function vault() {
  const v = new ClipVault({ storage: new MemoryStorage(), argon2: FAST_ARGON2, autoLockMs: 0 });
  await v.importPhrase(ABANDON, PW);
  return v;
}

describe("app data", () => {
  it("round-trips and uses a fresh nonce every time", async () => {
    const v = await vault();
    const a = await v.sealAppData("contacts", '{"alex":1}');
    const b = await v.sealAppData("contacts", '{"alex":1}');
    expect(a.ct).not.toBe(b.ct);
    expect(JSON.stringify(a)).not.toContain("alex");
    expect(await v.openAppData("contacts", a)).toBe('{"alex":1}');
  });

  it("another namespace's box doesn't open", async () => {
    const v = await vault();
    const box = await v.sealAppData("contacts", "x");
    await expect(v.openAppData("notes", box)).rejects.toMatchObject({ code: "vault/app-data-unreadable" });
  });

  it("tampering is detected", async () => {
    const v = await vault();
    const box = await v.sealAppData("contacts", "hello");
    const ct = Buffer.from(box.ct, "base64");
    ct[0]! ^= 1;
    await expect(v.openAppData("contacts", { ...box, ct: ct.toString("base64") })).rejects.toMatchObject({ code: "vault/app-data-unreadable" });
  });

  it("needs the wallet unlocked; reopens after unlock (key tied to the seed, not the password)", async () => {
    const v = await vault();
    const box = await v.sealAppData("contacts", "kept");
    await v.lock();
    await expect(v.sealAppData("contacts", "x")).rejects.toMatchObject({ code: "vault/locked" });
    await v.unlock(PW);
    expect(await v.openAppData("contacts", box)).toBe("kept");
  });

  it("rejects bad namespaces", () => {
    const seed = new Uint8Array(64).fill(7);
    expect(() => sealAppData(seed, "Contacts", "x")).toThrow(RangeError);
    expect(() => sealAppData(seed, "", "x")).toThrow(RangeError);
    expect(openAppData(seed, "c", sealAppData(seed, "c", "ok"))).toBe("ok");
  });
});
