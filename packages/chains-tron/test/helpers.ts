import type { Account, ChainContext, DappRequest, Network, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { TRON_NILE } from "../src/index.js";
import { fromHex } from "../src/util.js";
import { ME, ME_PUB } from "./signatures.js";

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(signatures: readonly string[], pub = ME_PUB) {
  const key = fromHex(pub);
  const sigs = signatures.map((s) => fromHex(s));
  return {
    sign(p: SignablePayload): Signature {
      const s = sigs.find((x) => secp256k1.verify(x.subarray(0, 64), p.bytes, key, { prehash: false }));
      if (!s) throw new Error("no fixture signature for this payload");
      return { scheme: "ecdsa-secp256k1", bytes: s.subarray(0, 64), recovery: s[64]! - 27, publicKey: pub };
    },
  };
}

export function makeAccount(address = ME, publicKey = ME_PUB): Account {
  return { id: "tron:0", family: "tron", index: 0, curve: "secp256k1", derivationPath: "m/44'/195'/0'/0/0", publicKey, address };
}

type Handler = unknown | ((body: Record<string, unknown>) => unknown);

/** Mock java-tron HTTP API: path → JSON (or a function of the POSTed JSON). Unknown paths answer 404. */
export function mockTron(routes: Record<string, Handler>) {
  const calls: { url: string; path: string; body: Record<string, unknown> }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url, path, body });
    if (!(path in routes)) return new Response("not found", { status: 404 });
    const h = routes[path];
    const v = typeof h === "function" ? (h as (b: Record<string, unknown>) => unknown)(body) : h;
    return new Response(JSON.stringify(v), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(fetchImpl: typeof fetch, network: Network = TRON_NILE, account: Account = makeAccount()): ChainContext {
  return { network, account, fetch: fetchImpl };
}

export function req(method: string, params: unknown, origin = "https://app.example", networkId = TRON_NILE.id): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via: "injected", family: "tron", networkId, method, params };
}

/** A Nile-like account the key controls. */
export const meAccount = (balance = 57_200_892_190) => ({
  address: ME,
  balance,
  create_time: 1626606534000,
  owner_permission: { permission_name: "owner", threshold: 1, keys: [{ address: ME, weight: 1 }] },
  active_permission: [{ type: "Active", id: 2, permission_name: "active", threshold: 1, operations: "7fff1fc0033efb0f000000000000000000000000000000000000000000000000", keys: [{ address: ME, weight: 1 }] }],
});

/** Chain parameters as Nile and mainnet report them (POST /wallet/getchainparameters, 2026-10). */
export const chainParameters = {
  chainParameter: [
    { key: "getTransactionFee", value: 1000 },
    { key: "getEnergyFee", value: 100 },
    { key: "getCreateAccountFee", value: 100000 },
    { key: "getCreateNewAccountFeeInSystemContract", value: 1000000 },
    { key: "getMemoFee", value: 1000000 },
    { key: "getMaxFeeLimit", value: 15000000000 },
    { key: "getUnfreezeDelayDays", value: 14 },
  ],
};

/** /wallet/getblockbynum that answers ids whose bytes 8..16 are `refHash` (so any ref block checks out), or a fixed id. */
export const blockByNum = (refHash: string) => (b: Record<string, unknown>) => ({
  blockID: `${BigInt(b.num as number).toString(16).padStart(16, "0")}${refHash}${"00".repeat(16)}`,
});

/** A head block whose low 16 bits are near `refBytes`. */
export const nowBlock = (number = 71585237, blockId = "0000000004444dd56ee3c6be8649ac0a384d36e2fb9f1724e30d40b7d8faf835", timestamp = 1791284757000) => ({
  blockID: blockId,
  block_header: { raw_data: { number, timestamp } },
});
