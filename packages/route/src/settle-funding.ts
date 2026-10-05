/**
 * Settle on Hedera as a way to pay: when a payment on network X needs money the user holds on network Y, a bonded
 * Connector's quote becomes the plan's funding, and approving the payment pays the Connector on Y (exact-amount
 * approve + `SettleDeposit.deposit`). The wallet then follows the order on Hedera (mirror node) until the money
 * arrives on X, when the original request is shown again for signing, or until the deadline passes, when the user
 * claims cover + penalty from the Connector's bond on Hedera.
 *
 * This module is pure: it quotes, keeps the verified quote until the user approves, builds the requests and turns an
 * order's state into a stage. Signing, sending and the approval screen stay in the hosts (packages/engine and the
 * extension's background, through `SettleFundingRun` in @clip-wallet/engine/settle-funding).
 */
import type { AssetRef, DappRequest, Network } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { ConnectorQuote, SettleOnHederaClient, SettleOrder } from "./phase3.js";
import type { Shortfall } from "./types.js";

/** Where an order is, as the approval screen shows it. */
export type SettleStage =
  /** Quoted; nothing paid. Approve pays the Connector. */
  | "offer"
  /** The approve / deposit transactions are being signed and sent. */
  | "paying"
  /** Deposit sent; Hedera has not opened the order yet. */
  | "waiting"
  /** Hedera opened the order and reserved the cover. */
  | "opened"
  /** The money is on the payment's network (the original request can be signed). */
  | "delivered"
  /** Hedera recorded the delivery: the order is closed. */
  | "closed"
  /** The deadline passed without a proven delivery: cover + penalty can be claimed on Hedera. */
  | "late"
  /** The claim is being signed and sent. */
  | "claiming"
  /** Paid from the bond (claimed, or the Connector cancelled). */
  | "claimed"
  /** Hedera refused the order: no cover stands behind it. */
  | "rejected";

export interface SettleAmount {
  /** Base units. */
  amount: string;
  symbol: string;
  decimals: number;
}

/** What the approval screen needs to describe and follow a Connector order (no English sentences: the UI words it). */
export interface SettleFundingInfo {
  orderId: string;
  stage: SettleStage;
  /** Connector name (a proper name, never translated). */
  provider: string;
  /** What the user pays the Connector (fee included). */
  pay: SettleAmount;
  /** What the Connector delivers to the user on the payment's network. */
  receive: SettleAmount;
  fee: SettleAmount;
  /** Cover + penalty paid on Hedera if the Connector is late. */
  payback: SettleAmount;
  /** ERC-20: an exact-amount allowance comes first. */
  approveFirst: boolean;
  etaSeconds: number;
  /** Unix seconds: latest delivery. */
  deadline: number;
  /** Unix seconds (Hedera clock) from which the cover can be claimed, once the order is open. */
  claimableFrom?: number;
  /** The money arrived on the payment's network: the original request can be approved. */
  arrived?: boolean;
  /** The app stopped waiting for its request (timed out) while the order was under way. */
  appGone?: boolean;
  depositTx?: string;
  claimTx?: string;
}

export interface SettleFundingPlan {
  info: SettleFundingInfo;
  /** The asset and total amount the original request needs on its network (arrival check). */
  need: { asset: AssetRef; amount: string };
  /** Funding step for the plan (English; the UI words the steps from `info`). */
  step: { title: string; detail: string };
}

const amount = (a: { asset: AssetRef; amount: string }): SettleAmount => ({ amount: a.amount, symbol: a.asset.symbol, decimals: a.asset.decimals });

/**
 * Quotes, keeps and orders. One instance per wallet; `plan` is called by the route planner, `order` / `stage` by the
 * host when the user approves and while it follows the order.
 */
export class SettleFunding {
  private readonly quotes = new Map<string, { quote: ConnectorQuote; need: SettleFundingPlan["need"]; at: number }>();
  private readonly now: () => number;

