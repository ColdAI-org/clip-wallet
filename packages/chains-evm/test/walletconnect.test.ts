import type { DappRequest } from "@clip-wallet/core";
import { type Hex, bytesToHex, hashMessage, hexToBytes, recoverMessageAddress } from "viem";
import { describe, expect, it } from "vitest";
import { createEvmModule } from "../src/module.js";
import { PERSONAL, SEND_NATIVE, SEPOLIA_STATE, TYPED } from "./fixtures.js";
import { BOB, ME, SEPOLIA, TEST_ACCOUNT, ctxFor, mockFetch } from "./helpers.js";
import { SIGS } from "./signatures.js";

const wc = (r: DappRequest): DappRequest => ({ ...r, via: "walletconnect" });
const sig = (h: string) => {
  const b = hexToBytes(h as Hex);
  return { scheme: "ecdsa-secp256k1" as const, bytes: b.slice(0, 64), recovery: b[64]! - 27, publicKey: TEST_ACCOUNT.publicKey };
};

describe("WalletConnect eip155 requests (same method names and params as injected)", () => {
  it("eth_sendTransaction over WC decodes and signs the same way", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch(SEPOLIA_STATE));
    const d = await mod.decode(wc(SEND_NATIVE), ctx);
    expect(d.title).toBe("Send 0.01 ETH to 0x1234…5678");
    await mod.prepare(wc(SEND_NATIVE), ctx, "a");
    expect(await mod.finalize(wc(SEND_NATIVE), [sig(SIGS.sendNative)], ctx)).toBe("0x" + "ab".repeat(32));
  });

  it("eth_signTypedData (no suffix) is treated as v4", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const r = wc({ ...TYPED, method: "eth_signTypedData" });
    expect((await mod.decode(r, ctx)).title).toBe("Allow Uniswap Permit2 to spend all your USDC");
    await mod.prepare(r, ctx, "a");
    await expect(mod.finalize(r, [sig(SIGS.typed)], ctx)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("wallet_authenticate (one-click auth) → Sign in, personal_sign digest and signature", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const message = "Hello Clip";
    const r: DappRequest = { ...wc(PERSONAL), id: "auth", method: "wallet_authenticate", params: { message, address: ME, domain: "app.example.com", authPayload: {} } };
    const [p] = await mod.prepare(r, ctx, "a");
    expect(bytesToHex(p!.bytes)).toBe(hashMessage(message));
    const out = (await mod.finalize(r, [sig(SIGS.personal)], ctx)) as Hex;
    expect(await recoverMessageAddress({ message, signature: out })).toBe(ME);

    const siwe = `app.example.com wants you to sign in with your Ethereum account:\n${ME}\n\nURI: https://app.example.com\nVersion: 1\nChain ID: 11155111\nNonce: 12345678\nIssued At: 2026-10-03T00:00:00Z`;
    const d = await mod.decode({ ...r, params: { message: siwe, address: ME, domain: "app.example.com" } }, ctx);
    expect(d.title).toBe("Sign in to app.example.com");
    await expect(mod.decode({ ...r, params: { message: siwe, address: BOB } }, ctx)).rejects.toMatchObject({ code: "wrong-account" });
  });
});
