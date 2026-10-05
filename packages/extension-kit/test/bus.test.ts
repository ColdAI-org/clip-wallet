import { describe, expect, it, vi } from "vitest";
vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } } }));
import { Request } from "../src/shared/messages";
import { createBusClient, BusError } from "../src/shared/bus";

describe("message bus", () => {
  it("validates requests strictly", () => {
    expect(Request.safeParse({ type: "unlock", password: "x" }).success).toBe(true);
    expect(Request.safeParse({ type: "unlock" }).success).toBe(false);
    expect(Request.safeParse({ type: "deleteEverything" }).success).toBe(false);
    expect(Request.safeParse({ type: "setPrefs", patch: { advanced: true, extra: 1 } }).success).toBe(false);
    expect(Request.safeParse({ type: "setPrefs", patch: { rpcOverrides: { "eip155:1": "http://insecure.example" } } }).success).toBe(false);
    expect(Request.safeParse({ type: "send", assetKey: "usdc", networkId: "eip155:1", to: "0x1", amount: "1e18" }).success).toBe(false);
    expect(Request.safeParse({ type: "pairWalletConnect", uri: "https://evil.example" }).success).toBe(false);
  });

  it("surfaces userMessage only, and handles void replies", async () => {
    const replies: unknown[] = [{ ok: true }, { ok: false, error: { userMessage: "That password didn't work.", code: "vault/wrong-password" } }, "garbage"];
    const client = createBusClient(async () => replies.shift());
    await expect(client.lock()).resolves.toBeUndefined();
    await expect(client.unlock("x")).rejects.toMatchObject({ userMessage: "That password didn't work.", code: "vault/wrong-password" });
    await expect(client.lock()).rejects.toBeInstanceOf(BusError);
  });

  it("only exposes the dev simulator in fixture builds", () => {
    expect(createBusClient(async () => ({ ok: true }), false).devSimulateRequest).toBeUndefined();
    expect(createBusClient(async () => ({ ok: true }), true).devSimulateRequest).toBeTypeOf("function");
  });
});
