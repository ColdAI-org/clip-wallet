import type { ChainContext, DappRequest, Network, Signature } from "@clip-wallet/core";
import { FUEL_TESTNET } from "../src/index.js";
import { ACCOUNT0, account } from "./fixtures.js";

export type Handler = (variables: Record<string, any>, query: string) => unknown;

export interface Call {
  url: string;
  op: string;
  variables: Record<string, any>;
}

/**
 * Fake fuel-core: GraphQL operations are routed by operation name ("getChain", "dryRun", …); `sse` answers the
 * submitAndAwaitStatus stream on `<url>-sub` with the given events. A handler may return `{ errors }` itself.
 */
export function fakeNode(routes: Record<string, Handler | object>, sse?: unknown[] | ((variables: Record<string, any>) => unknown[])) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables?: Record<string, any> };
    const op = /(?:query|mutation|subscription)\s+(\w+)/.exec(body.query)?.[1] ?? "?";
    calls.push({ url, op, variables: body.variables ?? {} });
    if (url.endsWith("-sub")) {
      const events = typeof sse === "function" ? sse(body.variables ?? {}) : (sse ?? []);
      const text = events.map((e) => `data:${JSON.stringify(e)}\n\n`).join("");
      return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const r = routes[op];
    if (r === undefined) return new Response(JSON.stringify({ errors: [{ message: `no fake for ${op}` }] }), { status: 200 });
    const v = typeof r === "function" ? (r as Handler)(body.variables ?? {}, body.query) : r;
    const payload = v && typeof v === "object" && "errors" in (v as object) ? v : { data: v };
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(fetchImpl: typeof fetch, network: Network = FUEL_TESTNET): ChainContext {
  return { network, account: account(), fetch: fetchImpl };
}

export function req(method: string, params: unknown, over: Partial<DappRequest> = {}): DappRequest {
  return { id: "r1", origin: "https://app.example", via: "injected", family: "fuel", networkId: FUEL_TESTNET.id, method, params, ...over };
}

export function sig(s: { rs: string; recovery: number }, recovery: number | undefined = s.recovery): Signature {
  return { scheme: "ecdsa-secp256k1", bytes: Uint8Array.from(Buffer.from(s.rs, "hex")), ...(recovery === undefined ? {} : { recovery }), publicKey: ACCOUNT0.publicKey };
}
