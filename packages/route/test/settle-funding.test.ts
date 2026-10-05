/** Paying through a bonded Connector: which shortfalls it funds, what it keeps between plan and approve, stages. */
import { describe, expect, it, vi } from "vitest";
import { ClipError, type AssetRef, type Network, type TokenBalance } from "@clip-wallet/core";
import { SettleFunding, stageOf } from "../src/settle-funding.js";
import type { ConnectorQuote, SettleOnHederaClient, SettleOrder } from "../src/phase3.js";
import type { Shortfall } from "../src/types.js";

const USDC_BASE: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: "eip155:84532", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const USDC_SEP: AssetRef = { ...USDC_BASE, networkId: "eip155:11155111", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" };
const HBAR: AssetRef = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "eip155:296" };
const net = (id: string, chainId: number): Network => ({ id, family: "evm", name: id, nativeAsset: { ...HBAR, key: "eth", symbol: "ETH", decimals: 18, networkId: id }, testnet: true, rpcUrls: [], explorerUrl: "", chainId });
const NETWORKS = [net("eip155:84532", 84532), net("eip155:11155111", 11155111)];
const ME = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const ORDER = `0x${"0d".repeat(32)}`;

const short = (elsewhere: TokenBalance[], over: Partial<Shortfall> = {}): Shortfall => ({
  asset: USDC_BASE,
  need: "25000000",
  have: "12000000",
  missing: "13000000",
  sameAssetElsewhere: elsewhere,
  otherBalances: [],
  ...over,
});

const QUOTE: ConnectorQuote = {
  connectorId: "0x000000000000000000000000000000000c0ec7a2",
  name: "Connector A",
  deposit: { asset: USDC_SEP, amount: "13052000" },
  fee: { asset: USDC_SEP, amount: "52000" },
  bond: { asset: HBAR, amount: "19800000000" },
  deliveryP90S: 90,
  deadline: 1_800_001_800,
  expiresAt: 1_800_000_600,
  orderId: ORDER,
  receive: { asset: USDC_BASE, amount: "13000000", recipient: ME },
  title: "Get 13 USDC for 13.052 USDC",
  steps: ["Pay 13.052 USDC to Connector A"],
};

function client(over: Partial<Record<keyof SettleOnHederaClient, unknown>> = {}) {
  return {
    quoteConnectors: vi.fn(async () => [QUOTE]),
    createOrder: vi.fn(async () => ({ order: { id: ORDER } as SettleOrder, requests: [{ id: "a" }, { id: "d" }] })),
    getOrder: vi.fn(),
    listOrders: vi.fn(),
    getBond: vi.fn(),
    claimFromBond: vi.fn(async () => [{ id: "claim" }]),
    markDeposited: vi.fn(),
    ...over,
  } as unknown as SettleOnHederaClient & { quoteConnectors: ReturnType<typeof vi.fn>; createOrder: ReturnType<typeof vi.fn>; markDeposited: ReturnType<typeof vi.fn> };
}

describe("SettleFunding.plan", () => {
  it("funds the one shortfall from the same asset on another EVM network and describes it without English", async () => {
    const c = client();
    const f = new SettleFunding(c);
    const p = await f.plan([short([{ asset: USDC_SEP, amount: "400000000" }])], ME, NETWORKS);
    expect(c.quoteConnectors).toHaveBeenCalledWith({
      from: { networkId: "eip155:11155111", asset: USDC_SEP },
      to: { networkId: "eip155:84532", asset: USDC_BASE, amount: "13000000", recipient: ME },
      user: ME,
    });
    expect(p?.info).toEqual({
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
    });
    expect(p?.need).toEqual({ asset: USDC_BASE, amount: "25000000" });
  });

  it("stays out of the way: no account, two shortfalls, not enough elsewhere, no quote, a failing Connector", async () => {
    const f = new SettleFunding(client());
    const enough = [{ asset: USDC_SEP, amount: "400000000" }];
    expect(await f.plan([short(enough)], undefined, NETWORKS)).toBeNull();
    expect(await f.plan([short(enough), short(enough)], ME, NETWORKS)).toBeNull();
    expect(await f.plan([short([{ asset: USDC_SEP, amount: "1000" }])], ME, NETWORKS)).toBeNull();
    expect(await f.plan([short([{ asset: USDC_SEP, amount: "13000000" }])], ME, NETWORKS)).toBeNull(); // can't pay the fee too
    expect(await new SettleFunding(client({ quoteConnectors: vi.fn(async () => []) })).plan([short(enough)], ME, NETWORKS)).toBeNull();
    expect(await new SettleFunding(client({ quoteConnectors: vi.fn(async () => Promise.reject(new Error("down"))) })).plan([short(enough)], ME, NETWORKS)).toBeNull();
  });

  it("orders only a quote it planned, once; an expired one asks for a fresh look", async () => {
    const c = client();
    const f = new SettleFunding(c);
    await f.plan([short([{ asset: USDC_SEP, amount: "400000000" }])], ME, NETWORKS);
    const out = await f.order(ORDER, ME);
    expect(c.createOrder).toHaveBeenCalledWith(QUOTE, ME);
    expect(out.requests.map((r) => r.id)).toEqual(["a", "d"]);
    expect(out.need.amount).toBe("25000000");
    await expect(f.order(ORDER, ME)).rejects.toMatchObject({ code: "settle/offer-changed" });

    const expired = new SettleFunding(client({ createOrder: vi.fn(async () => Promise.reject(new ClipError("This offer has expired.", "quote-expired"))) }));
    await expired.plan([short([{ asset: USDC_SEP, amount: "400000000" }])], ME, NETWORKS);
    await expect(expired.order(ORDER, ME)).rejects.toMatchObject({ code: "settle/offer-changed" });
  });

  it("claims with claimDefault, or withdrawOwed when the order book could only credit the payout", async () => {
    const owed = vi.fn(async () => ({ requests: [{ id: "owed" }] }));
    const c = client({ getOrder: vi.fn(async () => ({ status: "defaulted" })), withdrawOwed: owed } as never);
    expect((await new SettleFunding(c).claim(ORDER, ME)).map((r) => r.id)).toEqual(["claim"]);
    const credited = client({ getOrder: vi.fn(async () => ({ status: "paid-from-bond", owedToYou: { asset: HBAR, amount: "1" }, refundTo: ME })), withdrawOwed: owed } as never);
    expect((await new SettleFunding(credited).claim(ORDER, ME)).map((r) => r.id)).toEqual(["owed"]);
  });
});

describe("stageOf", () => {
  const o = (status: SettleOrder["status"], extra: Partial<SettleOrder> = {}) => ({ status, ...extra });
  it("maps the order book and the arrival check to the approval's stages", () => {
    expect(stageOf(o("deposited"), false)).toBe("waiting");
    expect(stageOf(o("deposited", { claimableFrom: 1 }), false)).toBe("opened");
    expect(stageOf(o("deposited", { claimableFrom: 1 }), true)).toBe("delivered");
    expect(stageOf(o("settled"), false)).toBe("closed");
    expect(stageOf(o("defaulted"), false)).toBe("late");
    expect(stageOf(o("paid-from-bond"), false)).toBe("claimed");
    expect(stageOf(o("paid-from-bond", { owedToYou: { asset: HBAR, amount: "5" } }), false)).toBe("late");
    expect(stageOf(o("rejected"), false)).toBe("rejected");
  });
});
