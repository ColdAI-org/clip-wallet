import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { address, getAddressEncoder } from "@solana/kit";
import { SOLANA_DEVNET } from "../src/index.js";
import { hex } from "../src/util.js";

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/** Vault stand-in: answers with a precomputed signature that verifies for the payload (verification only). */
export function fixtureSigner(me: string, signatures: readonly string[]) {
  const pub = new Uint8Array(getAddressEncoder().encode(address(me)));
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
  return {
    id: "solana:0",
    family: "solana",
    index: 0,
    curve: "ed25519",
    derivationPath: "m/44'/501'/0'/0'",
    publicKey: hex(new Uint8Array(getAddressEncoder().encode(address(me)))),
    address: me,
  };
}

type Handler = (params: unknown[]) => unknown;

/** Mock JSON-RPC (by method) plus plain URL routes. A handler may throw {code,message,data} for an RPC error. */
export function mockSolana(methods: Record<string, Handler>, urls: [RegExp, unknown][] = []) {
  const calls: { method: string; params: unknown[] }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [re, body] of urls) {
      if (re.test(url)) {
        const v = typeof body === "function" ? (body as (b: unknown) => unknown)(init?.body ? JSON.parse(String(init.body)) : null) : body;
        return new Response(JSON.stringify(v), { status: 200 });
      }
    }
    const req = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string; params: unknown[] };
    calls.push({ method: req.method, params: req.params });
    const h = methods[req.method];
    if (!h) return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `no mock for ${req.method}` } }));
    try {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: h(req.params) }));
    } catch (e) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: e }));
    }
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function ctxFor(account: Account, fetchImpl: typeof fetch): ChainContext {
  return { network: SOLANA_DEVNET, account, fetch: fetchImpl };
}

export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const mintAccount = (decimals: number, supply: string, owner = TOKEN, extensions?: unknown[]) => ({
  lamports: 1461600,
  owner,
  executable: false,
  data: { program: owner === TOKEN ? "spl-token" : "spl-token-2022", parsed: { type: "mint", info: { decimals, supply, isInitialized: true, ...(extensions ? { extensions } : {}) } } },
});

export const tokenAccount = (mint: string, owner: string, amount: string, decimals: number, program = TOKEN) => ({
  lamports: 2039280,
  owner: program,
  executable: false,
  data: { program: "spl-token", parsed: { type: "account", info: { mint, owner, tokenAmount: { amount, decimals, uiAmountString: "" }, state: "initialized" } } },
});

/** Builds a Metaplex metadata account (borsh) for tests. */
export function metaplexData(mint: Uint8Array, name: string, symbol: string, uri: string, collection?: Uint8Array): string {
  const enc = new TextEncoder();
  const str = (s: string, pad: number) => {
    const b = new Uint8Array(pad);
    b.set(enc.encode(s));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, pad, true);
    return [...len, ...b];
  };
  const bytes = [
    4,
    ...new Uint8Array(32),
    ...mint,
    ...str(name, 32),
    ...str(symbol, 10),
    ...str(uri, 200),
    0, 0, // seller fee
    0, // creators: None
    0, 1, // primary sale, mutable
    0, // edition nonce: None
    0, // token standard: None
    ...(collection ? [1, 1, ...collection] : [0]),
  ];
  return btoa(String.fromCharCode(...bytes));
}
