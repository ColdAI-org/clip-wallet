/**
 * Internal audit 2026-10 (docs/audit/internal-audit-2026-10.md): approval-path regressions.
 *  APPR-01  one approval signs and broadcasts once, however many times Approve is pressed.
 *  APPR-02  the account that signs is the account the approval screen was built for.
 */
import { describe, expect, it, vi } from "vitest";
import type { Signature } from "@clip-wallet/core";
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
});
