import type { Edge, RouteGraphData, RouteQuote } from "./clprouter.js";
import { edgeId } from "./clprouter.js";

const TEST_VERIFIER = /test|stub|mock|fake|e2e|dummy|insecure/i;

/** A verifier that proves nothing: test fixtures and stubs. Allowed on testnet only. */
export function isTestVerifier(edge: Pick<Edge, "verifierFamily" | "notes">): boolean {
  return TEST_VERIFIER.test(edge.verifierFamily) || /TEST ONLY|INSECURE/.test(edge.notes ?? "");
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
    else if (!forward && TEST_VERIFIER.test(hop.verifierFamily)) hits.push(hop.edgeId);
    const back = graph.edges.find((e) => e.channelId === hop.channelId && e.from === hop.to && e.to === hop.from);
    if (back && isTestVerifier(back)) hits.push(edgeId(back));
  }
  return [...new Set(hits)];
}
