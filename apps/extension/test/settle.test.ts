/**
 * Settle on Hedera in the background (fixture deps, real vault, mock Connector + order book): one Approve pays the
 * Connector, the order is followed until the money arrives and the app's request is signed, or until it's late and
 * the cover is claimed. A separate file: the mock delivery credits the fixture balances.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resetMockSettleCredits } from "../src/background/mocks/mock-settle";
import type { ApprovalView } from "@clip-wallet/ui";
import { makeService, PASSWORD } from "./helpers";

async function ready() {
  const ctx = makeService();
  await ctx.service.handle({ type: "createWallet", password: PASSWORD });
  return ctx;
}

type Svc = Awaited<ReturnType<typeof ready>>["service"];

async function until(service: Svc, id: string, ok: (v: ApprovalView) => boolean, ms = 8000): Promise<ApprovalView> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await service.handle({ type: "getApproval", id });
    if (v && ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out; last stage ${v?.plan?.funding?.stage}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("settle on Hedera (fixture Connector)", () => {
  afterEach(() => resetMockSettleCredits());
  it("pays the Connector in one approval, follows the order, then signs the app's request once the money is there", async () => {
    const { service } = await ready();
    const id = await service.handle({ type: "devSimulateRequest", kind: "settle" });
    const view = (await service.handle({ type: "getApproval", id }))!;
    expect(view.decoded!.title).toBe("Pay 25 USDC");
    const f = view.plan!.funding!;
    expect(f).toMatchObject({ stage: "offer", provider: "Clip test Connector", approveFirst: true, receive: { amount: "13000000", symbol: "USDC" }, pay: { amount: "13052000" }, payback: { symbol: "HBAR" } });
    expect(view.plan!.problem).toBeUndefined();

    await service.handle({ type: "approve", id }); // approve exactly 13.052 USDC + deposit, signed by the vault
    const paid = (await service.handle({ type: "getApproval", id }))!;
    expect(paid.plan!.funding!.stage).toBe("waiting");
    expect(paid.plan!.funding!.depositTx).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(service.handle({ type: "reject", id })).rejects.toMatchObject({ code: "settle/in-flight" });

    await until(service, id, (v) => v.plan!.funding!.stage === "opened");
    const arrived = await until(service, id, (v) => !!v.plan!.funding!.arrived);
    expect(arrived.plan!.steps[0]!.kind).not.toBe("funding"); // re-planned: the money is on Base now
    await service.handle({ type: "approve", id });
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);
    const [entry] = await service.handle({ type: "getActivity" });
    expect(entry).toMatchObject({ title: "Paid Magic Eden 25 USDC", kind: "pay" });
  });

  it("when the Connector is late, Approve claims the cover on Hedera and the app's request ends", async () => {
    const { service } = await ready();
    const id = await service.handle({ type: "devSimulateRequest", kind: "settle-late" });
    await service.handle({ type: "approve", id });
    const late = await until(service, id, (v) => v.plan!.funding!.stage === "late");
    expect(late.plan!.funding!.payback).toEqual({ amount: "19800000000", symbol: "HBAR", decimals: 8 });
    await service.handle({ type: "approve", id }); // the one-tap claim: claimDefault on Hedera's EVM, vault-signed
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);
    const [entry] = await service.handle({ type: "getActivity" });
    expect(entry).toMatchObject({ title: "Paid back 198 HBAR on Hedera", kind: "receive" });
  });
});
