/**
 * Polkadot / Asset Hub test fixtures: the real Westend Asset Hub metadata V15 (specVersion 1025001) that
 * chains-substrate ships in its test fixtures, mocked JSON-RPC answers encoded with the codecs built from that
 * metadata, and public keys only (chains-substrate/test/signatures.ts). Nothing here signs.
 */
import type { Account, ChainContext, DappRequest, Network } from "@clip-wallet/core";
import { WESTEND_ASSET_HUB, clearRuntimeCache, parsePayload, provideRuntime, runtimeFromBytes, type Runtime } from "@clip-wallet/chains-substrate";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const METADATA = gunzipSync(readFileSync(new URL("../../chains-substrate/test/fixtures/westend-asset-hub-metadata-v15.scale.gz", import.meta.url)));
export const VERSION = { specName: "westmint", specVersion: 1025001, transactionVersion: 16 };
const GENESIS = "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9";

/** Public keys from chains-substrate/test/signatures.ts (FIX.pub, FIX.bob). */
export const PUB = "30944fd710729d3e5f6a37c807b8addc4790f0ffe1c56a3c190fabf2680cc31f";
export const BOB_PUB = "29699b799d38ff33a0a722186972e05cf07b26a602407a52591e9a7cda1b94f1";

let rt: Runtime | undefined;
export function runtime(): Runtime {
  rt ??= runtimeFromBytes(METADATA, GENESIS, VERSION);
  return rt;
}
export function seed(): Runtime {
  clearRuntimeCache();
  provideRuntime(runtime());
  return runtime();
}

const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

/** SS58 with the generic prefix 42 (what Westend Asset Hub uses). */
export const ss58 = (pub: string): string => runtime().builder.buildDefinition(runtime().addressType).dec(new Uint8Array([0, ...fromHex(pub)])).value as string;
export const ME = ss58(PUB);
export const BOB = ss58(BOB_PUB);

export const enc = {
  key: (pallet: string, entry: string, ...keys: unknown[]) => runtime().builder.buildStorage(pallet, entry).keys.enc(...keys),
  value: (pallet: string, entry: string, v: unknown) => hex(runtime().builder.buildStorage(pallet, entry).value.enc(v)),
  api: (api: string, method: string, v: unknown) => hex(runtime().builder.buildRuntimeCall(api, method).value.enc(v)),
  apiArgs: (api: string, method: string, data: string) => runtime().builder.buildRuntimeCall(api, method).args.dec(data) as unknown[],
};

export const BASE = {
  chain_getFinalizedHead: () => `0x${"ab".repeat(32)}`,
  chain_getHeader: () => ({ number: "0xbc614e" }),
  system_accountNextIndex: () => 5,
  state_getRuntimeVersion: () => VERSION,
};

type Handler = (params: unknown[]) => unknown;
/** `state_call` handlers get the decoded runtime-API args. */
type ApiHandler = string | ((args: unknown[]) => string);

/**
 * Mock Substrate JSON-RPC: `state_getStorage` by key, `state_call` by runtime-API name, `state_getKeysPaged` /
 * `state_queryStorageAt` over the given storage map, anything else by method.
 */
export function mockRpc(storage: Record<string, string> = {}, apis: Record<string, ApiHandler> = {}, methods: Record<string, Handler> = {}) {
  const log: { method: string; params: unknown[] }[] = [];
  const f = (async (_input: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { id: number; method: string; params: unknown[] };
    log.push({ method: req.method, params: req.params });
    const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
    const err = (message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } }));
    const all = { ...BASE, ...methods };
    if (req.method === "state_getStorage") return ok(storage[String(req.params[0])] ?? null);
    if (req.method === "state_getKeysPaged") {
      const prefix = String(req.params[0]);
      const start = req.params[2] as string | undefined;
      return ok(
        Object.keys(storage)
          .filter((k) => k.startsWith(prefix) && k !== prefix && (!start || k > start))
          .sort()
          .slice(0, Number(req.params[1])),
      );
    }
    if (req.method === "state_queryStorageAt") return ok([{ block: "0x", changes: (req.params[0] as string[]).map((k) => [k, storage[k] ?? null]) }]);
    if (req.method === "state_call") {
      const [name, data] = req.params as [string, string];
      const h = apis[name];
      if (h === undefined) return err(`no mock for ${name}`);
      const i = name.indexOf("_");
      return ok(typeof h === "string" ? h : h(enc.apiArgs(name.slice(0, i), name.slice(i + 1), data)));
    }
    if (all[req.method as keyof typeof all]) return ok((all[req.method as keyof typeof all] as Handler)(req.params));
    return err(`no mock for ${req.method}`);
  }) as typeof fetch;
  return { fetch: f, log };
}

export function account(pub = PUB): Account {
  return { id: "substrate:0", family: "substrate", index: 0, curve: "sr25519", derivationPath: "", publicKey: pub, address: ss58(pub) };
}

export function ctxFor(fetchImpl: typeof fetch, network: Network = WESTEND_ASSET_HUB): ChainContext {
  return { network, account: account(), fetch: fetchImpl };
}

/** The call inside a wallet-built `substrate_signAndSubmit` request, decoded with the real metadata. */
export function callOf(r: DappRequest): { pallet: string; call: string; args: Record<string, unknown> } {
  const p = parsePayload((r.params as { payload: unknown }).payload);
  const c = runtime().builder.buildDefinition(runtime().callType).dec(p.method) as { type: string; value: { type: string; value: Record<string, unknown> } };
  return { pallet: c.type, call: c.value.type, args: c.value.value };
}

/** System.Account value with this free balance. */
export const systemAccount = (free: bigint) => ({ nonce: 0, consumers: 0, providers: 1, sufficients: 0, data: { free, reserved: 0n, frozen: 0n, flags: 0n } });

export const WND = (n: number | string) => BigInt(Math.round(Number(n) * 1e6)) * 1_000_000n; // 12 decimals
