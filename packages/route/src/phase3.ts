import type { AssetRef, DappRequest, NetworkId } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import { SettleClient } from "./settle.js";
import type { SettleQuoteJson } from "./settle-quote.js";

/**
 * Phase 3: "settle on Hedera". The user pays a bonded Connector on network Y (`SettleDeposit`), the Connector
 * delivers on network X (`SettleDelivery`), both are proven over CLPR to `SettleOrderBook` on Hedera; if the
 * Connector misses the deadline the user is paid cover + penalty from its bond on Hedera.
 *
 * `settleOnHedera()` without options rejects every call with ClipError("Not available yet", "phase3").
 * `settleOnHedera(options)` returns the real client
 * (./settle.ts) for a given order book, Deposit contracts and Connector directory.
 */

export type OrderStatus =
  | "quoted"
  | "awaiting-deposit"
  | "deposited"
  | "delivered"
  | "settled"
  | "defaulted"
  | "paid-from-bond"
  | "refunded"
  /** The order book refused the deposit (unknown Connector or a quote it didn't sign): no cover. */
  | "rejected";

export interface ConnectorQuoteRequest {
  /** Where the user pays (Deposit). */
  from: { networkId: NetworkId; asset: AssetRef };
  /** Where the Connector delivers (Delivery). */
  to: { networkId: NetworkId; asset: AssetRef; amount: string; recipient: string };
  /** Latest acceptable delivery, unix seconds. */
  deadline?: number;
  /** The paying account on `from` (0x address). Required by the real client. */
  user?: string;
  /** The user's account on Hedera's EVM that is paid on default. Default: `user` (same key, same 0x address). */
  refundTo?: string;
}

export interface ConnectorQuote {
  connectorId: string;
  name?: string;
  /** What the user deposits on `from`, fee included. */
  deposit: { asset: AssetRef; amount: string };
  fee: { asset: AssetRef; amount: string };
  /** Bond backing this order on Hedera: what the user is paid on default (cover + penalty). */
  bond: { asset: AssetRef; amount: string };
  deliveryP90S: number;
  deadline: number;
  expiresAt: number;
  // ── Additive (Phase 3 client) ──
  /** EIP-712 digest of the signed quote: the order id on every chain. */
  orderId?: string;
  from?: NetworkId;
  to?: NetworkId;
  /** What the Connector delivers. */
  receive?: { asset: AssetRef; amount: string; recipient: string };
  /** Cover before the penalty, and cover + penalty (`owedOnDefault`), in the bond asset. */
  cover?: { asset: AssetRef; amount: string; owedOnDefault: string };
  /** Plain-language strings for a confirm screen. */
  title?: string;
  display?: { deposit: string; fee: string; receive: string; cover: string; time: string; deadline: string };
  steps?: string[];
  warnings?: string[];
  /** The Connector's signed quote, verified by the client. */
  signed?: { quote: SettleQuoteJson; signature: string };
}

export interface SettleOrder {
  id: string;
  quote: ConnectorQuote;
  account: string;
  status: OrderStatus;
  depositTx?: string;
  deliveryTx?: string;
  settlementTx?: string;
  /** Unix seconds. */
  createdAt: number;
  // ── Additive (Phase 3 client) ──
  /** Plain words for the activity screen. */
  statusText?: string;
  /** Hedera account paid on default. */
  refundTo?: string;
  /** cover + penalty promised, and what the bond actually reserved for it (base units of the bond asset). */
  owedOnDefault?: string;
  reserved?: string;
  /** Unix seconds (Hedera clock) from which `claimFromBond` works, while the order is open. */
  claimableFrom?: number;
  /** A payout the order book could not push and holds for the user (`withdrawOwed`). */
  owedToYou?: { asset: AssetRef; amount: string };
  /** True when only Hedera knows this order (found in its logs): deposit and fee amounts are unknown. */
  onChainOnly?: boolean;
}

