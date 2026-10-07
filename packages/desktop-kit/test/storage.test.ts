/** Vault file wrapping with the OS store (safeStorage), app KV, Touch ID PRF, the Ledger HID relay. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { MemoryKV } from "@clip-wallet/engine";
import { FileKV, SafeVaultStorage, protectionOf, type SafeStorageLike } from "../src/main/storage";
import { TouchIdPrf } from "../src/main/biometric";
import { HidRelay, ledgerDevices } from "../src/main/hid";
import type { HidJob } from "../src/shared/ipc";

/** A stand-in OS store: XOR with a key the "OS" holds (enough to tell wrapped from unwrapped). */
function fakeSafe(available = true, backend = "gnome_libsecret"): SafeStorageLike & { key: number } {
  const s = {
    key: 0x5a,
    isEncryptionAvailable: () => available,
    encryptString: (p: string) => Buffer.from(Buffer.from(p, "utf8").map((b) => b ^ s.key)),
    decryptString: (b: Buffer) => Buffer.from(b.map((x) => x ^ s.key)).toString("utf8"),
    getSelectedStorageBackend: () => backend,
  };
  return s;
}

const dir = () => mkdtempSync(join(tmpdir(), "clip-desktop-test-"));

describe("SafeVaultStorage", () => {
  it("wraps the vault record with the OS store on disk and reads it back", () => {
    const d = dir();
    const safe = fakeSafe();
    const s = new SafeVaultStorage(join(d, "vault.json"), safe, "darwin");
    expect(s.protection).toBe("keychain");
    s.set("clip-wallet/vault/v1", '{"sealed":"ciphertext"}');
    const disk = readFileSync(join(d, "vault.json"), "utf8");
    expect(disk).not.toContain("ciphertext");
    expect(disk).toContain("safe:v1:");
    expect(new SafeVaultStorage(join(d, "vault.json"), safe, "darwin").get("clip-wallet/vault/v1")).toBe('{"sealed":"ciphertext"}');
  });
  it("another machine / user (other OS key) gets nothing, and the file is untouched", () => {
    const d = dir();
    new SafeVaultStorage(join(d, "vault.json"), fakeSafe(), "win32").set("k", "v");
    const other = fakeSafe();
    other.decryptString = () => {
      throw new Error("DPAPI: wrong user");
    };
    expect(new SafeVaultStorage(join(d, "vault.json"), other, "win32").get("k")).toBeUndefined();
    expect(readFileSync(join(d, "vault.json"), "utf8")).toContain("safe:v1:");
  });
  it("Linux without a keyring (basic_text) keeps the vault's own encryption only, and says so", () => {
    const d = dir();
    const s = new SafeVaultStorage(join(d, "vault.json"), fakeSafe(true, "basic_text"), "linux");
    expect(s.protection).toBe("basic");
    s.set("k", "sealed-by-vault");
    expect(readFileSync(join(d, "vault.json"), "utf8")).toContain("sealed-by-vault");
    expect(protectionOf(fakeSafe(false), "darwin")).toBe("none");
    expect(protectionOf(fakeSafe(true, "kwallet5"), "linux")).toBe("kwallet");
  });
  it("app KV persists JSON atomically", async () => {
    const d = dir();
    const kv = new FileKV(join(d, "app.json"));
    await kv.set("prefs", { theme: "dark" });
    expect(await new FileKV(join(d, "app.json")).get("prefs")).toEqual({ theme: "dark" });
    await kv.remove("prefs");
    expect(await new FileKV(join(d, "app.json")).get("prefs")).toBeUndefined();
  });
});

describe("Touch ID PRF", () => {
  const deps = (o: { prompt?: () => Promise<void>; can?: boolean } = {}) => {
    let n = 0;
    return {
      platform: "darwin" as const,
      canPromptTouchID: () => o.can ?? true,
      promptTouchID: o.prompt ?? (async () => undefined),
      safe: fakeSafe(),
      kv: new MemoryKV(),
      randomBytes: (len: number) => Uint8Array.from({ length: len }, () => ++n),
    };
  };
  it("enroll and evaluate give the same HMAC of the vault's PRF input; the secret is stored wrapped", async () => {
    const d = deps();
    const prf = new TouchIdPrf(d);
    expect(prf.available).toBe(true);
    const input = new Uint8Array(32).fill(7);
    const r = await prf.enroll(input, "turn on");
    const again = await prf.evaluate(r.credentialId, input, "unlock");
    expect(Buffer.from(again).toString("hex")).toBe(Buffer.from(r.prfOutput).toString("hex"));
    const secret = Uint8Array.from({ length: 32 }, (_, i) => 17 + i); // after the 16-byte credential id
    expect(Buffer.from(again).toString("hex")).toBe(Buffer.from(hmac(sha256, secret, input)).toString("hex"));
    const stored = [...d.kv.data.values()][0] as string;
    expect(stored).not.toContain(Buffer.from(secret).toString("hex"));
  });
  it("cancelled Touch ID never reaches the secret; unavailable off macOS / without a sensor", async () => {
    const prf = new TouchIdPrf(deps({ prompt: async () => Promise.reject(new Error("cancel")) }));
    await expect(prf.enroll(new Uint8Array(32), "x")).rejects.toMatchObject({ code: "biometric/cancelled" });
    expect(new TouchIdPrf(deps({ can: false })).available).toBe(false);
    expect(new TouchIdPrf({ ...deps(), platform: "win32" }).available).toBe(false);
    await expect(new TouchIdPrf(deps()).evaluate(new Uint8Array(16), new Uint8Array(32), "x")).rejects.toMatchObject({ code: "biometric/not-enrolled" });
  });
});

describe("Ledger HID relay", () => {
  it("relays APDUs to the renderer and maps status words in the main process", async () => {
    const jobs: HidJob[] = [];
    let relay!: HidRelay;
    relay = new HidRelay({
      target: () => ({
        send(job) {
          jobs.push(job);
          queueMicrotask(() =>
            relay.onReply(job.op === "exchange" ? { id: job.id, ok: true, data: job.apdu.startsWith("e001") ? "0105424f4c4f530105312e302e30" + "9000" : "6985" } : { id: job.id, ok: true }),
          );
        },
      }),
    });
    const t = await relay.transport();
    const r = await t.send(0xe0, 0x01, 0, 0);
    expect(r.toString("hex")).toMatch(/9000$/);
    await expect(t.send(0xe0, 0x02, 0, 0)).rejects.toMatchObject({ statusCode: 0x6985 });
    expect(jobs.map((j) => j.op)).toEqual(["open", "exchange", "exchange"]);
  });
  it("without a window there is a plain error; renderer failures keep their name for the hardware package", async () => {
    await expect(new HidRelay({ target: () => null }).transport()).rejects.toMatchObject({ code: "hw/no-window" });
    let relay!: HidRelay;
    relay = new HidRelay({ target: () => ({ send: (j) => queueMicrotask(() => relay.onReply({ id: j.id, ok: false, name: "TransportOpenUserCancelled", message: "no device selected" })) }) });
    await expect(relay.transport()).rejects.toMatchObject({ name: "TransportOpenUserCancelled" });
    expect(ledgerDevices([{ vendorId: 0x2c97 }, { vendorId: 0x1050 }])).toEqual([{ vendorId: 0x2c97 }]);
  });
});
