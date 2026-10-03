/**
 * @clip-wallet/route — "Route and fund".
 *
 * Phase 1: pay on Hedera from any EVM network with a CLPRouter (CLPR proofs only run chain -> Hedera today).
 *  - findShortfall: what a request needs that the user doesn't hold where it's needed.
 *  - RouteClient.quote: plain-language quotes (fee as an asset amount, p90 time, kgCO2e, weakest trust tier, steps).
 *  - RouteClient.planPayOnHedera: the Router.send request the wallet must approve.
 *  - RouteClient.trackRoute: plain-language progress from the CLPRouter status API.
 * Phase 3 (settle on Hedera through bonded Connectors) is typed in ./phase3 and not available yet.
 */
export { RouteClient, createRouteClient, hederaRecipientToEvm, DEFAULT_NATIVE_ASSETS } from "./client.js";
export { findShortfall, needsFromDecoded } from "./shortfall.js";
export { RouteStatusClient, describeRoute, trackRoute } from "./track.js";
export type { HopStatus, OutcomeStatus, RouteProgress, RouteStage, RouteStatusResponse, TrackOptions } from "./track.js";
export { settleOnHedera } from "./phase3.js";
export type {
  ConnectorBond,
  ConnectorQuote,
  ConnectorQuoteRequest,
  OrderStatus,
  SettleOnHederaClient,
  SettleOrder,
} from "./phase3.js";
export { isTestVerifier, testVerifierEdges } from "./safety.js";
export { testnetGraph } from "./graph.js";
export * from "./deployments.js";
export { CLPR_ROUTER_ABI } from "./abi.js";
export { formatUnits, parseUnits, formatDuration, formatCarbon } from "./format.js";
export { CLPROUTER_SDK_COMMIT, plan } from "./clprouter.js";
export type { Mode, RouteGraphData, RouteQuote, TrustTier, Edge, Ledger } from "./clprouter.js";
export type * from "./types.js";
