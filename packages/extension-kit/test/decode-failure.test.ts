/**
 * Dapp matrix regression (docs/r1/dapp-matrix.md): when a chain module can't decode a request and says why with a
 * ClipError (an unfunded Bitcoin/Sui/Aptos/NEAR account: nothing to build the transaction from), the approval was
 * "Unreadable request … Signing something you can't read can empty your wallet" with the reason thrown away. It stays
 * blocked, and now also shows the module's reason.
 */
import { describe, expect, it, vi } from "vitest";
import { ClipError, type ChainModule } from "@clip-wallet/core";
import { makeService, PASSWORD } from "./helpers";

describe("a request the chain module refuses to decode", () => {
  it("stays blocked as unreadable and carries the module's plain-words reason", async () => {
    const { service, deps } = makeService();
    await service.handle({ type: "createWallet", password: PASSWORD });
    for (const m of Object.values(deps.chains) as ChainModule[]) {
      vi.spyOn(m, "decode").mockRejectedValue(new ClipError("You don't have enough BTC to send this amount and pay the network fee.", "insufficient-funds"));
    }
    const id = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const d = (await service.handle({ type: "getApproval", id }))!.decoded!;
    expect(d).toMatchObject({ title: "Unreadable request", blind: true });
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "simulation-failed", message: "You don't have enough BTC to send this amount and pay the network fee." }));
  });

  it("adds nothing for an unexpected error (no internals leak into the approval)", async () => {
    const { service, deps } = makeService();
    await service.handle({ type: "createWallet", password: PASSWORD });
    for (const m of Object.values(deps.chains) as ChainModule[]) vi.spyOn(m, "decode").mockRejectedValue(new TypeError("x is undefined"));
    const id = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const d = (await service.handle({ type: "getApproval", id }))!.decoded!;
    expect(d.warnings.map((w) => w.code)).toEqual(["blind-signing"]);
  });
});
