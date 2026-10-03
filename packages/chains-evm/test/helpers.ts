import type { Account, ChainContext, Network } from "@clip-wallet/core";
import { networkById } from "../src/networks.js";

/**
 * Public test account: BIP-39 test vector "abandon abandon … about", path m/44'/60'/0'/0/0.
 * Only the public key and address live here; signatures in test/signatures.ts were produced offline
 * (see test/README note in signatures.ts).
 */
export const TEST_ACCOUNT: Account = {
  id: "evm:0",
  family: "evm",
  index: 0,
  curve: "secp256k1",
  derivationPath: "m/44'/60'/0'/0/0",
  publicKey: "0237b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299",
  address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
};

export type RpcHandler = unknown | ((params: unknown[]) => unknown);
export interface MockSpec {
  rpc?: Record<string, RpcHandler>;
  /** GET url (prefix match on path+query) → JSON body, or a number for an HTTP status. */
  http?: Record<string, unknown>;
}

export interface MockFetch {
  fetch: typeof fetch;
  calls: { method: string; params: unknown[] }[];
  gets: string[];
}

export class RpcErr {
  constructor(public code: number, public message: string, public data?: unknown) {}
}

export function mockFetch(spec: MockSpec): MockFetch {
  const calls: MockFetch["calls"] = [];
  const gets: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
      calls.push({ method: body.method, params: body.params });
      const h = spec.rpc?.[body.method];
      if (h === undefined) return json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `method ${body.method} not found` } });
      const result = typeof h === "function" ? (h as (p: unknown[]) => unknown)(body.params) : h;
      if (result instanceof RpcErr) return json({ jsonrpc: "2.0", id: body.id, error: { code: result.code, message: result.message, data: result.data } });
      return json({ jsonrpc: "2.0", id: body.id, result });
    }
    gets.push(url);
    for (const [k, v] of Object.entries(spec.http ?? {})) {
      if (url.includes(k)) return typeof v === "number" ? new Response("", { status: v }) : json(v);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls, gets };
}

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

export function ctxFor(networkId: string, m: MockFetch, overrides: Partial<Network> = {}): ChainContext {
  const n = networkById(networkId);
  if (!n) throw new Error(`unknown network ${networkId}`);
  return { network: { ...n, ...overrides }, account: TEST_ACCOUNT, fetch: m.fetch };
}

export const SEPOLIA = "eip155:11155111";
export const ROOTSTOCK = "eip155:30";
export const BASE = "eip155:8453";
export const ME = TEST_ACCOUNT.address as `0x${string}`;
export const BOB: `0x${string}` = "0x1234567890AbcdEF1234567890aBcdef12345678";
export const SEPOLIA_USDC: `0x${string}` = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
