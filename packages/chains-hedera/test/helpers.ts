import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { PublicKey } from "@hiero-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HEDERA_TESTNET, aliasAddress } from "../src/index.js";
import { fromHex, hex } from "../src/util.js";

/**
 * Test-only stand-in for the vault: answers each payload with a precomputed signature (see signatures.ts)
 * whose digest matches. Uses verification only; no key material here.
 */
export function fixtureSigner(publicKeyHex: string, signatures: readonly string[]) {
  const pk = PublicKey.fromStringECDSA(publicKeyHex);
  const sigs = signatures.map(fromHex);
  return {
    publicKeyHex,
    sign(p: SignablePayload): Signature {
      if (p.bytes.length !== 32) throw new Error("ecdsa payload must be a 32-byte digest");
      // PublicKey.verify hashes with keccak256 itself, so match against the digest via a prehashed check.
      const sig = sigs.find((s) => verifyDigest(pk, p.bytes, s));
      if (!sig) throw new Error(`no fixture signature for digest ${hex(p.bytes)}`);
      return { scheme: "ecdsa-secp256k1", bytes: sig, publicKey: publicKeyHex };
    },
  };
}

function verifyDigest(pk: PublicKey, digest: Uint8Array, sig: Uint8Array): boolean {
  return secp256k1.verify(sig, digest, pk.toBytesRaw(), { prehash: false });
}
export function makeAccount(publicKeyHex: string, hederaAccountId?: string): Account {
  const a: Account = {
    id: "hedera:0",
    family: "hedera",
    index: 0,
    curve: "secp256k1",
    derivationPath: "m/44'/60'/0'/0/0",
    publicKey: publicKeyHex,
    address: aliasAddress(publicKeyHex),
  };
  if (hederaAccountId) a.hederaAccountId = hederaAccountId;
  return a;
}

type Route = [RegExp, unknown | ((url: string) => unknown)];

/** Mocked fetch: first matching route wins; `undefined` result → 404. Records every URL. */
export function mockFetch(routes: Route[]) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [re, body] of routes) {
      if (re.test(url)) {
        const v = typeof body === "function" ? (body as (u: string) => unknown)(url) : body;
        if (v === undefined) break;
        return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ _status: { messages: [{ message: "Not found" }] } }), { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(account: Account, fetchImpl: typeof fetch): ChainContext {
  return { network: HEDERA_TESTNET, account, fetch: fetchImpl };
}

export const SAUCE = { token_id: "0.0.731861", name: "SAUCE", symbol: "SAUCE", decimals: "6", type: "FUNGIBLE_COMMON", total_supply: "1000000000000000" };
export const USDC = { token_id: "0.0.429274", name: "USD Coin", symbol: "USDC", decimals: "6", type: "FUNGIBLE_COMMON", total_supply: "16000000000000" };
export const APES = { token_id: "0.0.8888", name: "Hedera Apes", symbol: "HAPE", decimals: "0", type: "NON_FUNGIBLE_UNIQUE", total_supply: "100" };

export function mirrorAccount(id: string, extra: Record<string, unknown> = {}) {
  return {
    account: id,
    evm_address: null,
    alias: null,
    balance: { balance: 2500000000, timestamp: "1", tokens: [] },
    max_automatic_token_associations: 0,
    staked_node_id: null,
    staked_account_id: null,
    decline_reward: false,
    pending_reward: 0,
    ...extra,
  };
}
