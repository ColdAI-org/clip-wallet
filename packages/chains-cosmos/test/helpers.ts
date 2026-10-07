import type { Account, ChainContext, Network, SignablePayload, Signature } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { CosmosFamily } from "../src/networks.js";
import { fromHex } from "../src/util.js";
import { SIGS } from "./signatures.js";

/**
 * Public keys of account 0 of the public BIP-39 test vector ("abandon" ×11 + "about", no passphrase), printed by a
 * scratch script outside the repo with the vault's own derivation (packages/vault/src/derive.ts deriveFamilyKey at
 * derivationPath(family, 0)). Only public keys and addresses live in the repo.
 */
export const PUB: Record<CosmosFamily, string> = {
  cosmos: "024f4e2ad99c34d60b9ba6283c9431a8418af8673212961f97a77b6377fcd05b62",
  provenance: "02b46c78777309c65fb5c2308574fb9a76853d7c0e91d1a1bd1f79f6ccb64ef6da",
  thorchain: "02205c476a22d5fe10b74489db9479d0e36e25a32da393a771fcf12380136a451f",
  initia: "0237b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299",
};

/** The vault's Account.address for each family (mainnet spelling, packages/vault/src/address.ts). */
export const VAULT_ADDRESS: Record<CosmosFamily, string> = {
  cosmos: "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4",
  provenance: "pb1fpwxdyscnu2dzjwghpstx7l9xtvsap48l5gnrm",
  thorchain: "thor1gm00vwsfcp48enm4uv9e5dhm37jtd0ye27wrx0",
  initia: "init1npvwllfr9dqr8erajqqr6s0vxnk2ak558xjc5c",
};

export const ADDR = {
  osmo: "osmo19rl4cm2hmr8afy4kldpxz3fka4jguq0a5m7df8",
  dydx: "dydx19rl4cm2hmr8afy4kldpxz3fka4jguq0a4erelz",
  zig: "zig19rl4cm2hmr8afy4kldpxz3fka4jguq0aa2g0aa",
  tp: "tp1fpwxdyscnu2dzjwghpstx7l9xtvsap48vldlp3",
  pb: "pb1fpwxdyscnu2dzjwghpstx7l9xtvsap48l5gnrm",
  thor: "thor1gm00vwsfcp48enm4uv9e5dhm37jtd0ye27wrx0",
  init: "init1npvwllfr9dqr8erajqqr6s0vxnk2ak558xjc5c",
  /** Account 1 of the same phrase (a second address to send to; nothing secret). */
  osmoBob: "osmo1jrkmdcwgq94uaamx6zax2luewlhf7u4k5r4pqs",
  thorBob: "thor1lq2ufla82u5s85gyhe422w6mt02hrxf53q9g5j",
  initBob: "init1d7ky6xxfzg6rh7r05uzfxexafepy4wwq924swa",
  tpBob: "tp1wqczt252gxx4lnwvfq6036nqanqsf53rnsnc8n",
};

export function makeAccount(family: CosmosFamily): Account {
  const coin = { cosmos: 118, provenance: 505, thorchain: 931, initia: 60 }[family];
  return { id: `${family}:0`, family, index: 0, curve: "secp256k1", derivationPath: `m/44'/${coin}'/0'/0/0`, publicKey: PUB[family], address: VAULT_ADDRESS[family] };
}

export function ctxFor(network: Network, fetchImpl: typeof fetch): ChainContext {
  return { network, account: makeAccount(network.family as CosmosFamily), fetch: fetchImpl };
}

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(family: CosmosFamily) {
  const pub = fromHex(PUB[family]);
  return {
    sign(p: SignablePayload): Signature {
      const hit = Object.values(SIGS).map(fromHex).find((s) => secp256k1.verify(s, p.bytes, pub, { prehash: false }));
      if (!hit) throw new Error(`no fixture signature for digest ${Buffer.from(p.bytes).toString("hex")}`);
      return { scheme: "ecdsa-secp256k1", bytes: hit, recovery: 0, publicKey: PUB[family] };
    },
  };
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
  const calls: { url: string; method: string; body?: string }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    for (const [re, body] of routes) {
      if (!re.test(url)) continue;
      let v = typeof body === "function" ? (body as (u: string, i?: RequestInit) => unknown)(url, init) : body;
      if (!isReply(v)) v = reply(200, v);
      const r = v as Reply;
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
    }
    return new Response(JSON.stringify({ code: 12, message: `no mock for ${url}` }), { status: 501 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/* ------------------------------------------------------------------ REST fixtures (shapes as returned by the live nodes, Oct 2026) */

export const accountInfo = (address: string, accountNumber: string, sequence: string, typeUrl = "/cosmos.crypto.secp256k1.PubKey") => ({
  info: { address, pub_key: { "@type": typeUrl, key: "AiXNMqSHp1E2vU0sHzROr3wN+vg3P2PcZpAG3nIlT1Ll" }, account_number: accountNumber, sequence },
});

export const NOT_FOUND = reply(404, { code: 5, message: "rpc error: code = NotFound desc = account osmo1… not found: key not found", details: [] });

export const balances = (list: { denom: string; amount: string }[]) => ({ balances: list, pagination: { next_key: null, total: String(list.length) } });

export const simulated = (gasUsed: string) => ({ gas_info: { gas_wanted: "0", gas_used: gasUsed }, result: { data: "", log: "", events: [], msg_responses: [] } });

export const broadcastOk = (txhash: string) => ({ tx_response: { height: "0", txhash, codespace: "", code: 0, data: "", raw_log: "", logs: [], info: "", gas_wanted: "0", gas_used: "0", tx: null, timestamp: "", events: [] } });

export const broadcastFail = (code: number, raw_log: string, codespace = "sdk") => ({ tx_response: { height: "0", txhash: "AB", codespace, code, raw_log } });

export const txFound = (txhash: string, height = "123456") => ({ tx_response: { height, txhash, code: 0, raw_log: "" } });
