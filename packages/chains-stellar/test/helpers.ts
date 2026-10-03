import type { Account, ChainContext, Network, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { StrKey } from "@stellar/stellar-base";
import { STELLAR_TESTNET } from "../src/index.js";
import { hex } from "../src/util.js";

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

export function pubOf(address: string): Uint8Array {
  return Uint8Array.from(StrKey.decodeEd25519PublicKey(address));
}

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(me: string, signatures: readonly string[]) {
  const pub = pubOf(me);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ed25519", bytes: sig, publicKey: hex(pub) };
    },
  };
}

export function makeAccount(me: string): Account {
  return { id: "stellar:0", family: "stellar", index: 0, curve: "ed25519", derivationPath: "m/44'/148'/0'", publicKey: hex(pubOf(me)), address: me };
}

type Body = unknown | ((req: { url: string; body: string | null }) => unknown);

/**
 * Mock fetch. `horizon`: path (with query) → JSON body, or `{ status, body }`; missing paths are 404s like Horizon's.
 * `rpc`: Soroban RPC method → result (or a function of params; throw {code,message} for an RPC error).
 */
export function mockStellar(horizon: Record<string, Body> = {}, rpc: Record<string, (params: unknown) => unknown> = {}) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? String(init.body) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const u = new URL(url);
    if (u.host.startsWith("soroban")) {
      const req = JSON.parse(body ?? "{}") as { id: number; method: string; params?: unknown };
      const h = rpc[req.method];
      if (!h) return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `no mock for ${req.method}` } }));
      try {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: h(req.params) }));
      } catch (e) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: e }));
      }
    }
    const key = `${init?.method === "POST" ? "POST " : ""}${u.pathname}${u.search}`;
    if (!(key in horizon)) return new Response(JSON.stringify({ type: "https://stellar.org/horizon-errors/not_found", title: "Resource Missing", status: 404 }), { status: 404 });
    let v = horizon[key];
    if (typeof v === "function") v = (v as (r: { url: string; body: string | null }) => unknown)({ url, body });
    if (v && typeof v === "object" && "status" in (v as object) && "body" in (v as object)) {
      const r = v as { status: number; body: unknown };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify(v), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(account: Account, fetchImpl: typeof fetch, network: Network = STELLAR_TESTNET): ChainContext {
  return { network, account, fetch: fetchImpl };
}
