import type { Edge, RouteGraphData, RouteQuote } from "./clprouter.js";
import { edgeId } from "./clprouter.js";

/**
 * Verifier families a mainnet route may use (audit ROUTE-01): an explicit, exact-match allowlist of families whose
 * on-chain verifiers have been reviewed. A family is never trusted for what its name looks like, so a fetched graph
 * can't make a stub pass by naming it "zk-light-client". Adding a family is a reviewed change here, not a config switch.
 *  - ethereum-sync-committee: Ethereum's sync-committee light client (EthMainnetVerifier), CLPR Phase 1.
 */
export const MAINNET_VERIFIER_FAMILIES: ReadonlySet<string> = new Set(["ethereum-sync-committee"]);

/** A provider's own warning on an edge (the bundled graph marks its stub "TEST ONLY"). */
const FLAGGED_NOTES = /TEST ONLY|INSECURE/i;

/** True when the edge's verifier is on the mainnet allowlist and the graph doesn't flag it. */
export function isMainnetVerifier(edge: Pick<Edge, "verifierFamily" | "notes">): boolean {
  return MAINNET_VERIFIER_FAMILIES.has(edge.verifierFamily) && !FLAGGED_NOTES.test(edge.notes ?? "");
}

/**
 * A verifier mainnet may not rely on: a test fixture or stub, or any family not on the allowlist. Allowed on testnet
 * only, where quotes say so (`usesTestVerifier`).
 */
export function isTestVerifier(edge: Pick<Edge, "verifierFamily" | "notes">): boolean {
  return !isMainnetVerifier(edge);
}

/**
 * Edges a route depends on that use a test or stub verifier: every hop, and the way back (the reverse direction of
 * each hop's Channel), because a delivery receipt that never verifies means the route only settles by refund.
 */
export function testVerifierEdges(route: RouteQuote, graph: RouteGraphData): string[] {
  const hits: string[] = [];
  for (const hop of route.hops) {
    const forward = graph.edges.find((e) => edgeId(e) === hop.edgeId);
    if (forward && isTestVerifier(forward)) hits.push(hop.edgeId);
    else if (!forward && isTestVerifier({ verifierFamily: hop.verifierFamily })) hits.push(hop.edgeId);
    const back = graph.edges.find((e) => e.channelId === hop.channelId && e.from === hop.to && e.to === hop.from);
    if (back && isTestVerifier(back)) hits.push(edgeId(back));
  }
  return [...new Set(hits)];
}
