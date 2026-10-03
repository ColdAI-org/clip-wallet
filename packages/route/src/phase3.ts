import type { AssetRef, DappRequest, NetworkId } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";

/**
 * Phase 3: "settle on Hedera". The user pays a bonded Connector on network Y (Deposit), the Connector delivers on
 * network X (Delivery), both are proven to an order contract on Hedera; if the Connector misses the deadline the
 * user is paid from its bond. The order contract doesn't exist yet, so every method rejects with
 * ClipError("Not available yet", "phase3"). The types are here so screens and the harness can be built against them.
 */

export type OrderStatus =
  | "quoted"
  | "awaiting-deposit"
  | "deposited"
  | "delivered"
  | "settled"
  | "defaulted"
  | "paid-from-bond"
  | "refunded";

export interface ConnectorQuoteRequest {
  /** Where the user pays (Deposit). */
  from: { networkId: NetworkId; asset: AssetRef };
  /** Where the Connector delivers (Delivery). */
  to: { networkId: NetworkId; asset: AssetRef; amount: string; recipient: string };
  /** Latest acceptable delivery, unix seconds. */
  deadline?: number;
}

export interface ConnectorQuote {
  connectorId: string;
  name?: string;
  /** What the user deposits on `from`, fee included. */
  deposit: { asset: AssetRef; amount: string };
  fee: { asset: AssetRef; amount: string };
  /** Bond backing this order on Hedera. */
  bond: { asset: AssetRef; amount: string };
  deliveryP90S: number;
  deadline: number;
  expiresAt: number;
}

export interface SettleOrder {
  id: string;
  quote: ConnectorQuote;
  account: string;
  status: OrderStatus;
  depositTx?: string;
  deliveryTx?: string;
  settlementTx?: string;
  createdAt: number;
}

export interface ConnectorBond {
  connectorId: string;
  asset: AssetRef;
  amount: string;
  /** Committed to open orders. */
  locked: string;
  slashed: string;
}

export interface SettleOnHederaClient {
  quoteConnectors(req: ConnectorQuoteRequest): Promise<ConnectorQuote[]>;
  /** The Deposit transaction(s) the wallet must approve. */
  createOrder(quote: ConnectorQuote, account: string): Promise<{ order: SettleOrder; requests: DappRequest[] }>;
  getOrder(orderId: string): Promise<SettleOrder>;
  listOrders(account: string): Promise<SettleOrder[]>;
  getBond(connectorId: string): Promise<ConnectorBond>;
  /** After a missed deadline: the claim the wallet must approve to be paid from the bond. */
  claimFromBond(orderId: string): Promise<DappRequest[]>;
}

const notYet = async (): Promise<never> => {
  throw new ClipError("Not available yet", "phase3");
};

/** Phase 3 placeholder: every call rejects with ClipError("Not available yet", "phase3"). */
export function settleOnHedera(): SettleOnHederaClient {
  return {
    quoteConnectors: notYet,
    createOrder: notYet,
    getOrder: notYet,
    listOrders: notYet,
    getBond: notYet,
    claimFromBond: notYet,
  };
}
