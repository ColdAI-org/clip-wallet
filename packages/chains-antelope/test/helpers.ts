import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { JUNGLE4 } from "../src/index.js";
import { fromHex } from "../src/bytes.js";
import { EOSIO_ABI, INFO, ME, PUB_HEX, PUB_K1 } from "./fixtures.js";
import { SIGS } from "./signatures.js";

/** Vault stand-in: the precomputed signature that verifies for the payload (verification only). */
export const signer = {
  sign(p: SignablePayload): Signature {
    const s = Object.values(SIGS).find((x) => secp256k1.verify(fromHex(x.rs), p.bytes, fromHex(PUB_HEX), { prehash: false }));
    if (!s) throw new Error("no fixture signature for this payload");
    return { scheme: "ecdsa-secp256k1", bytes: fromHex(s.rs), recovery: s.recovery, publicKey: PUB_HEX };
  },
};

export function makeAccount(): Account {
  return { id: "antelope:0", family: "antelope", index: 0, curve: "secp256k1", derivationPath: "m/44'/194'/0'/0/0", publicKey: PUB_HEX, address: PUB_K1 };
}

type Handler = (body: Record<string, unknown>, url: string) => unknown;
export const err = (name: string, code: number, message: string, status = 500) => ({ __status: status, code: status, message: "Internal Service Error", error: { code, name, what: name, details: [{ message }] } });

/** Chain API mock by path ("/v1/chain/get_info", "/v2/state/get_tokens"). A handler may return err(...) for an error answer. */
export function mockChain(over: Record<string, Handler> = {}) {
  const calls: { url: string; path: string; body: Record<string, unknown> }[] = [];
  const routes: Record<string, Handler> = { ...baseRoutes(), ...over };
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, path, body });
    const h = routes[path];
    if (!h) return new Response(JSON.stringify(err("exception", 0, "Unknown Endpoint", 404)), { status: 404 });
    const r = h(body, url) as Record<string, unknown> | unknown[];
    const status = !Array.isArray(r) && typeof r === "object" && r && "__status" in r ? Number(r.__status) : 200;
    return new Response(JSON.stringify(r), { status });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function baseRoutes(): Record<string, Handler> {
  return {
    "/v1/chain/get_info": () => INFO,
    "/v1/chain/get_accounts_by_authorizers": () => ({
      accounts: [
        { account_name: ME, permission_name: "active", authorizing_key: PUB_K1, weight: 1, threshold: 1 },
        { account_name: ME, permission_name: "owner", authorizing_key: "EOS6zpSNY1YoLxNt2VsvJjoDfBueU6xC1M1ERJw1UoekL1NHn8KNA", weight: 1, threshold: 1 },
      ],
    }),
    "/v1/chain/get_currency_balance": (b) => (b.symbol === "EOS" ? ["10.0000 EOS"] : b.symbol === "A" ? ["2.5000 A"] : []),
    "/v1/chain/get_account": (b) => ({ account_name: b.account_name }),
    "/v1/chain/get_abi": (b) => ({ account_name: b.account_name, abi: b.account_name === "eosio" ? EOSIO_ABI : undefined }),
    "/v1/chain/send_transaction2": () => ({ transaction_id: "will-be-replaced", processed: { receipt: { status: "executed" } } }),
    "/v2/state/get_tokens": () => ({ tokens: [{ symbol: "EOS", precision: 4, amount: 10, contract: "eosio.token" }, { symbol: "EOS", precision: 4, amount: 50, contract: "eosfakecoin1" }, { symbol: "JUNGLE", precision: 4, amount: 100, contract: "eosio.token" }] }),
  };
}

export function ctxFor(fetchImpl: typeof fetch, network = JUNGLE4): ChainContext {
  return { network, account: makeAccount(), fetch: fetchImpl };
}
