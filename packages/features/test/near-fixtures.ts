import type { Account, ChainContext, Network } from "@clip-wallet/core";
import { NEAR_MAINNET, NEAR_TESTNET } from "@clip-wallet/chains-near";

/**
 * Public key / implicit account of the chains-near test fixture (packages/chains-near/test/signatures.ts FIX.me,
 * derived offline from the public "abandon … about" vector). Public data only; nothing here can sign.
 */
export const ME_NEAR = "5510e2b44cae6eb807e3e0e45d579dda058c274abcba15e5cb84636f5d1ee412";
export const NEAR_PK = "ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25";
export const BLOCK_HASH = "9Sb1ji52KmWr5qE8WFgGr4k3wMLq8ispMAZQqswkAatn";
export const YOCTO = 10n ** 24n;

export const NEAR_TEST: Network = { ...NEAR_TESTNET, rpcUrls: ["https://near-testnet.rpc.test"], indexerUrl: "https://fastnear-testnet.test" };
export const NEAR_MAIN: Network = { ...NEAR_MAINNET, rpcUrls: ["https://near-mainnet.rpc.test"], indexerUrl: "https://fastnear-mainnet.test" };

export function nearAccount(address = ME_NEAR): Account {
  return { id: "near:0", family: "near", index: 0, curve: "ed25519", derivationPath: "m/44'/397'/0'", publicKey: ME_NEAR, address };
}

export function nearCtx(fetchImpl: typeof fetch, network: Network = NEAR_TEST): ChainContext {
  return { network, account: nearAccount(), fetch: fetchImpl };
}

type Handler = unknown | ((args: Record<string, unknown>) => unknown);

/**
 * Mock NEAR JSON-RPC + plain GETs. Keys: "call:<contract>:<method>" (handler gets the decoded JSON args; return
 * value is JSON-encoded like a contract result), "view_account:<id>", "view_access_key:<id>", or a plain RPC
 * method ("validators", "block", "gas_price", "EXPERIMENTAL_protocol_config"). A handler that throws becomes an
 * RPC error. GET routes: [regex, body] or [regex, body, status].
 */
export function mockNearRpc(handlers: Record<string, Handler>, gets: ([RegExp, unknown] | [RegExp, unknown, number])[] = []) {
  const calls: { key: string; args?: Record<string, unknown>; url: string }[] = [];
  const reply = (id: number, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
  const fail = (id: number, name: string, data: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name, info: {} }, code: -32000, message: "Server error", data } }));
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!init?.body) {
      calls.push({ key: `GET ${url}`, url });
      for (const [re, body, status] of gets) {
        if (re.test(url)) return new Response(JSON.stringify(typeof body === "function" ? (body as (u: string) => unknown)(url) : body), { status: status ?? 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }
    const req = JSON.parse(String(init.body)) as { id: number; method: string; params: Record<string, unknown> };
    let key = req.method;
    let args: Record<string, unknown> | undefined;
    if (req.method === "query") {
      const p = req.params;
      if (p.request_type === "call_function") {
        key = `call:${p.account_id}:${p.method_name}`;
        args = JSON.parse(atob(String(p.args_base64 ?? "")) || "{}") as Record<string, unknown>;
      } else key = `${p.request_type}:${p.account_id}`;
    }
    calls.push({ key, args, url });
    const h = handlers[key];
    if (h === undefined) {
      if (key.startsWith("view_account:")) return fail(req.id, "UNKNOWN_ACCOUNT", "does not exist");
      return fail(req.id, key.startsWith("call:") ? "CONTRACT_EXECUTION_ERROR" : "METHOD_NOT_FOUND", `no mock for ${key}`);
    }
    try {
      const v = typeof h === "function" ? (h as (a: Record<string, unknown>) => unknown)(args ?? {}) : h;
      if (key.startsWith("call:")) return reply(req.id, { result: [...new TextEncoder().encode(JSON.stringify(v))], logs: [], block_height: 1, block_hash: "x" });
      return reply(req.id, v);
    } catch (e) {
      return fail(req.id, "CONTRACT_EXECUTION_ERROR", String(e));
    }
  }) as typeof fetch;
  return { fetch: f, calls };
}

export const viewAccount = (amount: bigint, storage = 182) => ({ amount: amount.toString(), locked: "0", code_hash: "11111111111111111111111111111111", storage_usage: storage, storage_paid_at: 0, block_hash: "x", block_height: 1 });
export const fullAccess = (nonce = 5) => ({ nonce, permission: "FullAccess", block_hash: "x", block_height: 1 });

/** The handlers every request needs for the chain module's decode(): access key, gas price, block. */
export const decodeBasics = {
  [`view_access_key:${ME_NEAR}`]: fullAccess(),
  gas_price: { gas_price: "100000000" },
  block: { header: { hash: BLOCK_HASH, height: 271356934, total_supply: (2_672_652_659n * YOCTO).toString() } },
};
