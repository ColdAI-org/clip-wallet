/**
 * EIP-5792 wallet_sendCalls + ERC-7682 auxiliary funds in the background (fixture deps, real vault, mock Connector):
 * one approval shows every call; the shortfall across the batch is brought in by the Connector inside that approval;
 * the calls then run in order and wallet_getCallsStatus reports them. A separate file: the mock delivery credits the
 * fixture balances.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalView } from "@clip-wallet/ui";
import { resetMockSettleCredits } from "../src/background/mocks/mock-settle";
import { makeService, PASSWORD } from "./helpers";

async function ready() {
  const ctx = makeService();
  await ctx.service.handle({ type: "createWallet", password: PASSWORD });
  return ctx;
}
type Svc = Awaited<ReturnType<typeof ready>>["service"];

async function until<T>(f: () => Promise<T | undefined | null>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v && ok(v)) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}
const view = (service: Svc, id: string) => service.handle({ type: "getApproval", id }) as Promise<ApprovalView | null>;

describe("wallet_sendCalls with auxiliary funds (fixture Connector)", () => {
  afterEach(() => resetMockSettleCredits());

  it("one approval: both payments listed, the batch's shortfall funded by the Connector, calls sent in order", async () => {
    const { service, deps } = await ready();
    const id = await service.handle({ type: "devSimulateRequest", kind: "send-calls" });
    const v = (await view(service, id))!;
    expect(v.decoded!.title).toBe("2 steps for magiceden.io");
    expect(v.decoded!.lines.slice(0, 2).map((l) => [l.label, l.value])).toEqual([
      ["Step 1", "Pay 10 USDC"],
      ["Step 2", "Pay 15 USDC"],
    ]);
    expect(v.decoded!.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc" }), delta: "-25000000" }]);
    // 12 USDC on Base, 25 needed: the Connector delivers 13 (ERC-7682 auxiliary funds), inside this approval.
    expect(v.plan!.funding).toMatchObject({ stage: "offer", receive: { amount: "13000000", symbol: "USDC" } });
    expect(v.plan!.steps.filter((s) => s.kind === "action").map((s) => s.title)).toEqual(["Pay 10 USDC", "Pay 15 USDC"]);

    await service.handle({ type: "approve", id });
    await until(() => view(service, id), (x) => !!x.plan?.funding?.arrived);
    await service.handle({ type: "approve", id });
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);

    const calls = (service as unknown as { calls: { status(o: string, id: string): Promise<{ status: number; receipts?: unknown[]; atomic: boolean } | undefined> } }).calls;
    const store = (calls as unknown as { store: { all(): Promise<{ id: string }[]> } }).store;
    const [rec] = await store.all();
    expect(rec).toBeDefined();
    const st = await until(() => calls.status("https://magiceden.io", rec!.id), (s) => s.status === 200);
    expect(st).toMatchObject({ status: 200, atomic: false });
    expect(st.receipts).toHaveLength(2);
    // Only the app that sent it can read it.
    expect(await calls.status("https://other.example", rec!.id)).toBeUndefined();
    const entry = await until(async () => (await service.handle({ type: "getActivity" })).find((e) => e.id === rec!.id), () => true);
    expect(entry).toMatchObject({ title: "2 steps on Magic Eden", status: "done" });
    expect(entry.legs.map((l) => l.title)).toEqual(["Pay 10 USDC", "Pay 15 USDC"]);
    expect(deps.auxiliaryFundsSources?.length).toBeGreaterThan(0);
  });

  it("advertises auxiliaryFunds only where the Connector can deliver an asset the wallet knows", async () => {
    const { service } = await ready();
    const aux = service.calls.auxiliaryFunds(["eip155:84532", "eip155:1"]);
    expect(aux["eip155:84532"]).toMatchObject({ supported: true });
    expect(aux["eip155:84532"]!.assets).toContain("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    expect(aux["eip155:1"]).toBeUndefined();
  });

  it("a rejected batch sends nothing and is unknown to wallet_getCallsStatus", async () => {
    const { service } = await ready();
    const id = await service.handle({ type: "devSimulateRequest", kind: "send-calls" });
    await service.handle({ type: "reject", id });
    expect(await service.handle({ type: "listApprovals" })).toHaveLength(0);
    expect(await service.handle({ type: "getActivity" })).toEqual(expect.not.arrayContaining([expect.objectContaining({ title: "2 steps on Magic Eden" })]));
  });
});
