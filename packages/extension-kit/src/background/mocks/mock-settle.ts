/**
 * MOCK "settle on Hedera" Connector + order book for fixture builds (CLIP_MOCKS=1). It answers like
 * @clip-wallet/route's SettleClient (verified quotes, the real approve + deposit encoding, order states, claim) on a
 * timeline, so the dev simulator's "settle" and "settle-late" requests run the real host flow
 * (@clip-wallet/engine/settle-funding) without any network. Nothing here signs; the vault signs the requests.
 */
import type { AssetRef, DappRequest, Network } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import { HEDERA_EVM_NETWORKS } from "@clip-wallet/chains-evm";
import {
  SETTLE_ORDER_BOOK_ABI,
  addressToBytes32,
  buildDepositRequests,
  ledgerHash,
  quoteToJson,
  routerLedgerId,
  settleOrderId,
  type ConnectorBond,
  type ConnectorQuote,
  type ConnectorQuoteRequest,
  type SettleOnHederaClient,
  type SettleOrder,
  type SettleQuote,
} from "@clip-wallet/route";
import { encodeFunctionData, getAddress, type Hex } from "viem";
import { MOCK_BALANCES } from "./fixtures";

/** What the next simulated Connector order does: deliver, or miss its deadline. "off": no Connector answers. */
export const settleFixture: { mode: "off" | "deliver" | "late" } = { mode: "off" };

export const MOCK_ORDER_BOOK = "0x00000000000000000000000000000000005e771e" as const;
export const MOCK_DEPOSIT = "0x00000000000000000000000000000000de9051d1" as const;
export const MOCK_CONNECTOR = "0x000000000000000000000000000000000c0ec7a2" as const;
/** Request-only network for the claim (Hedera's EVM), as the real wiring adds it. */
export const MOCK_HEDERA_EVM: Network = HEDERA_EVM_NETWORKS.find((n) => n.testnet)!;
const HBAR: AssetRef = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: MOCK_HEDERA_EVM.id };
/** Not a real signature: the mock order book doesn't check it (65 bytes so the encoding is the real one). */
const MOCK_SIG = `0x${"11".repeat(64)}1b` as Hex;

/** Deliveries the mock credited to the fixture balances, so tests can undo them. */
const credits: { networkId: string; key: string; address: string; amount: bigint }[] = [];

/** Undo the mock deliveries (tests that run several orders in one process). */
export function resetMockSettleCredits() {
  for (const c of credits.splice(0)) {
    const hit = MOCK_BALANCES[c.networkId]?.find((b) => b.asset.key === c.key && (b.asset.address ?? "") === c.address);
    if (hit) hit.amount = (BigInt(hit.amount) - c.amount).toString();
  }
}

/** ms after the deposit: Hedera opens the order, the money arrives, Hedera closes it (or the deadline passes). */
const T_OPEN = 600;
const T_ARRIVE = 1500;
const T_CLOSE = 2600;

interface MockOrder {
  quote: ConnectorQuote;
  raw: SettleQuote;
  mode: "deliver" | "late";
  account: string;
  depositedAt?: number;
  credited?: boolean;
  claimed?: boolean;
}

export class MockSettleClient implements SettleOnHederaClient {
  private readonly orders = new Map<string, MockOrder>();
  private readonly quoted = new Map<string, MockOrder>();

  async quoteConnectors(req: ConnectorQuoteRequest): Promise<ConnectorQuote[]> {
    if (settleFixture.mode === "off" || !req.user) throw new ClipError("No Connector can take this order right now.", "settle-no-quotes");
    const amountOut = BigInt(req.to.amount);
    const fee = (amountOut * 40n) / 10_000n; // 0.4 %
    const amountIn = amountOut + fee;
    const now = Math.floor(Date.now() / 1000);
    const raw: SettleQuote = {
      connector: getAddress(MOCK_CONNECTOR),
      srcLedger: ledgerHash(routerLedgerId(req.from.networkId)),
      depositApp: addressToBytes32(MOCK_DEPOSIT),
      user: addressToBytes32(req.user),
      payTo: addressToBytes32(MOCK_CONNECTOR),
      assetIn: addressToBytes32(req.from.asset.address ?? "0x0000000000000000000000000000000000000000"),
      amountIn,
      dstLedger: ledgerHash(routerLedgerId(req.to.networkId)),
      assetOut: addressToBytes32(req.to.asset.address ?? "0x0000000000000000000000000000000000000000"),
      recipient: addressToBytes32(req.to.recipient),
      amountOut,
      coverAsset: "0x0000000000000000000000000000000000000000",
      coverAmount: 18_000_000_000n,
      refundTo: getAddress(req.user),
      issuedAt: BigInt(now),
      expiry: BigInt(now + 600),
      deadline: BigInt(now + 1800),
      salt: `0x${"5a".repeat(32)}`,
    };
    const orderId = settleOrderId(raw, 296, MOCK_ORDER_BOOK);
    const quote: ConnectorQuote = {
      connectorId: getAddress(MOCK_CONNECTOR),
      name: "Clip test Connector",
      deposit: { asset: req.from.asset, amount: amountIn.toString() },
      fee: { asset: req.from.asset, amount: fee.toString() },
      bond: { asset: HBAR, amount: "19800000000" },
      deliveryP90S: 90,
      deadline: Number(raw.deadline),
      expiresAt: Number(raw.expiry),
      orderId,
      from: req.from.networkId,
      to: req.to.networkId,
      receive: { asset: req.to.asset, amount: amountOut.toString(), recipient: req.to.recipient },
      cover: { asset: HBAR, amount: raw.coverAmount.toString(), owedOnDefault: "19800000000" },
      title: `Get ${req.to.asset.symbol} from Clip test Connector`,
      steps: [],
      signed: { quote: quoteToJson(raw), signature: MOCK_SIG },
    };
    this.quoted.set(orderId, { quote, raw, mode: settleFixture.mode, account: req.user });
    return [quote];
  }

