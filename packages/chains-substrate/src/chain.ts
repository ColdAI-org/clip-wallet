/** Storage reads and runtime-API calls through metadata-built codecs. */
import type { Runtime } from "./metadata.js";
import type { SubstrateRpc } from "./rpc.js";
import { hex0x } from "./util.js";

export async function readStorage<T = unknown>(rpc: SubstrateRpc, rt: Runtime, pallet: string, entry: string, ...keys: unknown[]): Promise<T | null> {
  if (!rt.pallets.has(pallet)) return null;
  const s = rt.builder.buildStorage(pallet, entry);
  const raw = await rpc.call<string | null>("state_getStorage", [s.keys.enc(...keys)]);
  if (raw === null || raw === undefined) return (s.fallback ?? null) as T | null;
  return s.value.dec(raw) as T;
}

/** Every key under a (partial) storage prefix, decoded into its key arguments. */
export async function storageKeys(rpc: SubstrateRpc, rt: Runtime, pallet: string, entry: string, prefixArgs: unknown[], max = 1000): Promise<unknown[][]> {
  if (!rt.pallets.has(pallet)) return [];
  const s = rt.builder.buildStorage(pallet, entry);
  const prefix = s.keys.enc(...prefixArgs);
  const out: unknown[][] = [];
  let start: string | undefined;
  for (;;) {
    const page = await rpc.call<string[]>("state_getKeysPaged", [prefix, 200, ...(start ? [start] : [])]);
    for (const k of page) out.push(s.keys.dec(k));
    if (page.length < 200 || out.length >= max) break;
    start = page[page.length - 1];
  }
  return out;
}

export async function runtimeCall<T = unknown>(rpc: SubstrateRpc, rt: Runtime, api: string, method: string, args: unknown[]): Promise<T> {
  const c = rt.builder.buildRuntimeCall(api, method);
  // The args codec returns bytes; JSON-RPC wants them as 0x hex.
  const res = await rpc.call<string>("state_call", [`${api}_${method}`, hex0x(c.args.enc(args))]);
  return c.value.dec(res) as T;
}

/**
 * Every entry under a (partial) storage prefix with its value: keys from `state_getKeysPaged`, values in one
 * `state_queryStorageAt` per page. Returns [decoded key args, decoded value].
 */
export async function storageEntries<T = unknown>(rpc: SubstrateRpc, rt: Runtime, pallet: string, entry: string, prefixArgs: unknown[] = [], max = 2000): Promise<[unknown[], T][]> {
  if (!rt.pallets.has(pallet)) return [];
  const s = rt.builder.buildStorage(pallet, entry);
  const prefix = s.keys.enc(...prefixArgs);
  const out: [unknown[], T][] = [];
  let start: string | undefined;
  for (;;) {
    const page = await rpc.call<string[]>("state_getKeysPaged", [prefix, 200, ...(start ? [start] : [])]);
    if (page.length) {
      const sets = await rpc.call<{ changes: [string, string | null][] }[]>("state_queryStorageAt", [page]);
      for (const [k, v] of sets[0]?.changes ?? []) if (v != null) out.push([s.keys.dec(k), s.value.dec(v) as T]);
    }
    if (page.length < 200 || out.length >= max) break;
    start = page[page.length - 1];
  }
  return out;
}

/** A pallet constant decoded through metadata (null when the pallet or constant is missing). */
export function constantOf<T = unknown>(rt: Runtime, pallet: string, name: string): T | null {
  if (!rt.pallets.has(pallet)) return null;
  try {
    const c = rt.lookup.metadata.pallets.find((p) => p.name === pallet)?.constants.find((x) => x.name === name);
    if (!c) return null;
    return rt.builder.buildConstant(pallet, name).dec(c.value) as T;
  } catch {
    return null;
  }
}
