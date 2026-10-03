import type { Account, ChainContext, DappRequest, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { TEZOS_SHADOWNET } from "../src/index.js";
import { fromHex, hex } from "../src/encoding.js";
import { FIX } from "./signatures.js";

export const ME = FIX.address;
export const BOB = "tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP";
export const FRESH = "tz1LHBqjkR1QoJ1k2uukvSVaXGrpkBLZhG48";
export const FA2 = "KT1Mi8MejYS9agBUnhuHGHSvLf6ZVuwMgsM3";
export const FA12 = "KT18xKQ3jqtAyK2ycqoYm44e8ckjNi2WUY2C";
export const BAKER = "tz1N29q5T3jJ2i1JEWHax7q1NRkDMADj6fof";
export const BAKER2 = "tz1X2jPbN1V6Yae7gf1NcbR4DgMKrouHrrrA";
export const BRANCH = "BMKoX9sSJgN6nvfLK1j6dZpru7q49uyzWnSbCe8v4cYJXR59WVc";
export const RPC = TEZOS_SHADOWNET.rpcUrls[0]!;
export const TZKT = TEZOS_SHADOWNET.indexerUrl!;

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(signatures: readonly string[]) {
  const pub = fromHex(FIX.publicKey);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error(`no fixture signature for payload ${hex(p.bytes)}`);
      return { scheme: "ed25519", bytes: sig, publicKey: hex(pub) };
    },
  };
}

export function makeAccount(): Account {
  return { id: "tezos:0", family: "tezos", index: 0, curve: "ed25519", derivationPath: FIX.path, publicKey: FIX.publicKey, address: ME };
}

type Body = unknown;
type Reply = unknown | ((body: Body, url: string) => unknown);
export interface Route {
  method?: "GET" | "POST";
  match: RegExp;
  reply: Reply;
  status?: number;
}

/** Mock fetch by URL regex (first match wins). Records every call. */
export function mockFetch(routes: Route[]) {
  const calls: { method: string; url: string; body: Body }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body });
    const r = routes.find((x) => (x.method ?? "GET") === method && x.match.test(url));
    if (!r) return new Response(`no mock for ${method} ${url}`, { status: 404 });
    const v = typeof r.reply === "function" ? (r.reply as (b: Body, u: string) => unknown)(body, url) : r.reply;
    return new Response(JSON.stringify(v), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** Echo the request contents back with captured metadata (index-aligned). */
export function simEcho(captured: { contents: readonly { metadata: unknown }[] }) {
  return (body: Body) => {
    const contents = (body as { operation: { contents: Record<string, unknown>[] } }).operation.contents;
    return { contents: contents.map((c, i) => ({ ...c, metadata: captured.contents[i]?.metadata ?? captured.contents[0]!.metadata })) };
  };
}

export interface ChainState {
  managerKey?: string | null;
  counter?: string;
  sim?: Reply;
  simStatus?: number;
  inject?: Reply;
  injectStatus?: number;
  tzkt?: Route[];
}

/** RPC routes for one account plus TzKT routes. */
export function chain(s: ChainState = {}) {
  const routes: Route[] = [
    { match: /\/blocks\/head~2\/hash$/, reply: BRANCH },
    { match: new RegExp(`/contracts/${ME}/manager_key$`), reply: s.managerKey === undefined ? FIX.edpk : s.managerKey },
    { match: new RegExp(`/contracts/${ME}/counter$`), reply: s.counter ?? "25155453" },
    { method: "POST", match: /\/helpers\/scripts\/simulate_operation$/, reply: s.sim ?? null, status: s.simStatus ?? 200 },
    { method: "POST", match: /\/injection\/operation/, reply: s.inject ?? "ooFakeHash", status: s.injectStatus ?? 200 },
    ...(s.tzkt ?? []),
    // Default TzKT answers: no alias, no tokens.
    { match: /\/v1\/accounts\/[^/?]+$/, reply: null },
    { match: /\/v1\/tokens\?/, reply: [] },
    { match: /\/v1\/delegates\//, reply: null },
  ];
  return mockFetch(routes);
}

export function ctxFor(fetchImpl: typeof fetch): ChainContext {
  return { network: TEZOS_SHADOWNET, account: makeAccount(), fetch: fetchImpl };
}

let n = 0;
export function req(method: string, params: unknown, origin = "https://app.example"): DappRequest {
  return { id: `req-${++n}`, origin, via: "walletconnect", family: "tezos", networkId: TEZOS_SHADOWNET.id, method, params };
}

/** TzKT token record (shape from GET /v1/tokens on shadownet / mainnet). */
export const fa2Token = {
  id: 74505478209537,
  contract: { address: FA2, alias: "Test Coin" },
  tokenId: "0",
  standard: "fa2",
  totalSupply: "2000000000",
  metadata: { name: "Test Coin", symbol: "TST", decimals: "6" },
};
export const fa12Token = {
  contract: { address: FA12 },
  tokenId: "0",
  standard: "fa1.2",
  totalSupply: "2100000000000000",
  metadata: { name: "tzBTC", symbol: "tzBTC", decimals: "8" },
};
