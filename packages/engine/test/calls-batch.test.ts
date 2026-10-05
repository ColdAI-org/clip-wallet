import type { AssetRef, DappRequest, DecodedRequest } from "@clip-wallet/core";
import type { ApprovalPlan } from "@clip-wallet/ui";
import type { CallsReceipt, SendCallsParams } from "@clip-wallet/1mask";
import { describe, expect, it } from "vitest";
import { CallsBatchRun, CallsBatchStore, batchPlan, mergeBatchDecoded, requiredAssetChanges, splitSendCalls, type BatchRecord } from "../src/calls-batch.js";

const NET = "eip155:84532";
const ME = "0x1111111111111111111111111111111111111111";
const SHOP = "0x2222222222222222222222222222222222222222";
const USDC: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: NET, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const ETH: AssetRef = { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: NET };

const params = (over: Partial<SendCallsParams> = {}): SendCallsParams => ({
  version: "2.0.0",
  from: ME,
  chainId: "0x14a34",
  atomicRequired: false,
  calls: [
    { to: USDC.address as `0x${string}`, data: "0x095ea7b3", value: "0x0" },
    { to: SHOP, data: "0xabcdef01", value: "0x0" },
  ],
  ...over,
});
const req = (p = params()): DappRequest => ({ id: "b1", origin: "https://shop.example", via: "injected", family: "evm", networkId: NET, method: "wallet_sendCalls", params: [p] });

const decoded = (title: string, changes: { asset: AssetRef; delta: string }[], over: Partial<DecodedRequest> = {}): DecodedRequest => ({
  requestId: "x",
  title,
  lines: [{ label: "Requested by", value: "shop.example" }],
  balanceChanges: changes,
  fee: { asset: ETH, amount: "1000" },
  simulated: true,
  blind: false,
  warnings: [],
  networkId: NET,
  ...over,
});

class MemKV {
  m = new Map<string, unknown>();
  async get<T>(k: string) {
    return this.m.get(k) as T | undefined;
  }
  async set(k: string, v: unknown) {
    this.m.set(k, JSON.parse(JSON.stringify(v)));
  }
}

const receipt = (hash: string, status = "0x1"): CallsReceipt => ({ logs: [], status: status as `0x${string}`, blockHash: `0x${"bb".repeat(32)}`, blockNumber: "0x10", gasUsed: "0x5208", transactionHash: hash as `0x${string}` });

describe("split", () => {
  it("one eth_sendTransaction per call, in order, each carrying the calls before it", () => {
    const calls = splitSendCalls(req());
    expect(calls.map((c) => [c.id, c.method, c.batch?.index, c.batch?.count])).toEqual([
      ["b1#0", "eth_sendTransaction", 0, 2],
      ["b1#1", "eth_sendTransaction", 1, 2],
    ]);
    expect(calls[1]!.params).toEqual([{ from: ME, to: SHOP, data: "0xabcdef01", value: "0x0" }]);
    expect(calls[1]!.batch!.prior).toEqual([{ from: ME, to: USDC.address, data: "0x095ea7b3", value: "0x0" }]);
    expect(calls.every((c) => c.origin === "https://shop.example" && c.networkId === NET)).toBe(true);
  });

  it("refuses a malformed batch (it never reached 1Mask's validation)", () => {
    expect(() => splitSendCalls({ ...req(), params: [{ calls: [] }] })).toThrow();
  });
});

