import type { Account, ChainContext, SignablePayload, Signature } from "@clip-wallet/core";
import { Binary, Bytes, Enum, Option, fromBufferToBase58 } from "@polkadot-api/substrate-bindings";
import { verify } from "@scure/sr25519";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { WESTEND_ASSET_HUB, clearRuntimeCache, provideRuntime, runtimeFromBytes, type Runtime, type SignerPayloadJSON } from "../src/index.js";
import { concat, fromHex, hex, hex0x } from "../src/util.js";

/** Westend Asset Hub runtime metadata V15 (specVersion 1025001, transactionVersion 16), read 2026-10-03. */
export const METADATA = gunzipSync(readFileSync(new URL("./fixtures/westend-asset-hub-metadata-v15.scale.gz", import.meta.url)));
export const VERSION = { specName: "westmint", specVersion: 1025001, transactionVersion: 16 };
export const GENESIS = "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9";
export const BLOCK_HASH = `0x${"ab".repeat(32)}`;
export const BLOCK_NUMBER = 12_345_678n;

let rt: Runtime | undefined;
export function runtime(): Runtime {
  rt ??= runtimeFromBytes(METADATA, GENESIS, VERSION);
  return rt;
}
export function seedRuntime(): Runtime {
  clearRuntimeCache();
  const r = runtime();
  provideRuntime(r);
  return r;
}

export const ss58 = (pub: string, prefix = 42) => fromBufferToBase58(prefix)(fromHex(pub));

export function makeAccount(pub: string): Account {
  return { id: "substrate:0", family: "substrate", index: 0, curve: "sr25519", derivationPath: "", publicKey: pub, address: ss58(pub) };
}

/** Vault stand-in: answers with a precomputed sr25519 signature that verifies for the payload (verification only). */
export function fixtureSigner(pub: string, signatures: readonly string[]) {
  const sigs = signatures.map(fromHex);
  return {
    sign(p: SignablePayload): Signature {
      const sig = sigs.find((s) => verify(p.bytes, s, fromHex(pub)));
      if (!sig) throw new Error("no fixture signature for this payload");
      return { scheme: "sr25519", bytes: sig, publicKey: pub };
    },
  };
}

type Handler = (params: unknown[]) => unknown;

/** Mock JSON-RPC by method; `state_call` by runtime-API name; `state_getStorage` by key. */
export function mockRpc(methods: Record<string, Handler>, calls: Record<string, string> = {}, storage: Record<string, string> = {}) {
  const log: { method: string; params: unknown[] }[] = [];
  const f = (async (_input: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string; params: unknown[] };
    log.push({ method: req.method, params: req.params });
    let result: unknown;
    if (req.method === "state_call" && typeof req.params[0] === "string" && req.params[0] in calls) result = calls[req.params[0]];
    else if (req.method === "state_getStorage") result = storage[String(req.params[0])] ?? null;
    else if (methods[req.method]) {
      try {
        result = methods[req.method]!(req.params);
      } catch (e) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: e }));
      }
    } else return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `no mock for ${req.method} ${String(req.params[0])}` } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
  }) as typeof fetch;
  return { fetch: f, log };
}

export function ctxFor(account: Account, fetchImpl: typeof fetch): ChainContext {
  return { network: WESTEND_ASSET_HUB, account, fetch: fetchImpl };
}

/** Call bytes for `pallet.call(args)` through the fixture metadata. */
export function callBytes(pallet: string, call: string, args: unknown): Uint8Array {
  const c = runtime().builder.buildCall(pallet, call);
  return concat(Uint8Array.from(c.location), c.codec.enc(args));
}

/** A SignerPayloadJSON like polkadot.js builds for Westend Asset Hub (era: mortal 64 from BLOCK_NUMBER). */
export function payloadJson(address: string, method: Uint8Array, over: Partial<SignerPayloadJSON> = {}): SignerPayloadJSON {
  return {
    address,
    assetId: null,
    blockHash: BLOCK_HASH,
    blockNumber: "0x00bc614e",
    era: "0xe500",
    genesisHash: GENESIS,
    metadataHash: null,
    method: hex0x(method),
    mode: 0,
    nonce: "0x00000005",
    signedExtensions: runtime().extensions.map((e) => e.identifier),
    specVersion: "0x000fa3e9",
    tip: "0x00000000000000000000000000000000",
    transactionVersion: "0x00000010",
    version: 4,
    ...over,
  };
}

/** Encoded storage values / runtime-API results through the fixture metadata. */
export const enc = {
  storageKey: (pallet: string, entry: string, ...keys: unknown[]) => runtime().builder.buildStorage(pallet, entry).keys.enc(...keys),
  storageValue: (pallet: string, entry: string, value: unknown) => hex0x(runtime().builder.buildStorage(pallet, entry).value.enc(value)),
  apiResult: (api: string, method: string, value: unknown) => hex0x(runtime().builder.buildRuntimeCall(api, method).value.enc(value)),
  metadataCall: () => hex0x(Option(Bytes()).enc(METADATA)),
};

export { Binary, Enum, hex, hex0x, fromHex };
