/** Security stream wiring in the engine (mobile): approval refine with the send's recipient, the sec* bus, social sign-in off. */
import { describe, expect, it, vi } from "vitest";
import type { DecodedRequest, Warning } from "@clip-wallet/core";
import { RecipientLog } from "@clip-wallet/security";
import { WalletEngine } from "../src/engine.js";
import { MemoryKV } from "../src/kv.js";
import { createEngineClient } from "../src/client.js";
import { BASE_SEPOLIA, FakeVault, makeDeps, makeEnv } from "./fixtures.js";

const BOB = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const POISONED: Warning = { level: "danger", code: "address-poisoning", message: "This address only looks like one you used." };

async function setup(hidden = new Set<string>()) {
  const deps = makeDeps(new FakeVault());
  const kv = new MemoryKV();
  const engine = new WalletEngine(deps, kv, makeEnv());
  engine.start();
  const recipients = new RecipientLog(kv);
  const security = {
    handle: vi.fn(async () => []),
    refine: vi.fn(async (_r: unknown, d: DecodedRequest, _n: unknown, _a: string, extra?: { recipients?: string[] }) =>
      extra?.recipients?.includes(BOB) ? { ...d, warnings: [...d.warnings, POISONED] } : d,
    ),
    assessSite: vi.fn(async () => []),
    threat: { isKnownScam: (o: string) => o === "https://scam.example" },
    cleanup: { hidden: async () => hidden },
  };
  engine.attachSecurity(security as never, recipients);
  await engine.handle({ type: "createWallet", password: "a long test password" });
  return { engine, security, recipients };
}

describe("engine + security", () => {
  it("passes the send's recipient to the check and shows what it found", async () => {
    const { engine, security } = await setup();
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: BASE_SEPOLIA.id, to: BOB, amount: "0.1" });
    const view = await engine.handle({ type: "getApproval", id });
    expect(security.refine).toHaveBeenCalledTimes(1);
    expect(view?.decoded?.warnings.map((w) => w.code)).toContain("address-poisoning");
    expect(engine.isKnownScam("https://scam.example")).toBe(true);
  });

  it("routes sec* messages (and answers plainly without a security service)", async () => {
    const { engine, security } = await setup();
    await engine.handle({ type: "secThreatStatus" });
    expect(security.handle).toHaveBeenCalledWith({ type: "secThreatStatus" });
    const bare = new WalletEngine(makeDeps(new FakeVault()), new MemoryKV(), makeEnv());
    await bare.handle({ type: "createWallet", password: "a long test password" });
    await expect(bare.handle({ type: "secThreatStatus" })).rejects.toMatchObject({ code: "security/off" });
  });

  it("backup social sign-in is hidden without a backup service or an auth session", async () => {
    const { engine } = await setup();
    const client = createEngineClient(engine, { subscribe: () => () => undefined });
    expect(await client.backupProviders!()).toEqual({ email: false, google: false, apple: false });
  });
});
