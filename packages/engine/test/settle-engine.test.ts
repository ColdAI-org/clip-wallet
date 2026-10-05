/** The mobile engine runs the same settle-on-Hedera flow as the extension: pay, follow, sign — or claim when late. */
import { describe, expect, it, vi } from "vitest";
import type { DappRequest } from "@clip-wallet/core";
import { stageOf, type SettleFunding, type SettleOrder } from "@clip-wallet/route";
import type { ApprovalPlan, SettleFundingView } from "@clip-wallet/ui";
import { WalletEngine } from "../src/engine.js";
import { MemoryKV } from "../src/kv.js";
import { EVM_ADDRESS, FakeVault, SEPOLIA, makeDeps, makeEnv, tick } from "./fixtures.js";

const ORDER = `0x${"0d".repeat(32)}`;
const tx = (id: string, networkId = SEPOLIA.id): DappRequest => ({ id, origin: "clip-wallet://route", via: "injected", family: "evm", networkId, method: "eth_sendTransaction", params: [{ to: "0x00000000000000000000000000000000de9051d1", value: "0x0" }] });

function offer(): SettleFundingView {
  const a = { amount: "1000", symbol: "ETH", decimals: 18 };
  return { orderId: ORDER, stage: "offer", provider: "Connector A", pay: a, receive: a, fee: a, payback: { amount: "100000000", symbol: "HBAR", decimals: 8 }, approveFirst: true, etaSeconds: 60, deadline: 1 };
}

function setup(late: boolean) {
  const vault = new FakeVault();
  const deps = makeDeps(vault);
  deps.mocks = true; // no receipts to wait for, fast polling
  let order: Partial<SettleOrder> = { status: "deposited", claimableFrom: 1 };
  let first = true;
  deps.route = {
    async plan({ decoded }) {
      const base: ApprovalPlan = { source: "Your balance", sponsored: false, readyInSeconds: 12, steps: [{ kind: "action", title: decoded.title }], settlement: "" };
      if (!first) return base;
      first = false;
      return { ...base, funding: offer() };
    },
  };
  const settle = {
    order: vi.fn(async () => ({ order: { id: ORDER }, requests: [tx("approve"), tx("deposit")], need: { asset: SEPOLIA.nativeAsset, amount: late ? "999000000000000000000" : "1" } })),
    markDeposited: vi.fn(),
    stage: vi.fn(async (_id: string, arrived: boolean) => ({ stage: stageOf(order as SettleOrder, arrived), order })),
    claim: vi.fn(async () => [tx("claim")]),
  };
  deps.settleFunding = settle as unknown as SettleFunding;
  if (late) order = { status: "defaulted" };
  const opened: string[] = [];
  const engine = new WalletEngine(deps, new MemoryKV(), makeEnv((id) => opened.push(id)));
  engine.start();
  return { engine, vault, deps, settle, opened };
}

async function waitFor(engine: WalletEngine, id: string, ok: (f: SettleFundingView) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = await engine.handle({ type: "getApproval", id });
    if (v?.plan?.funding && ok(v.plan.funding)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("stage not reached");
}

describe("WalletEngine: settle on Hedera", () => {
  it("one approval pays the Connector (two vault signatures), then the app's request is signed when the money arrives", async () => {
    const t = setup(false);
    await t.engine.handle({ type: "createWallet", password: "a long test password" });
    const paying = t.engine.request({ id: "r1", origin: "https://dapp.test", via: "injected", family: "evm", networkId: SEPOLIA.id, method: "eth_sendTransaction", params: [{ to: EVM_ADDRESS, value: "0x1" }] });
    for (let i = 0; i < 5 && !t.opened.length; i++) await tick();
    const id = t.opened[0]!;
    await t.engine.handle({ type: "approve", id });
    expect(t.vault.signed.map((s) => s.approvalId)).toEqual([`${id}:settle:0`, `${id}:settle:1`]);
    expect(t.settle.markDeposited).toHaveBeenCalledWith(ORDER, `0x${"ab".repeat(32)}`);
    await expect(t.engine.handle({ type: "reject", id })).rejects.toMatchObject({ code: "settle/in-flight" });
    await waitFor(t.engine, id, (f) => !!f.arrived);
    await t.engine.handle({ type: "approve", id });
    expect(await paying).toMatchObject({ txHash: `0x${"ab".repeat(32)}` });
    expect(t.vault.signed.at(-1)!.approvalId).toBe(id);
  });

  it("late: Approve claims the cover on Hedera and the app hears the payment didn't arrive", async () => {
    const t = setup(true);
    await t.engine.handle({ type: "createWallet", password: "a long test password" });
    const paying = t.engine.request({ id: "r2", origin: "https://dapp.test", via: "injected", family: "evm", networkId: SEPOLIA.id, method: "eth_sendTransaction", params: [{ to: EVM_ADDRESS, value: "0x1" }] });
    paying.catch(() => undefined);
    for (let i = 0; i < 5 && !t.opened.length; i++) await tick();
    const id = t.opened[0]!;
    await t.engine.handle({ type: "approve", id });
    await waitFor(t.engine, id, (f) => f.stage === "late");
    await t.engine.handle({ type: "approve", id });
    expect(t.settle.claim).toHaveBeenCalledWith(ORDER, EVM_ADDRESS);
    expect(t.vault.signed.at(-1)!.approvalId).toBe(`${id}:claim:0`);
    await expect(paying).rejects.toMatchObject({ code: "settle/late" });
    const [entry] = await t.engine.handle({ type: "getActivity" });
    expect(entry!.title).toBe("Paid back 1 HBAR on Hedera");
  });
});
