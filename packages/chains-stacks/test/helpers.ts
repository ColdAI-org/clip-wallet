import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { STACKS_MAINNET, STACKS_TESTNET } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";
import { FIX } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKeyHex: string, sigs: Record<string, string>) {
  const pub = fromHex(publicKeyHex);
  return {
    sign(p: SignablePayload): Signature {
      for (const v of Object.values(sigs)) {
        const [rs, rec] = v.split(":");
        const bytes = fromHex(rs!);
        if (secp256k1.verify(bytes, p.bytes, pub, { prehash: false })) return { scheme: "ecdsa-secp256k1", bytes, recovery: Number(rec), publicKey: publicKeyHex };
      }
      throw new Error(`no fixture signature for digest ${hex(p.bytes)}`);
    },
  };
}

export const signer = fixtureSigner(FIX.publicKey, FIX.sigs);

export function makeAccount(publicKey = FIX.publicKey, address = FIX.mainnet): Account {
  return { id: "stacks:0", family: "stacks", index: 0, curve: "secp256k1", derivationPath: "m/44'/5757'/0'/0/0", publicKey, address };
}

type Body = unknown | ((url: string, init?: RequestInit) => unknown);
export interface Reply {
  status: number;
  body: unknown;
}
export const reply = (status: number, body: unknown): Reply => ({ status, body });
const isReply = (v: unknown): v is Reply => !!v && typeof v === "object" && "status" in v && "body" in v && Object.keys(v).length === 2;

/** URL-routed mock fetch (first match wins). Handlers may return a Reply for a non-200 status. */
export function mockFetch(routes: [RegExp, Body][]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    for (const [re, body] of routes) {
      if (!re.test(url)) continue;
      let v = typeof body === "function" ? (body as (u: string, i?: RequestInit) => unknown)(url, init) : body;
      if (!isReply(v)) v = reply(200, v);
      const r = v as Reply;
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify({ error: `no mock for ${url}` }), { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(fetchImpl: typeof fetch, network = STACKS_TESTNET): ChainContext {
  return { network, account: makeAccount(), fetch: fetchImpl };
}
export { STACKS_MAINNET, STACKS_TESTNET };

/** Hiro replies trimmed from api.testnet.hiro.so (2026-10). */
export const ACCOUNT = (balance: bigint, nonce = 7, locked = 0n) => ({
  balance: `0x${balance.toString(16).padStart(32, "0")}`,
  locked: `0x${locked.toString(16).padStart(32, "0")}`,
  unlock_height: 0,
  nonce,
});
export const NONCES = (next = 7) => ({ last_mempool_tx_nonce: null, last_executed_tx_nonce: next - 1, possible_next_nonce: next, detected_missing_nonces: [], detected_mempool_nonces: [] });
export const FEES = { estimated_cost_scalar: 6, estimations: [{ fee_rate: 94, fee: 500 }, { fee_rate: 94, fee: 600 }, { fee_rate: 94, fee: 700 }], cost_scalar_change_by_byte: 0.0047 };
