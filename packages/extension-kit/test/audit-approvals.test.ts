/**
 * Internal audit 2026-10 (docs/audit/internal-audit-2026-10.md): approval-path regressions.
 *  APPR-01  one approval signs and broadcasts once, however many times Approve is pressed.
 *  APPR-02  the account that signs is the account the approval screen was built for.
 */
import { describe, expect, it, vi } from "vitest";
import { displaySafe, sanitizeDecoded, unverifiedOrigin, type DecodedRequest, type Signature } from "@clip-wallet/core";
import { makeService, PASSWORD } from "./helpers";

async function ready() {
  const ctx = makeService();
  await ctx.service.handle({ type: "createWallet", password: PASSWORD });
  return ctx;
}

describe("audit: approval path", () => {
  it("APPR-01: a second Approve while the first is broadcasting doesn't sign or broadcast again", async () => {
    const { service, deps } = await ready();
    const evm = deps.chains.evm!;
    const realFinalize = evm.finalize.bind(evm);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inFinalize = new Promise<void>((r) => (entered = r));
    const finalize = vi.spyOn(evm, "finalize").mockImplementation(async (req, sigs: Signature[], ctx) => {
      entered();
      await gate;
      return realFinalize(req, sigs, ctx);
    });
    const sign = vi.spyOn(deps.vault, "sign");

    const id = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const first = service.handle({ type: "approve", id });
    await inFinalize;
    const second = service.handle({ type: "approve", id }).then(
      () => "ok",
      (e: { code?: string }) => e.code,
    );
    // Give the second click every chance to get as far as it can, then let the first broadcast finish.
    await new Promise((r) => setTimeout(r, 50));
    release();
    await first;
    const secondResult = await second;

    expect(secondResult).toBe("approval/in-progress");
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);
  });

  it("APPR-02: switching the site's account after the request arrived doesn't sign with the new account", async () => {
    const { service, deps } = await ready();
    await service.handle({ type: "addAccount", family: "evm" });
    const id = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const shown = (await service.handle({ type: "getApproval", id }))!;
    const sign = vi.spyOn(deps.vault, "sign");
    // The user (or anything driving the UI) changes which account the wallet uses before pressing Approve.
    await service.handle({ type: "setActiveAccount", family: "evm", accountId: "evm:1" });
    await expect(service.handle({ type: "approve", id })).rejects.toMatchObject({ code: "approval/account-changed" });
    expect(sign).not.toHaveBeenCalled();
    expect(shown.decoded).toBeTruthy();
  });

  it("WC-01: a WalletConnect app claiming a known site is shown unverified, under its own pseudo-origin", async () => {
    const { service } = await ready();
    const origin = unverifiedOrigin("https://magiceden.io");
    const p = service.request(
      { id: "wc1", origin, via: "walletconnect", family: "evm", networkId: "eip155:84532", method: "personal_sign", params: ["0x00"] },
      { name: "Magic Eden" },
    );
    p.catch(() => undefined);
    let view;
    for (let i = 0; i < 100 && !view; i++) {
      view = (await service.handle({ type: "listApprovals" }))[0];
      if (!view) await new Promise((r) => setTimeout(r, 10));
    }
    expect(view!.dapp).toMatchObject({ verified: false, domain: "magiceden.io (unverified)" });
    expect(view!.decoded!.warnings.map((w) => w.code)).toContain("domain-mismatch");
    expect(await service.accountsFor("https://magiceden.io", "evm")).toHaveLength(0);
    await service.handle({ type: "reject", id: view!.id });
  });

  it("DISP-01: invisible and direction-changing characters never reach the approval screen", async () => {
    expect(displaySafe("USDC\u202E0x1234")).toBe("USDC0x1234");
    expect(displaySafe("to\u200Bm\uFEFFe\u2066x\u2069")).toBe("tomex");
    expect(displaySafe("line one\nline two\tok")).toBe("line one\nline two\tok");
    const asset = { key: "k", symbol: "US\u202EDC", name: "Fake\u200B", decimals: 6, networkId: "eip155:1" };
    const d: DecodedRequest = {
      requestId: "r",
      title: "Send 5 \u202Eevil",
      lines: [{ label: "To\u200B", value: "0xabc\u202E" }],
      balanceChanges: [{ asset, delta: "-5" }],
      fee: { asset, amount: "1" },
      simulated: false,
      blind: false,
      warnings: [{ level: "info", code: "known-scam", message: "x\u202Ey" }],
      networkId: "eip155:1",
    };
    const out = sanitizeDecoded(d);
    expect(JSON.stringify(out)).not.toMatch(/[\u200B\u202E\uFEFF]/);

    const { service } = await ready();
    const p = service.request(
      { id: "n1", origin: "https://some-site.example", via: "injected", family: "evm", networkId: "eip155:84532", method: "personal_sign", params: ["0x00"] },
      { name: "Uni\u202Eswap\u200B" },
    );
    p.catch(() => undefined);
    let view;
    for (let i = 0; i < 100 && !view; i++) {
      view = (await service.handle({ type: "listApprovals" }))[0];
      if (!view) await new Promise((r) => setTimeout(r, 10));
    }
    expect(view!.dapp.name).toBe("Uniswap");
    await service.handle({ type: "reject", id: view!.id });
  });
});