describe("merge into one approval", () => {
  it("one step per call, summed changes and fees, every warning once, blind if any call is blind", () => {
    const a = decoded("Allow exactly 25 USDC for shop.example", [], { warnings: [{ level: "caution", code: "new-recipient", message: "New" }] });
    const b = decoded("Pay 25 USDC", [{ asset: USDC, delta: "-25000000" }], { warnings: [{ level: "caution", code: "new-recipient", message: "New" }] });
    const m = mergeBatchDecoded(req(), [a, b]);
    expect(m.title).toBe("2 steps for shop.example");
    expect(m.titleMsg).toMatchObject({ id: "bg.req.batchSteps", values: { count: 2, host: "shop.example" } });
    expect(m.lines.map((l) => [l.label, l.value])).toEqual([
      ["Step 1", "Allow exactly 25 USDC for shop.example"],
      ["Step 2", "Pay 25 USDC"],
      ["Requested by", "shop.example"],
    ]);
    expect(m.balanceChanges).toEqual([{ asset: USDC, delta: "-25000000" }]);
    expect(m.fee).toEqual({ asset: ETH, amount: "2000" });
    expect(m.warnings).toHaveLength(1);
    expect(m.blind).toBe(false);
    expect(mergeBatchDecoded(req(), [a, { ...b, blind: true }]).blind).toBe(true);
    expect(mergeBatchDecoded(req(), [a, { ...b, simulated: false }]).simulated).toBe(false);
  });

  it("a one-call batch reads exactly like that call", () => {
    const b = decoded("Pay 25 USDC", [{ asset: USDC, delta: "-25000000" }]);
    expect(mergeBatchDecoded(req(params({ calls: [params().calls[1]!] })), [b])).toEqual({ ...b, requestId: "b1" });
  });

  it("the plan keeps funding and fee steps and lists the calls as separate actions", () => {
    const a = decoded("Allow exactly 25 USDC", []);
    const b = decoded("Pay 25 USDC", [{ asset: USDC, delta: "-25000000" }]);
    const plan: ApprovalPlan = {
      source: "Your balance",
      readyInSeconds: 90,
      steps: [
        { kind: "funding", title: "Get USDC from Connector" },
        { kind: "gas", title: "Network fee" },
        { kind: "action", title: "2 steps for shop.example" },
      ],
      settlement: "…",
    } as ApprovalPlan;
    expect(batchPlan(plan, [a, b]).steps.map((s) => [s.kind, s.title])).toEqual([
      ["funding", "Get USDC from Connector"],
      ["gas", "Network fee"],
      ["action", "Allow exactly 25 USDC"],
      ["action", "Pay 25 USDC"],
    ]);
  });

  it("ERC-7682 requiredAssets add only what the calls don't already show; unknown assets 5771 unless optional", () => {
    const p = params({ auxiliaryFunds: { optional: false, requiredAssets: [{ address: USDC.address as `0x${string}`, amount: "0x2faf080", standard: "erc20" }] } });
    expect(requiredAssetChanges(p, [USDC, ETH], [{ asset: USDC, delta: "-25000000" }], NET)).toEqual([{ asset: USDC, delta: "-25000000" }]);
    expect(requiredAssetChanges(p, [USDC, ETH], [{ asset: USDC, delta: "-50000000" }], NET)).toEqual([]);
    const unknown = params({ auxiliaryFunds: { optional: false, requiredAssets: [{ address: SHOP, amount: "0x1", standard: "erc20" }] } });
    expect(() => requiredAssetChanges(unknown, [USDC], [], NET)).toThrow(expect.objectContaining({ code: 5771 }));
    expect(requiredAssetChanges({ ...unknown, auxiliaryFunds: { ...unknown.auxiliaryFunds!, optional: true } }, [USDC], [], NET)).toEqual([]);
    const m = mergeBatchDecoded(req(), [decoded("A", []), decoded("B", [])], [{ asset: USDC, delta: "-25000000" }]);
    expect(m.lines.find((l) => l.label === "The app says it needs")?.value).toBe("25000000 USDC");
    expect(m.balanceChanges).toEqual([{ asset: USDC, delta: "-25000000" }]);
  });
});

