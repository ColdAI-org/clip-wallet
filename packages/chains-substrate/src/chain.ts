/** Storage reads and runtime-API calls through metadata-built codecs. */
import type { Runtime } from "./metadata.js";
import type { SubstrateRpc } from "./rpc.js";

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
  const res = await rpc.call<string>("state_call", [`${api}_${method}`, c.args.enc(args)]);
  return c.value.dec(res) as T;
}
