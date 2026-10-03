import type { AssetRef, DappRequest, NetworkId, TokenBalance } from "@clip-wallet/core";
import type { Mode, RouteGraphData, RouteQuote, TrustTier } from "./clprouter.js";
import type { RouterDeployment } from "./deployments.js";

/** Same names as the CLPRouter planner modes. */
export type RouteMode = Mode;

/** Routing filters a wallet (clip.config.ts `route.filters`) or a user can set. All optional. */
export interface RouteFilters {
  /** Only networks certified for ISO 20022 messaging. */
  iso20022?: boolean;
  /** Only networks with a MiCA white paper and an authorised operator. */
  mica?: boolean;
  /** Only networks with a certified energy figure, optionally capped (kgCO2e per transaction). */
  energy?: boolean | { capKgPerTx?: number };
  /** Weakest verification the user accepts on any hop. */
  trustFloor?: TrustTier;
  maxHops?: number;
  /** Give up on routes slower than this (p90 seconds). */
  deadlineS?: number;
  /** ISO 3166-1 alpha-2 codes to avoid. */
  excludedJurisdictions?: string[];
}

/** One thing a request needs: `amount` base units of `asset` on `asset.networkId`. */
export interface Need {
  asset: AssetRef;
  amount: string;
}

export interface Shortfall {
  asset: AssetRef;
  need: string;
  have: string;
  /** need - have, base units. Always > 0 in findShortfall's result. */
  missing: string;
  /** Balances of the same asset (same key, not a bridged copy) on other networks: the first funding candidates. */
  sameAssetElsewhere: TokenBalance[];
  /** Other balances on other networks the user could route from (anything with a positive amount). */
  otherBalances: TokenBalance[];
}

export interface QuoteRequest {
  /** Where the money is needed. Phase 1: a Hedera network. */
  to: NetworkId;
  /** The asset the dapp wants, on `to`. */
  asset: AssetRef;
  /** Base units of `asset`. */
  amount: string;
  mode?: RouteMode;
  filters?: RouteFilters;
  /** Source networks to consider. Default: every network with a Router deployment except `to`. */
  from?: NetworkId[];
  /** When given, sources the user holds nothing on are skipped. */
  portfolio?: TokenBalance[];
  /** Evaluation time (tests). */
  now?: Date;
}

export interface QuoteStep {
  /** Plain words, e.g. "Send 0.0104 ETH from Ethereum". */
  text: string;
  networkId: NetworkId;
}

/** A route in plain language. Everything a confirm screen needs, plus `route` for Advanced mode. */
export interface Quote {
  /** Stable id of the route (its edge ids). */
  id: string;
  from: NetworkId;
  to: NetworkId;
  mode: RouteMode;
  /** "Pay 25 HBAR on Hedera with ETH from Ethereum". */
  title: string;
  /** What leaves the user's balance on `from` (amount + fee), in the source network's coin. */
  youPay: { asset: AssetRef; amount: string; display: string };
  /** The part of `youPay` that goes to the payee once delivery is proven. */
  escrow: { asset: AssetRef; amount: string; display: string };
  /** Route fees, as an asset amount in the source network's coin, plus a USD estimate. */
  fee: { asset: AssetRef; amount: string; display: string; usd: number };
  /** p90 delivery time. */
  time: { p90Seconds: number; display: string };
  carbon: { kgCO2e: number; display: string };
  /** The weakest verification on the route (a route is only as strong as its weakest hop). */
  trust: { tier: TrustTier; display: string };
  successProbability: number;
  steps: QuoteStep[];
  warnings: string[];
  /** True when any hop or the way back relies on a test-only verifier (allowed on testnet only). */
  usesTestVerifier: boolean;
  /** True when figures behind this quote are placeholders. */
  estimated: boolean;
  /** Raw planner output (Advanced mode). */
  route: RouteQuote;
}

export interface RouteClientOptions {
  /** "testnet" (default) or "mainnet". Mainnet refuses routes that rely on test or stub verifiers. */
  network?: "testnet" | "mainnet";
  /** Route graph, or a loader for one (e.g. the CLPRouter quote service's live graph). Default: testnetGraph(). */
  graph?: RouteGraphData | (() => Promise<RouteGraphData>);
  /** Router deployments. Default: TESTNET_DEPLOYMENTS. */
  deployments?: readonly RouterDeployment[];
  /** Native coin of each source network, used to express fees. Defaults cover the testnet deployment. */
  nativeAssets?: Record<NetworkId, AssetRef>;
  /** USD prices by asset key, to convert a payment into the source coin. Defaults to the graph's native prices. */
  prices?: Record<string, number>;
  /** Allow Channels that are not open yet (status `projected`). Off by default: a payment on such a route waits and is refunded only after its deadline. */
  allowNotYetOpen?: boolean;
  /** CLPRouter status API base URL (services/ GET /routes/:routeId). */
  statusApiUrl?: string;
  fetch?: typeof fetch;
}

export interface PayOnHederaInput {
  quote: Quote;
  /** The EVM account paying, on `quote.from`. */
  from: { address: string };
  /** Who is paid on Hedera: 0.0.x or an EVM address. */
  recipient: string;
  /** Application contract on Hedera the route is delivered to. */
  destinationApp: `0x${string}`;
  /** Address on the source network that receives the escrow once delivery on Hedera is proven. */
  payee: `0x${string}`;
  /** Application data. Default: abi.encode(recipient CAIP-10, asset key, amount). */
  payload?: `0x${string}`;
  /** Seconds until the route expires and can be refunded. Default: 2 × p90, at least 10 minutes. */
  deadlineS?: number;
  now?: Date;
}

export interface PayOnHederaPlan {
  /** What the wallet must approve, in order. Each goes through the normal decode/approve path. */
  requests: DappRequest[];
  summary: string;
  router: `0x${string}`;
  /** msg.value = escrow + fee budget (base units of the source coin). */
  value: string;
  escrow: string;
  feeBudget: string;
  /** Unix seconds. */
  deadline: number;
}
