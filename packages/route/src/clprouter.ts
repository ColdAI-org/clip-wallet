/**
 * The CLPRouter planner, vendored.
 *
 * Why vendored: the SDK lives at github.com/ColdAI-org/clprouter (sdk/). A pnpm git dependency
 * `github:ColdAI-org/clprouter#564e29e…&path:/sdk` resolves and installs, but at that commit the package ships
 * only README.md and package.json: its `main`/`exports` point at an unbuilt `dist/`, `files` excludes `src/`, and
 * there is no `prepare` script to build it on install. Until the SDK publishes (or adds `prepare`), the
 * dependency-free planner core (types, graph, filters, metrics, quote, planner, yen) is copied verbatim into
 * ./vendor/clprouter-sdk with its MIT licence. The envelope/proto/on-chain parts (which pull in viem and
 * @noble/*) are not vendored; ./pay-on-hedera.ts builds `Router.send` calldata directly from the compiled ABI.
 *
 * To re-vendor: `git -C <clprouter> show <commit>:sdk/src/<file>.ts` for each file and bump CLPROUTER_SDK_COMMIT.
 */
export const CLPROUTER_SDK_COMMIT = "564e29e3b79e214a16bb23272d8c72787ebb90bf";

export * from "./vendor/clprouter-sdk/types.js";
export { RouteGraph, edgeId, isCaip2, normalizeLedgerId } from "./vendor/clprouter-sdk/graph.js";
export { activeFilters, certValid, ledgerFilterFailures } from "./vendor/clprouter-sdk/filters.js";
export type { ActiveFilters } from "./vendor/clprouter-sdk/filters.js";
export type { HopQuote, HopCost, HopCarbon, EmissionsFigure } from "./vendor/clprouter-sdk/metrics.js";
export { buildRouteQuote } from "./vendor/clprouter-sdk/quote.js";
export type { RouteQuote, EmissionsSource } from "./vendor/clprouter-sdk/quote.js";
export { DEFAULT_MAX_HOPS, paretoSet, plan } from "./vendor/clprouter-sdk/planner.js";
export type { PlanFailure, PlanResult, PlanSuccess, FallbackRoute } from "./vendor/clprouter-sdk/planner.js";