describe("run and status (EIP-5792 status codes)", () => {
  function setup(opts: { failAt?: number; revertAt?: number } = {}) {
    const kv = new MemKV();
    const store = new CallsBatchStore(kv);
    const sent: { id: string; approvalId: string }[] = [];
    const mined = new Map<string, CallsReceipt>();
    const done: BatchRecord[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const run = new CallsBatchRun(store, {
      send: async (call, approvalId) => {
        const i = call.batch!.index;
        if (i === opts.failAt) throw new Error("broadcast rejected");
        sent.push({ id: call.id, approvalId });
        const hash = `0x${String(i + 1).repeat(64)}`;
        mined.set(hash, receipt(hash, i === opts.revertAt ? "0x0" : "0x1"));
        return hash;
      },
      waitReceipt: async (_n, hash) => {
        await gate;
        return mined.get(hash) ?? null;
      },
      done: (r) => void done.push(r),
    });
    const statusOf = (id: string) => store.status("https://shop.example", id, async (_n, h) => mined.get(h) ?? null);
    return { store, run, sent, done, release: () => release!(), statusOf, kv };
  }
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it("answers after the first call is out, sends the rest after each is mined, then 200 with every receipt", async () => {
    const t = setup();
    const res = await t.run.start(req(), "appr");
    expect(res.id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(t.sent.map((s) => s.approvalId)).toEqual(["appr#0"]);
    // Call 1 is out, call 2 waits for it: pending.
    expect((await t.statusOf(res.id))?.status).toBe(100);
    t.release();
    await settle();
    expect(t.sent.map((s) => s.approvalId)).toEqual(["appr#0", "appr#1"]);
    const st = await t.statusOf(res.id);
    expect(st).toMatchObject({ version: "2.0.0", chainId: "0x14a34", status: 200, atomic: false });
    expect(st!.receipts!.map((r) => r.transactionHash)).toEqual([`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`]);
    expect(t.done).toHaveLength(1);
    // Other sites can't see it.
    expect(await t.store.status("https://other.example", res.id, async () => null)).toBeUndefined();
  });

  it("a reverted call stops the batch: the rest are never sent (500 when the only included call reverted)", async () => {
    const t = setup({ revertAt: 0 });
    const res = await t.run.start(req(), "appr");
    t.release();
    await settle();
    expect(t.sent).toHaveLength(1);
    expect((await t.statusOf(res.id))?.status).toBe(500);
  });

  it("a later call that fails to send leaves 600 (the first one landed)", async () => {
    const t = setup({ failAt: 1 });
    const res = await t.run.start(req(), "appr");
    t.release();
    await settle();
    expect((await t.statusOf(res.id))?.status).toBe(600);
  });

  it("a first call that fails throws and records nothing (the approval can retry); app ids are unique per app (5720)", async () => {
    const t = setup({ failAt: 0 });
    await expect(t.run.start(req(params({ id: "order-7" })), "appr")).rejects.toThrow("broadcast rejected");
    const ok = setup();
    const res = await ok.run.start(req(params({ id: "order-7" })), "appr");
    expect(res.id).toBe("order-7");
    await expect(ok.store.assertNewId("https://shop.example", "order-7")).rejects.toMatchObject({ code: 5720 });
    await expect(ok.store.assertNewId("https://other.example", "order-7")).resolves.toBeUndefined();
  });

  it("a batch cut short by a restart reports what landed (600), not pending forever", async () => {
    const t = setup();
    const res = await t.run.start(req(), "appr");
    // A new store over the same storage = the service worker restarted mid-batch.
    const after = new CallsBatchStore(t.kv);
    const st = await after.status("https://shop.example", res.id, async (_n, h) => receipt(h));
    expect(st?.status).toBe(600);
  });

  it("WalletConnect: the answer carries caip345 so the Universal Provider can follow the first transaction", async () => {
    const t = setup();
    const res = await t.run.start({ ...req(), via: "walletconnect" }, "appr", { walletConnect: true });
    expect(res.capabilities).toEqual({ caip345: { caip2: NET, transactionHashes: [`0x${"1".repeat(64)}`] } });
  });
});