  constructor(
    readonly client: SettleOnHederaClient & { markDeposited?(orderId: string, txHash: string): unknown },
    opts: { now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  /**
   * The best Connector quote that covers the payment's only shortfall, paid from the same asset on another EVM
   * network, delivered to `account`. Null when there is not exactly one shortfall, nothing to pay from, no Connector
   * answers or anything fails: the plan then stays as it was.
   */
  async plan(shortfalls: Shortfall[], account: string | undefined, networks: Network[]): Promise<SettleFundingPlan | null> {
    if (!account || shortfalls.length !== 1) return null;
    const s = shortfalls[0]!;
    if (!s.asset.networkId.startsWith("eip155:")) return null;
    const from = s.sameAssetElsewhere.find(
      (b) => b.asset.networkId.startsWith("eip155:") && networks.some((n) => n.id === b.asset.networkId) && BigInt(b.amount) >= BigInt(s.missing),
    );
    if (!from) return null;
    let q: ConnectorQuote | undefined;
    try {
      [q] = await this.client.quoteConnectors({
        from: { networkId: from.asset.networkId, asset: from.asset },
        to: { networkId: s.asset.networkId, asset: s.asset, amount: s.missing, recipient: account },
        user: account,
      });
    } catch {
      return null;
    }
    if (!q?.orderId) return null;
    // A quote the user can't pay from that balance is no help.
    if (BigInt(q.deposit.amount) > BigInt(from.amount)) return null;
    this.prune();
    const need = { asset: s.asset, amount: s.need };
    this.quotes.set(q.orderId.toLowerCase(), { quote: q, need, at: this.now() });
    const info: SettleFundingInfo = {
      orderId: q.orderId,
      stage: "offer",
      provider: q.name ?? "Connector",
      pay: amount(q.deposit),
      receive: amount(q.receive ?? { asset: s.asset, amount: s.missing }),
      fee: amount(q.fee),
      payback: amount(q.bond),
      approveFirst: !!q.deposit.asset.address,
      etaSeconds: q.deliveryP90S,
      deadline: q.deadline,
    };
    return {
      info,
      need,
      step: { title: q.title ?? `Get ${s.asset.symbol} from ${info.provider}`, detail: (q.steps ?? []).join(" · ") },
    };
  }

  /** Forget quotes older than an hour (an approval that was never answered). */
  private prune() {
    const cutoff = this.now() - 60 * 60_000;
    for (const [k, v] of this.quotes) if (v.at < cutoff) this.quotes.delete(k);
  }

  /** The approve + deposit requests for a quote `plan` returned. Throws "settle/offer-changed" when it can't be used. */
  async order(orderId: string, account: string): Promise<{ order: SettleOrder; requests: DappRequest[]; need: SettleFundingPlan["need"] }> {
    const hit = this.quotes.get(orderId.toLowerCase());
    if (!hit) throw new ClipError("This offer has expired. Check the new one and approve again.", "settle/offer-changed");
    try {
      const out = await this.client.createOrder(hit.quote, account);
      this.quotes.delete(orderId.toLowerCase());
      return { ...out, need: hit.need };
    } catch (e) {
      const code = e instanceof ClipError ? e.code : "";
      if (code === "quote-expired" || code === "stale-quote") {
        this.quotes.delete(orderId.toLowerCase());
        throw new ClipError("This offer has expired. Check the new one and approve again.", "settle/offer-changed", e);
      }
      throw e;
    }
  }

  markDeposited(orderId: string, txHash: string) {
    this.client.markDeposited?.(orderId, txHash);
  }

  /** The order on Hedera, as a stage. `arrived`: the money is already on the payment's network. */
  async stage(orderId: string, arrived: boolean): Promise<{ stage: SettleStage; order: SettleOrder }> {
    const order = await this.client.getOrder(orderId);
    return { stage: stageOf(order, arrived), order };
  }

  /**
   * The Hedera request(s) that pay the user from the bond: `claimDefault` while the order is open past its deadline,
   * or `withdrawOwed` when the order book already paid but could only credit the payout.
   */
  async claim(orderId: string, account: string): Promise<DappRequest[]> {
    const c = this.client as SettleOnHederaClient & {
      claimFromBond(id: string, account?: string): Promise<DappRequest[]>;
      withdrawOwed?(account: string): Promise<{ requests: DappRequest[] }>;
    };
    const order = await c.getOrder(orderId);
    if (order.status === "paid-from-bond" && order.owedToYou && c.withdrawOwed) return (await c.withdrawOwed(order.refundTo ?? account)).requests;
    return c.claimFromBond(orderId, account);
  }
}

/** Order status (and whether the money already arrived) → stage. */
export function stageOf(order: Pick<SettleOrder, "status" | "claimableFrom" | "owedToYou">, arrived: boolean): SettleStage {
  switch (order.status) {
    case "settled":
    case "delivered":
      return "closed";
    case "defaulted":
      return arrived ? "delivered" : "late";
    case "paid-from-bond":
    case "refunded":
      // Credited but not pushed (e.g. an HTS token the account isn't associated with): still to collect.
      return order.owedToYou ? "late" : "claimed";
    case "rejected":
      return "rejected";
    default:
      if (arrived) return "delivered";
      return order.claimableFrom !== undefined ? "opened" : "waiting";
  }
}

/** Stages after which nothing changes any more. */
export const SETTLE_FINAL_STAGES: ReadonlySet<SettleStage> = new Set(["closed", "claimed", "rejected"]);