  async createOrder(quote: ConnectorQuote, account: string): Promise<{ order: SettleOrder; requests: DappRequest[] }> {
    const o = this.quoted.get(quote.orderId!);
    if (!o) throw new ClipError("This offer hasn't been checked. Get a new quote and try again.", "stale-quote");
    this.orders.set(quote.orderId!, o);
    const requests = buildDepositRequests({ quote: o.raw, signature: MOCK_SIG, account, networkId: quote.from!, depositApp: MOCK_DEPOSIT });
    return { order: { id: quote.orderId!, quote, account, status: "awaiting-deposit", createdAt: Math.floor(Date.now() / 1000) }, requests };
  }

  markDeposited(orderId: string) {
    const o = this.orders.get(orderId);
    if (o) o.depositedAt = Date.now();
  }

  async getOrder(orderId: string): Promise<SettleOrder> {
    const o = this.orders.get(orderId);
    if (!o) throw new ClipError("We can't find this order on Hedera yet.", "order-not-found");
    const base: SettleOrder = { id: orderId, quote: o.quote, account: o.account, status: "awaiting-deposit", createdAt: 0 };
    if (o.depositedAt === undefined) return base;
    const t = Date.now() - o.depositedAt;
    if (o.claimed) return { ...base, status: "paid-from-bond" };
    if (t < T_OPEN) return { ...base, status: "deposited" };
    const open = { ...base, status: "deposited" as const, claimableFrom: o.quote.deadline + 1 };
    if (o.mode === "late") return t < T_ARRIVE ? open : { ...base, status: "defaulted" };
    if (t >= T_ARRIVE && !o.credited) {
      // The Connector's delivery: the money shows up in the fixture balance on the payment's network.
      o.credited = true;
      const asset = o.quote.receive!.asset;
      const list = (MOCK_BALANCES[asset.networkId] ??= []);
      const hit = list.find((b) => b.asset.key === asset.key && (b.asset.address ?? "") === (asset.address ?? ""));
      if (hit) hit.amount = (BigInt(hit.amount) + BigInt(o.quote.receive!.amount)).toString();
      else list.push({ asset, amount: o.quote.receive!.amount });
      credits.push({ networkId: asset.networkId, key: asset.key, address: asset.address ?? "", amount: BigInt(o.quote.receive!.amount) });
    }
    return t < T_CLOSE ? open : { ...base, status: "settled" };
  }

  async listOrders(): Promise<SettleOrder[]> {
    return Promise.all([...this.orders.keys()].map((id) => this.getOrder(id)));
  }

  async getBond(connectorId: string): Promise<ConnectorBond> {
    return { connectorId, asset: HBAR, amount: "50000000000", locked: "0", slashed: "0" };
  }

  async claimFromBond(orderId: string, account?: string): Promise<DappRequest[]> {
    const o = this.orders.get(orderId);
    if (!o) throw new ClipError("This order isn't open on Hedera yet, so there's nothing to claim.", "claim-not-open");
    o.claimed = true;
    return [
      {
        id: `settle-${crypto.randomUUID()}`,
        origin: "clip-wallet://route",
        via: "injected",
        family: "evm",
        networkId: MOCK_HEDERA_EVM.id,
        method: "eth_sendTransaction",
        params: [{ from: account ?? o.account, to: MOCK_ORDER_BOOK, data: encodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, functionName: "claimDefault", args: [orderId as Hex] }), value: "0x0" }],
      },
    ];
  }
}
