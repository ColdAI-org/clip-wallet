import type { Account, ChainContext, Network, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { MULTIVERSX_DEVNET } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKeyHex: string, signatures: readonly string[]) {
  const pub = fromHex(publicKeyHex);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ed25519", bytes: sig, publicKey: hex(pub) };
    },
  };
}

export const signer = fixtureSigner(FIX.publicKey, [FIX.egldSig, FIX.usdcSig, FIX.messageSig]);

export function makeAccount(): Account {
  return { id: "multiversx:0", family: "multiversx", index: 0, curve: "ed25519", derivationPath: "m/44'/508'/0'/0'/0'", publicKey: FIX.publicKey, address: FIX.me };
}

export const GATEWAY = MULTIVERSX_DEVNET.rpcUrls[0]!;
export const API = MULTIVERSX_DEVNET.indexerUrl!;

export interface Reply {
  status: number;
  body: unknown;
}
export const reply = (status: number, body: unknown): Reply => ({ status, body });
const isReply = (v: unknown): v is Reply => !!v && typeof v === "object" && "status" in v && "body" in v && Object.keys(v).length === 2;
type Body = unknown | ((url: string, init?: RequestInit) => unknown);

/** URL-routed mock fetch (first match wins). Handlers may return a Reply for a non-200 status. */
export function mockFetch(routes: [RegExp, Body][]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    for (const [re, body] of routes) {
      if (!re.test(url)) continue;
      let v = typeof body === "function" ? (body as (u: string, i?: RequestInit) => unknown)(url, init) : body;
      if (!isReply(v)) v = reply(200, v);
      const r = v as Reply;
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify({ statusCode: 404, message: `no mock for ${url}` }), { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** Gateway envelope. */
export const gw = (data: unknown) => ({ data, error: "", code: "successful" });

/** Devnet /network/config as captured with curl (trimmed). */
export const NETWORK_CONFIG = gw({
  config: { erd_chain_id: "D", erd_min_gas_price: 1000000000, erd_min_gas_limit: 50000, erd_gas_per_data_byte: 1500, erd_gas_price_modifier: "0.01", erd_min_transaction_version: 1 },
});

export function baseRoutes(extra: [RegExp, Body][] = []): [RegExp, Body][] {
  return [
    ...extra,
    [/\/network\/config$/, NETWORK_CONFIG],
    [new RegExp(`/address/${FIX.me}/guardian-data$`), gw({ guardianData: { guarded: false } })],
    [new RegExp(`/address/${FIX.me}/esdt/USDC-350c4e$`), gw({ tokenData: { balance: "10000000", tokenIdentifier: "USDC-350c4e", properties: "" } })],
    [new RegExp(`/address/${FIX.me}$`), gw({ account: { address: FIX.me, nonce: 7, balance: "5000000000000000000", username: "" } })],
    [/\/tokens\/USDC-350c4e\?/, { identifier: "USDC-350c4e", name: "USDC", ticker: "USDC", decimals: 6, assets: { status: "active" } }],
    [/\/tokens\/WEGLD-a28c59\?/, { identifier: "WEGLD-a28c59", name: "WrappedEGLD", ticker: "WEGLD", decimals: 18, assets: { status: "active" } }],
    [/\/tokens\/USDC-fa4e01\?/, { identifier: "USDC-fa4e01", name: "USDC", ticker: "USDC", decimals: 6 }],
    [/\/providers\/erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqq80llllsrepk69\?/, { identity: "castlestake" }],
  ];
}

export function ctxFor(fetchImpl: typeof fetch, network: Network = MULTIVERSX_DEVNET): ChainContext {
  return { network, account: makeAccount(), fetch: fetchImpl };
}
