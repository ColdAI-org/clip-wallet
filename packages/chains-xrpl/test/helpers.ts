import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { XRPL_TESTNET } from "../src/index.js";
import { fromHex } from "../src/util.js";
import { LEDGER, ME, OPEN_LEDGER_FEE, PUB, SEQ } from "./fixtures.js";
import { SIGS } from "./signatures.js";

/** Vault stand-in: answers with the precomputed signature that verifies for the payload (verification only). */
export const signer = {
  sign(p: SignablePayload): Signature {
    const sig = Object.values(SIGS)
      .map(fromHex)
      .find((s) => secp256k1.verify(s, p.bytes, fromHex(PUB), { prehash: false }));
    if (!sig) throw new Error("no fixture signature for this payload");
    return { scheme: "ecdsa-secp256k1", bytes: sig, recovery: 0, publicKey: PUB.toLowerCase() };
  },
};

export function makeAccount(): Account {
  return { id: "xrpl:0", family: "xrpl", index: 0, curve: "secp256k1", derivationPath: "m/44'/144'/0'/0/0", publicKey: PUB.toLowerCase(), address: ME };
}

type Handler = (params: Record<string, unknown>) => unknown;

/** rippled JSON-RPC mock: answers by `method`; a handler's return value becomes `result` (status success unless it says error). */
export function mockRpc(over: Record<string, Handler> = {}) {
  const calls: { url: string; method: string; params: Record<string, unknown> }[] = [];
  const routes: Record<string, Handler> = { ...baseRoutes(), ...over };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: Record<string, unknown>[] };
    const params = body.params?.[0] ?? {};
    calls.push({ url, method: body.method, params });
    const h = routes[body.method];
    if (!h) return new Response(JSON.stringify({ result: { status: "error", error: "unknownCmd" } }));
    const r = h(params) as Record<string, unknown>;
    return new Response(JSON.stringify({ result: { status: "success", ...r } }));
  }) as typeof fetch;
  return { fetch: f, calls };
}

export const notFound = () => ({ status: "error", error: "actNotFound", error_message: "Account not found." });

export function account(address: string, over: Record<string, unknown> = {}) {
  return { account_data: { Account: address, Balance: "50000000", Flags: 0, OwnerCount: 1, Sequence: SEQ, ...over } };
}

export function baseRoutes(): Record<string, Handler> {
  return {
    account_info: (p) => account(String(p.account)),
    server_info: () => ({ info: { network_id: 1, validated_ledger: { reserve_base_xrp: 1, reserve_inc_xrp: 0.2, seq: LEDGER - 1, base_fee_xrp: 0.00001 } } }),
    fee: () => ({ drops: { base_fee: "10", median_fee: "5000", minimum_fee: "10", open_ledger_fee: OPEN_LEDGER_FEE }, ledger_current_index: LEDGER }),
    account_lines: () => ({ lines: [] }),
    submit: () => ({ engine_result: "tesSUCCESS", engine_result_message: "The transaction was applied." }),
    tx: (p) => ({ hash: p.transaction, validated: true, meta: { TransactionResult: "tesSUCCESS" } }),
  };
}

export function ctxFor(fetchImpl: typeof fetch, network = XRPL_TESTNET): ChainContext {
  return { network, account: makeAccount(), fetch: fetchImpl };
}
