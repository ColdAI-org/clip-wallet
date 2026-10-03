import { describe, expect, it } from "vitest";
import { ClipError } from "@clip-wallet/core";
import { makeService, PASSWORD } from "./helpers";
import { fromB64url, b64url } from "../src/background/passkey-proxy";

async function waitForApproval(service: Awaited<ReturnType<typeof ready>>["service"]) {
  for (let i = 0; i < 100; i++) {
    const list = await service.handle({ type: "listApprovals" });
    if (list.length) return list;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no approval queued");
}

async function ready() {
  const ctx = makeService();
  await ctx.service.handle({ type: "createWallet", password: PASSWORD });
  return ctx;
}

describe("WalletService (fixture deps, real vault)", () => {
  it("creates a wallet, reveals the phrase only with the password, and locks/unlocks", async () => {
    const { service } = makeService();
    expect((await service.handle({ type: "getState" })).status).toBe("empty");
    await service.handle({ type: "createWallet", password: PASSWORD });
    expect((await service.handle({ type: "getState" })).status).toBe("unlocked");
    expect((await service.handle({ type: "revealPhrase", password: PASSWORD })).split(" ")).toHaveLength(12);
    await expect(service.handle({ type: "revealPhrase", password: "nope nope nope" })).rejects.toMatchObject({ code: "vault/wrong-password" });
    await service.handle({ type: "lock" });
    await expect(service.handle({ type: "getPortfolio" })).rejects.toMatchObject({ code: "vault/locked" });
    await service.handle({ type: "unlock", password: PASSWORD });
    expect((await service.handle({ type: "getState" })).status).toBe("unlocked");
  });

  it("prices balances in the display currency and keeps raw networks for the split view", async () => {
    const { service } = await ready();
    const p = await service.handle({ type: "getPortfolio" });
    const usdc = p.balances.filter((b) => b.asset.key === "usdc");
    expect(usdc.map((b) => b.fiatValue)).toEqual(expect.arrayContaining([12, 400]));
    await service.handle({ type: "setPrefs", patch: { displayCurrency: "EUR" } });
    const eur = await service.handle({ type: "getPortfolio" });
    expect(eur.currency).toBe("EUR");
    expect(eur.balances.find((b) => b.asset.key === "usdc" && b.fiatValue! > 300)!.fiatValue).toBeCloseTo(368);
  });

  it("pays a dapp: decode → plan with funding → approval-bound vault signature → one activity entry", async () => {
    const { service } = await ready();
    const id = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const view = (await service.handle({ type: "getApproval", id }))!;
    expect(view.decoded!.title).toBe("Pay 25 USDC");
    expect(view.dapp).toMatchObject({ name: "Magic Eden", domain: "magiceden.io", verified: true });
    expect(view.fiatValue).toBe(25);
    expect(view.plan!.steps.map((s) => s.kind)).toEqual(["funding", "gas", "action"]);
    expect(view.plan!.steps[0]!.title).toBe("Move 13 USDC from your other balance");
    await service.handle({ type: "approve", id });
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);
    const [entry] = await service.handle({ type: "getActivity" });
    expect(entry).toMatchObject({ title: "Paid Magic Eden 25 USDC", kind: "pay", fiatValue: -25 });
    expect(entry!.legs).toHaveLength(3);
  });

  it("blocks blind requests unless Advanced mode and an explicit per-request override", async () => {
    const { service } = await ready();
    const id = await service.handle({ type: "devSimulateRequest", kind: "blind" });
    expect((await service.handle({ type: "getApproval", id }))!.decoded!.blind).toBe(true);
    await expect(service.handle({ type: "approve", id, allowBlind: true })).rejects.toMatchObject({ code: "approval/blind-blocked" });
    await service.handle({ type: "setPrefs", patch: { advanced: true } });
    await expect(service.handle({ type: "approve", id })).rejects.toMatchObject({ code: "approval/blind-blocked" });
    await service.handle({ type: "approve", id, allowBlind: true });
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);
  });

  it("asks once which network an EVM address is on, then remembers per recipient", async () => {
    const { service } = await ready();
    const to = "0x1111111111111111111111111111111111111111";
    const first = await service.handle({ type: "resolveRecipient", input: to, assetKey: "usdc" });
    expect(first.kind).toBe("ask");
    if (first.kind !== "ask") return;
    expect(first.candidates.map((c) => c.network.name)).toEqual(["Base Sepolia", "Ethereum Sepolia"]);
    await service.handle({ type: "rememberRecipientNetwork", address: to, assetKey: "usdc", networkId: "eip155:11155111" });
    expect(await service.handle({ type: "resolveRecipient", input: to, assetKey: "usdc" })).toMatchObject({ kind: "resolved", networkId: "eip155:11155111" });
    // Unambiguous: a Hedera account id needs no question; names resolve; junk is rejected in plain words.
    expect(await service.handle({ type: "resolveRecipient", input: "0.0.1234", assetKey: "hbar" })).toMatchObject({ kind: "resolved", networkId: "hedera:testnet" });
    expect(await service.handle({ type: "resolveRecipient", input: "alice.hbar", assetKey: "hbar" })).toMatchObject({ kind: "resolved", displayName: "alice.hbar" });
    expect(await service.handle({ type: "resolveRecipient", input: "hello", assetKey: "usdc" })).toMatchObject({ kind: "invalid" });
  });

  it("send goes through the same approval path", async () => {
    const { service } = await ready();
    const id = await service.handle({ type: "send", assetKey: "usdc", networkId: "eip155:11155111", to: "0x1111111111111111111111111111111111111111", amount: "5" });
    const v = (await service.handle({ type: "getApproval", id }))!;
    expect(v.via).toBe("wallet");
    expect(v.decoded!.title).toBe("Send 5 USDC");
    expect(v.decoded!.lines[0]).toEqual({ label: "To", value: "0x1111…1111" });
    await service.handle({ type: "approve", id });
    expect((await service.handle({ type: "getActivity" }))[0]!.title).toBe("Sent 5 USDC to 0x1111…1111");
  });

  it("connect approvals grant a permission that shows under sessions and can be disconnected", async () => {
    const { service, env } = await ready();
    const pending = service.approveConnect({ origin: "https://magiceden.io", family: "evm", networkId: "eip155:84532", via: "injected" });
    const [view] = await waitForApproval(service);
    expect(env.opened).toContain(view!.id);
    expect(view!.kind).toBe("connect");
    await service.handle({ type: "approve", id: view!.id });
    expect(await pending).toBe(true);
    expect(await service.accountsFor("https://magiceden.io", "evm")).toHaveLength(1);
    const sessions = await service.handle({ type: "listSessions" });
    const mine = sessions.find((s) => s.dapp.domain === "magiceden.io")!;
    await service.handle({ type: "disconnect", id: mine.id });
    expect(await service.accountsFor("https://magiceden.io", "evm")).toHaveLength(0);
  });

  it("rejecting tells the dapp in plain words", async () => {
    const { service } = await ready();
    const p = service.request({ id: "r1", origin: "https://magiceden.io", via: "injected", family: "evm", networkId: "eip155:84532", method: "personal_sign", params: ["0x00"] });
    const [view] = await waitForApproval(service);
    expect(view!.decoded!.title).toBe("Sign in to magiceden.io");
    await service.handle({ type: "reject", id: view!.id });
    await expect(p).rejects.toBeInstanceOf(ClipError);
    await expect(p).rejects.toMatchObject({ code: "user-rejected" });
  });

  it("enrols and unlocks with a passkey through the PRF proxy (vault-chosen prfInput round-trips)", async () => {
    const { service } = await ready();
    const prfFor = (input: string) => b64url(new Uint8Array(32).map((_, i) => fromB64url(input)[i]! ^ 0x5a));
    const c1 = await service.handle({ type: "passkeyBegin", begin: { op: "enroll", password: PASSWORD } });
    expect(c1).toMatchObject({ op: "enroll", rpId: "testextensionid", mode: "extension" });
    await service.handle({ type: "passkeyFinish", result: { id: c1.id, credentialId: "AQID", prfOutput: prfFor(c1.prfInput) } });
    expect((await service.handle({ type: "getState" })).passkey.enrolled).toBe(true);

    await service.handle({ type: "lock" });
    const c2 = await service.handle({ type: "passkeyBegin", begin: { op: "unlock" } });
    expect(c2.credentialId).toBe("AQID");
    expect(c2.prfInput).toBe(c1.prfInput);
    // A wrong PRF output can't unwrap the vault key.
    await expect(service.handle({ type: "passkeyFinish", result: { id: c2.id, credentialId: "AQID", prfOutput: b64url(new Uint8Array(32)) } })).rejects.toMatchObject({ code: "vault/passkey-failed" });
    const c3 = await service.handle({ type: "passkeyBegin", begin: { op: "unlock" } });
    await service.handle({ type: "passkeyFinish", result: { id: c3.id, credentialId: "AQID", prfOutput: prfFor(c3.prfInput) } });
    expect((await service.handle({ type: "getState" })).status).toBe("unlocked");
  });

  it("passkey enrolment with a wrong password fails before any ceremony", async () => {
    const { service } = await ready();
    await expect(service.handle({ type: "passkeyBegin", begin: { op: "enroll", password: "wrong wrong wrong" } })).rejects.toMatchObject({ code: "vault/wrong-password" });
  });
});
