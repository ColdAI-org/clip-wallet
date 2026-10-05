/** The host side of paying through a bonded Connector, shared by the engine (mobile) and the extension background. */
import { describe, expect, it, vi } from "vitest";
import { ClipError, type AssetRef, type DappRequest } from "@clip-wallet/core";
import type { ApprovalPlan, ApprovalView, SettleFundingView } from "@clip-wallet/ui";
import type { SettleFunding, SettleOrder } from "@clip-wallet/route";
import { SettleFundingRun, claimedTitle, txHashOf } from "../src/settle-funding.js";

const USDC_BASE: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: "eip155:84532", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const ORDER = `0x${"0d".repeat(32)}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const req = (id: string, networkId = "eip155:11155111"): DappRequest => ({ id, origin: "clip-wallet://route", via: "injected", family: "evm", networkId, method: "eth_sendTransaction", params: [] });

function funding(): SettleFundingView {
  return {
    orderId: ORDER,
    stage: "offer",
    provider: "Connector A",
    pay: { amount: "13052000", symbol: "USDC", decimals: 6 },
    receive: { amount: "13000000", symbol: "USDC", decimals: 6 },
    fee: { amount: "52000", symbol: "USDC", decimals: 6 },
    payback: { amount: "19800000000", symbol: "HBAR", decimals: 8 },
    approveFirst: true,
    etaSeconds: 90,
    deadline: 1_800_001_800,
  };
}

function setup(o: { order?: () => Promise<unknown>; send?: (r: DappRequest, id: string) => Promise<string> } = {}) {
  const plan: ApprovalPlan = { source: "Your balance", sponsored: true, readyInSeconds: 90, steps: [], settlement: "", funding: funding() };
  const view = { id: "ap1", plan } as ApprovalView;
  let order: Partial<SettleOrder> = { status: "deposited" };
  let balance = 12_000_000n;
  const settle = {
    order: vi.fn(o.order ?? (async () => ({ order: { id: ORDER }, requests: [req("approve"), req("deposit")], need: { asset: USDC_BASE, amount: "25000000" } }))),
    markDeposited: vi.fn(),
    stage: vi.fn(async (_id: string, arrived: boolean) => {
      const { stageOf } = await import("@clip-wallet/route");
      return { stage: stageOf(order as SettleOrder, arrived), order };
    }),
    claim: vi.fn(async () => [req("claim", "eip155:296")]),
  };
  let n = 0;
  const host = {
    send: vi.fn(o.send ?? (async (_r: DappRequest, _id: string) => hash(++n))),
    waitMined: vi.fn(async () => undefined),
    balance: vi.fn(async () => balance),
    replan: vi.fn(async (): Promise<ApprovalPlan> => ({ source: "Your balance", sponsored: true, readyInSeconds: 12, steps: [], settlement: "fresh" })),
    changed: vi.fn(),
    pollMs: 60_000,
  };
  const run = new SettleFundingRun(settle as unknown as SettleFunding, view, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", host);
  return {
    run,
    view,
    settle,
    host,
    setOrder: (x: Partial<SettleOrder>) => (order = x),
    setBalance: (b: bigint) => (balance = b),
  };
}

describe("SettleFundingRun", () => {
  it("pays in one approval (approve mined, then deposit), follows the order and hands the request back when the money arrives", async () => {
    const t = setup();
    expect(await t.run.approve()).toBe("handled");
    t.run.stop();
    expect(t.host.send.mock.calls.map((c) => [c[0].id, c[1]])).toEqual([
      ["approve", "ap1:settle:0"],
      ["deposit", "ap1:settle:1"],
    ]);
    expect(t.host.waitMined).toHaveBeenCalledTimes(1);
    expect(t.host.waitMined).toHaveBeenCalledWith("eip155:11155111", hash(1));
    expect(t.settle.markDeposited).toHaveBeenCalledWith(ORDER, hash(2));
    expect(t.view.plan!.funding).toMatchObject({ stage: "waiting", depositTx: hash(2) });
    expect(t.run.inFlight).toBe(true);
    await expect(t.run.approve()).rejects.toMatchObject({ code: "settle/in-flight" });

    const run2 = new SettleFundingRun(t.settle as never, t.view, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", t.host);
    run2.paid = true;
    t.setOrder({ status: "deposited", claimableFrom: 1_800_003_601 });
    await run2.tick();
    expect(t.view.plan!.funding).toMatchObject({ stage: "opened", claimableFrom: 1_800_003_601 });
    run2.stop();

    // The money shows up before Hedera closes the order: the request is re-planned and can be approved.
    const t3 = setup();
    await t3.run.approve();
    t3.run.stop();
    t3.setOrder({ status: "deposited", claimableFrom: 1 });
    t3.setBalance(25_000_000n);
    const live = new SettleFundingRun(t3.settle as never, t3.view, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", t3.host);
    (live as unknown as { need: unknown }).need = { asset: USDC_BASE, amount: "25000000" };
    await live.tick();
    live.stop();
    expect(t3.host.replan).toHaveBeenCalled();
    expect(t3.view.plan!.settlement).toBe("fresh");
    expect(t3.view.plan!.funding).toMatchObject({ stage: "delivered", arrived: true });
    expect(await live.approve()).toBe("sign");
  });

  it("on a missed deadline, Approve is the one-tap claim on Hedera", async () => {
    const t = setup();
    await t.run.approve();
    t.setOrder({ status: "defaulted" });
    await t.run.tick();
    expect(t.view.plan!.funding!.stage).toBe("late");
    expect(await t.run.approve()).toBe("claimed");
    expect(t.settle.claim).toHaveBeenCalledWith(ORDER, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(t.host.send.mock.calls.at(-1)![0].networkId).toBe("eip155:296");
    expect(t.view.plan!.funding).toMatchObject({ stage: "claimed", claimTx: hash(3) });
    expect(claimedTitle(t.view.plan!.funding!, (a, d) => String(Number(a) / 10 ** d))).toBe("Paid back 198 HBAR on Hedera");
  });

  it("keeps the offer when sending fails, and re-plans when the offer changed", async () => {
    let i = 0;
    const t = setup({ send: async (_r: DappRequest, _id: string) => (++i === 2 ? Promise.reject(new ClipError("Network down", "rpc/unavailable")) : hash(i)) });
    await expect(t.run.approve()).rejects.toMatchObject({ code: "settle/deposit-failed" });
    expect(t.view.plan!.funding!.stage).toBe("offer");
    expect(t.run.inFlight).toBe(false);

    const c = setup({ order: async () => Promise.reject(new ClipError("expired", "settle/offer-changed")) });
    await expect(c.run.approve()).rejects.toMatchObject({ code: "settle/offer-changed" });
    expect(c.host.replan).toHaveBeenCalled();
    expect(c.view.plan!.settlement).toBe("fresh");
  });

  it("a gone app keeps the order on screen; arrived then just closes", async () => {
    const t = setup();
    await t.run.approve();
    t.run.stop();
    t.run.appGone();
    t.view.plan!.funding!.arrived = true;
    expect(await t.run.approve()).toBe("dismiss");
  });

  it("reads a transaction hash from a chain module's result", () => {
    expect(txHashOf({ txHash: hash(7) })).toBe(hash(7));
    expect(() => txHashOf({})).toThrow(ClipError);
  });
});
