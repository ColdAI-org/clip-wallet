import type { Account, ChainContext, Network, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { NEAR_TESTNET } from "../src/index.js";
import { fromHex } from "../src/util.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(publicKeyHex: string, signatures: readonly string[]) {
  const pub = fromHex(publicKeyHex);
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => ed25519.verify(s, p.bytes, pub));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "ed25519", bytes: sig, publicKey: publicKeyHex };
    },
  };
}

export function makeAccount(publicKeyHex: string, address = publicKeyHex): Account {
  return { id: "near:0", family: "near", index: 0, curve: "ed25519", derivationPath: "m/44'/397'/0'", publicKey: publicKeyHex, address };
}

export const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const b64 = (o: unknown) => btoa(String.fromCharCode(...enc(o)));

type Handler = (params: Record<string, unknown>) => unknown;

/** A JSON-RPC error as nearcore returns it (error.cause.name + data). */
export class RpcFail {
  constructor(
    public readonly cause: string,
    public readonly data: unknown = "",
  ) {}
}

/**
 * Mock NEAR JSON-RPC and FastNEAR. Handler keys:
 *  - "view_account:<id>", "view_access_key:<id>", "call:<contract>:<method>" (returns a JSON value; the mock encodes it)
 *  - plain method names ("block", "gas_price", "send_tx")
 * Missing view_account → UNKNOWN_ACCOUNT, missing view_access_key → the `result.error` form nodes return.
 * `urls`: [regex, body] for FastNEAR GETs.
 */
export function mockNear(handlers: Record<string, Handler | unknown>, urls: [RegExp, unknown][] = []) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const reply = (id: number, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const fail = (id: number, cause: string, data: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name: cause, info: {} }, code: -32000, message: "Server error", data } }));
  const run = (h: Handler | unknown, p: Record<string, unknown>) => (typeof h === "function" ? (h as Handler)(p) : h);
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!init?.body) {
      for (const [re, body] of urls) if (re.test(url)) return new Response(JSON.stringify(typeof body === "function" ? (body as (u: string) => unknown)(url) : body));
      return new Response("not found", { status: 404 });
    }
    const req = JSON.parse(String(init.body)) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: req.method, params: req.params });
    let key = req.method;
    if (req.method === "query") {
      const p = req.params;
      if (p.request_type === "call_function") key = `call:${p.account_id}:${p.method_name}`;
      else key = `${p.request_type}:${p.account_id}`;
    }
    const h = handlers[key];
    if (h === undefined) {
      if (key.startsWith("view_account:")) return fail(req.id, "UNKNOWN_ACCOUNT", `account ${req.params.account_id} does not exist while viewing`);
      if (key.startsWith("view_access_key:")) {
        return reply(req.id, { block_hash: "x", block_height: 1, error: `access key ${req.params.public_key} does not exist while viewing`, logs: [] });
      }
      if (key.startsWith("call:")) return fail(req.id, "CONTRACT_EXECUTION_ERROR", `no mock for ${key}`);
      return fail(req.id, "METHOD_NOT_FOUND", `no mock for ${key}`);
    }
    try {
      const v = run(h, req.params);
      if (key.startsWith("call:")) return reply(req.id, { result: [...enc(v)], logs: [], block_height: 1, block_hash: "x" });
      return reply(req.id, v);
    } catch (e) {
      if (e instanceof RpcFail) return fail(req.id, e.cause, e.data);
      throw e;
    }
  }) as typeof fetch;
  return { fetch: f, calls, b64 };
}

export function ctxFor(account: Account, fetchImpl: typeof fetch, network: Network = NEAR_TESTNET): ChainContext {
  return { network, account, fetch: fetchImpl };
}

export const viewAccount = (amount: string, storage = 182, locked = "0") => ({
  amount,
  locked,
  code_hash: "11111111111111111111111111111111",
  storage_usage: storage,
  storage_paid_at: 0,
  block_hash: "x",
  block_height: 1,
});

export const fullAccess = (nonce: string | number) => ({ nonce: Number(nonce), permission: "FullAccess", block_hash: "x", block_height: 1 });

/** Trimmed send_tx result (shape from testnet `tx` / `send_tx`, wait_until EXECUTED_OPTIMISTIC). */
export const outcome = (hash: string, signer: string, receiver: string, status: unknown = { SuccessValue: "" }) => ({
  final_execution_status: "EXECUTED_OPTIMISTIC",
  status,
  transaction: { hash, signer_id: signer, receiver_id: receiver, nonce: 1, actions: [] },
  transaction_outcome: { id: hash, outcome: { status: { SuccessReceiptId: "r1" }, gas_burnt: 223182562500, tokens_burnt: "22318256250000000000", logs: [] } },
  receipts_outcome: [],
});
