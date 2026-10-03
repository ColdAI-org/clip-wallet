import type { Account, ChainContext, Network } from "@clip-wallet/core";
import { hex } from "@scure/base";
import { segwitAddress, taprootAddress } from "../src/keys.js";
import { BITCOIN_TESTNET4, networkById } from "../src/networks.js";

/**
 * Public test account: BIP-39 test vector "abandon … about", BIP-84 m/84'/0'/0'/0/0
 * (bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu) with its BIP-86 key m/86'/0'/0'/0/0 as taprootPublicKey
 * (bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr), as the vault's deriveAccount returns it.
 * Public data only; signatures used by the tests were produced offline and live in signatures.ts.
 */
export const TEST_ACCOUNT: Account = {
  id: "bitcoin:0",
  family: "bitcoin",
  index: 0,
  curve: "secp256k1",
  derivationPath: "m/84'/0'/0'/0/0",
  publicKey: "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
  address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  taprootPublicKey: "03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
};

/** The same account as a hardware wallet or older background would hand it over: no BIP-86 key. */
export const NO_TAPROOT_ACCOUNT: Account = { ...TEST_ACCOUNT, taprootPublicKey: undefined };
delete NO_TAPROOT_ACCOUNT.taprootPublicKey;

/** BIP-84 change key m/84'/0'/0'/1/0 of the same vector: used as "someone else". */
export const OTHER_PUB = hex.decode("03025324888e429ab8e3dbaf1f7802648b9cd01e9b418485c5fa4c1b9b5700e1a6");

export const T4 = networkById(BITCOIN_TESTNET4)!;
export const MY_WPKH_T4 = segwitAddress(hex.decode(TEST_ACCOUNT.publicKey), T4);
export const MY_TR_T4 = taprootAddress(hex.decode(TEST_ACCOUNT.taprootPublicKey!), T4);
/** P2TR address built from the BIP-84 key (what the old code wrongly treated as ours). */
export const BIP84_TR_T4 = taprootAddress(hex.decode(TEST_ACCOUNT.publicKey), T4);
export const BOB_T4 = segwitAddress(OTHER_PUB, T4);

export interface MockFetch {
  fetch: typeof fetch;
  requests: { url: string; method: string; body?: string }[];
}

/** Routes by URL suffix (longest match first). Values: JSON body, string (text body) or number (status). */
export function mockFetch(routes: Record<string, unknown>): MockFetch {
  const requests: MockFetch["requests"] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const r: MockFetch["requests"][number] = { url, method };
    if (init?.body) r.body = String(init.body);
    requests.push(r);
    const k = keys.find((key) => url.endsWith(key) || url.includes(`${key}?`));
    if (!k) return new Response("not found", { status: 404 });
    const v = routes[k];
    if (typeof v === "function") return (v as (u: string, i?: RequestInit) => Response)(url, init);
    if (typeof v === "number") return new Response("", { status: v });
    if (typeof v === "string") return new Response(v, { status: 200 });
    return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: f, requests };
}

export function ctx(m: MockFetch, network: Network = T4): ChainContext {
  return { network, account: TEST_ACCOUNT, fetch: m.fetch };
}

const txid = (c: string) => c.repeat(64);
export const UTXO_A = txid("a");
export const UTXO_B = txid("b");
export const UTXO_C = txid("c");

/** Testnet4 state for a send: two P2WPKH coins and one P2TR coin, 2 sat/vB. */
export const SEND_ROUTES = {
  [`/address/${MY_WPKH_T4}/utxo`]: [
    { txid: UTXO_A, vout: 0, value: 100_000, status: { confirmed: true } },
    { txid: UTXO_B, vout: 1, value: 5_000, status: { confirmed: true } },
    { txid: "d".repeat(64), vout: 0, value: 999_999, status: { confirmed: false } },
  ],
  [`/address/${MY_TR_T4}/utxo`]: [{ txid: UTXO_C, vout: 0, value: 50_000, status: { confirmed: true } }],
  "/fee-estimates": { "1": 5, "3": 2, "6": 1 },
  "/tx": "f".repeat(64),
};
