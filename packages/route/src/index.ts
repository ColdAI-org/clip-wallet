/**
 * @clip-wallet/route — "Route and fund".
 *
 * Phase 1: pay on Hedera from any EVM network with a CLPRouter (CLPR proofs only run chain -> Hedera today).
 *  - findShortfall: what a request needs that the user doesn't hold where it's needed.
 *  - RouteClient.quote: plain-language quotes (fee as an asset amount, p90 time, kgCO2e, weakest trust tier, steps).
 *  - RouteClient.planPayOnHedera: the Router.send request the wallet must approve.
 *  - RouteClient.trackRoute: plain-language progress from the CLPRouter status API.
 * Phase 3 (settle on Hedera through bonded Connectors): ./phase3 (types, settleOnHedera) and ./settle (client).
 * `settleOnHedera()` without options is still the "Not available yet" placeholder: nothing is deployed yet.
 */
export { RouteClient, createRouteClient, hederaRecipientToEvm, DEFAULT_NATIVE_ASSETS } from "./client.js";
export { findShortfall, needsFromDecoded } from "./shortfall.js";
export { RouteStatusClient, describeRoute, trackRoute } from "./track.js";
export type { HopStatus, OutcomeStatus, RouteProgress, RouteStage, RouteStatusResponse, TrackOptions } from "./track.js";
export { settleOnHedera, SETTLE_DEPLOYMENTS } from "./phase3.js";
export type {
  ConnectorBond,
  ConnectorDirectoryEntry,
  ConnectorQuote,
  ConnectorQuoteRequest,
  CoverAssetConfig,
  OrderStatus,
  SettleDeployment,
  SettleOnHederaClient,
  SettleOnHederaOptions,
  SettleOrder,
} from "./phase3.js";
export { SettleClient, ON_CHAIN_STATUS, compareConnectorQuotes, describeOrder } from "./settle.js";
export type { ConnectorQuoteResponse, OnChainOrder, OnChainStatus } from "./settle.js";
export {
  SETTLE_QUOTE_TYPES,
  addressToBytes32,
  buildDepositRequests,
  bytes32ToAddress,
  ledgerHash,
  quoteFromJson,
  quoteToJson,
  recoverQuoteSigner,
  settleDomain,
  settleOrderId,
} from "./settle-quote.js";
export type { SettleQuote, SettleQuoteJson } from "./settle-quote.js";
export { JsonRpcReader, MirrorNodeReader } from "./settle-reader.js";
export type { HederaReader, LogQuery, RawLog } from "./settle-reader.js";
export { SETTLE_DEPOSIT_ABI, SETTLE_DEPOSIT_SELECTOR, SETTLE_ORDER_BOOK_ABI } from "./settle-abi.js";
export { isTestVerifier, testVerifierEdges } from "./safety.js";
export { testnetGraph } from "./graph.js";
export * from "./deployments.js";
export { CLPR_ROUTER_ABI } from "./abi.js";
export { formatUnits, parseUnits, formatDuration, formatCarbon } from "./format.js";
export { CLPROUTER_SDK_COMMIT, plan } from "./clprouter.js";
export type { Mode, RouteGraphData, RouteQuote, TrustTier, Edge, Ledger } from "./clprouter.js";
export type * from "./types.js";