export interface ConnectorBond {
  connectorId: string;
  asset: AssetRef;
  amount: string;
  /** Committed to open orders. */
  locked: string;
  /** Not tracked by the order book; the client reports "0". */
  slashed: string;
  // ── Additive ──
  /** Requested for withdrawal (stops backing new orders; still drawable by orders proven before it executes). */
  pendingWithdrawal?: string;
  withdrawReadyAt?: number;
  /** What new orders can still reserve. */
  free?: string;
  /** Orders opened with less cover reserved than promised. */
  shortfalls?: number;
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

/** A Connector the wallet asks for quotes. */
export interface ConnectorDirectoryEntry {
  /** Connector id: its account on Hedera's EVM, registered in the order book. */
  id: string;
  name: string;
  /** Base URL of its quote API (`POST {url}/quote`, `GET {url}/info`). */
  url: string;
}

export interface CoverAssetConfig {
  /** Order-book form: address(0) = HBAR (tinybars), else the HTS token's EVM address (ERC-20 facade). */
  address: `0x${string}`;
  asset: AssetRef;
}

export interface SettleOnHederaOptions {
  /** "testnet" (default) or "mainnet" (Hedera chain id 295 only). */
  network?: "testnet" | "mainnet";
  /** `SettleOrderBook` on Hedera's EVM. */
  orderBook: `0x${string}`;
  /** Hedera's EVM chain id: 296 testnet, 295 mainnet. Part of every order id. */
  hederaChainId: number;
  /** Network id for Hedera EVM requests (claim, withdraw). Default `eip155:<hederaChainId>`. */
  hederaNetworkId?: NetworkId;
  /** Mirror node base URL (primary read path). */
  mirrorNodeUrl?: string;
  /** Hedera JSON-RPC relay URL (used when no mirror node is given; no log listing). */
  jsonRpcUrl?: string;
  /** `SettleDeposit` contract per source network (CAIP-2 eip155 id). */
  deposits: Record<NetworkId, `0x${string}`>;
  connectors: readonly ConnectorDirectoryEntry[];
  /** Bond assets the wallet accepts as cover, with how to show them. */
  coverAssets: readonly CoverAssetConfig[];
  fetch?: typeof fetch;
  /** Wall clock, ms (tests). Default Date.now. */
  now?: () => number;
  /** Per-Connector quote timeout, ms. Default 8000. */
  quoteTimeoutMs?: number;
  /** A quote must stay valid at least this long after it arrives, seconds. Default 60. */
  minQuoteLifetimeS?: number;
  /** createOrder refuses a quote that expires within this many seconds. Default 30. */
  depositMarginS?: number;
  /** How far back listOrders searches Hedera's logs, days. Default 28. */
  logLookbackDays?: number;
}

/**
 * Known "settle on Hedera" deployments. Testnet (v2, over the rotating v2 Sepolia -> Hedera Channel; the v1 order book
 * 0xB7C8…e895 is retired): CLPRouter `deployments/README.md` ("Settle on Hedera (testnet)",
 * branch feat/settle-testnet): SettleOrderBook on Hedera testnet, SettleDeposit on Sepolia, and the test Connector,
 * whose reference service runs locally (`script/deploy/settle-connector.sh serve`, 127.0.0.1:8787).
 */
export interface SettleDeployment {
  network: "testnet" | "mainnet";
  hederaChainId: number;
  orderBook: `0x${string}`;
  deposits: Record<NetworkId, `0x${string}`>;
  connectors: ConnectorDirectoryEntry[];
}
export const SETTLE_DEPLOYMENTS: readonly SettleDeployment[] = [
  {
    network: "testnet",
    hederaChainId: 296,
    orderBook: "0x28c14e4BAd929e27902149674CCe79b34E5b8B1f",
    deposits: { "eip155:11155111": "0x86ED95936E516742cC4d54657f66831775282875" },
    connectors: [{ id: "0x316323692104293b58366e6Bc66a796B919108E7", name: "Clip testnet Connector", url: "http://127.0.0.1:8787" }],
  },
];

const notYet = async (): Promise<never> => {
  throw new ClipError("Not available yet", "phase3");
};

/**
 * Without options: the placeholder, every call rejects with ClipError("Not available yet", "phase3").
 * With options: the client for that order book.
 */
export function settleOnHedera(): SettleOnHederaClient;
export function settleOnHedera(options: SettleOnHederaOptions): SettleClient;
export function settleOnHedera(options?: SettleOnHederaOptions): SettleOnHederaClient {
  if (options) return new SettleClient(options);
  return {
    quoteConnectors: notYet,
    createOrder: notYet,
    getOrder: notYet,
    listOrders: notYet,
    getBond: notYet,
    claimFromBond: notYet,
  };
}
