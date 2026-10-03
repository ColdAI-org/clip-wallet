/**
 * Runtime metadata: fetched once per (genesis, specVersion), decoded with @polkadot-api/substrate-bindings and
 * turned into dynamic codecs with @polkadot-api/metadata-builders. Metadata V15 is requested through the
 * `Metadata_metadata_at_version` runtime API; nodes without it fall back to `state_getMetadata` (V14).
 */
import { ClipError } from "@clip-wallet/core";
import { type MetadataLookup, getDynamicBuilder, getLookupFn } from "@polkadot-api/metadata-builders";
import { merkleizeMetadata } from "@polkadot-api/merkleize-metadata";
import { Bytes, Option, decAnyMetadata, unifyMetadata } from "@polkadot-api/substrate-bindings";
import { RpcError, type SubstrateRpc } from "./rpc.js";
import { fromHex, hex } from "./util.js";

export interface RuntimeVersion {
  specName: string;
  specVersion: number;
  transactionVersion: number;
}

export interface ExtensionDef {
  identifier: string;
  type: number;
  additionalSigned: number;
}

export interface Runtime {
  genesisHash: string;
  version: RuntimeVersion;
  bytes: Uint8Array;
  lookup: MetadataLookup;
  builder: ReturnType<typeof getDynamicBuilder>;
  extensions: ExtensionDef[];
  callType: number;
  addressType: number;
  signatureType: number;
  ss58: number;
  pallets: Set<string>;
  /** RFC-0078 metadata digest for CheckMetadataHash, computed lazily. */
  metadataHash(decimals: number, symbol: string): Uint8Array;
  hasCall(pallet: string, call: string): boolean;
  hasApi(api: string, method: string): boolean;
}

export function runtimeFromBytes(bytes: Uint8Array, genesisHash: string, version: RuntimeVersion): Runtime {
  const meta = unifyMetadata(decAnyMetadata(bytes));
  const lookup = getLookupFn(meta);
  const builder = getDynamicBuilder(lookup);
  const ext = meta.extrinsic as unknown as {
    call: number;
    address: number;
    signature: number;
    extensionsByVersion?: Record<string, ExtensionDef[]>;
    signedExtensions?: ExtensionDef[];
  };
  const extensions = ext.extensionsByVersion?.["0"] ?? ext.signedExtensions ?? [];
  const pallets = new Set(meta.pallets.map((p) => p.name));
  const digests = new Map<string, Uint8Array>();
  return {
    genesisHash,
    version,
    bytes,
    lookup,
    builder,
    extensions,
    callType: ext.call,
    addressType: ext.address,
    signatureType: ext.signature,
    ss58: builder.ss58Prefix ?? 42,
    pallets,
    metadataHash(decimals, symbol) {
      const k = `${decimals}|${symbol}`;
      let d = digests.get(k);
      if (!d) digests.set(k, (d = merkleizeMetadata(bytes, { decimals, tokenSymbol: symbol }).digest()));
      return d;
    },
    hasCall(pallet, call) {
      try {
        builder.buildCall(pallet, call);
        return true;
      } catch {
        return false;
      }
    },
    hasApi(api, method) {
      try {
        builder.buildRuntimeCall(api, method);
        return true;
      } catch {
        return false;
      }
    },
  };
}

const cache = new Map<string, Runtime>();
export function clearRuntimeCache(): void {
  cache.clear();
}

export async function runtimeVersion(rpc: SubstrateRpc, at?: string): Promise<RuntimeVersion> {
  return rpc.call<RuntimeVersion>("state_getRuntimeVersion", at ? [at] : []);
}

/** Metadata for the runtime at `at` (a block hash) or the best block. Cached by genesis + specVersion. */
export async function loadRuntime(rpc: SubstrateRpc, genesisHash: string, at?: string, version?: RuntimeVersion): Promise<Runtime> {
  const v = version ?? (await runtimeVersion(rpc, at));
  const key = `${genesisHash.toLowerCase()}|${v.specVersion}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let bytes: Uint8Array | undefined;
  try {
    const res = await rpc.call<string>("state_call", ["Metadata_metadata_at_version", "0x0f000000", ...(at ? [at] : [])]);
    bytes = Option(Bytes()).dec(res) ?? undefined;
  } catch (e) {
    if (!(e instanceof RpcError)) throw e;
  }
  if (!bytes) bytes = fromHex(await rpc.call<string>("state_getMetadata", at ? [at] : []));
  let rt: Runtime;
  try {
    rt = runtimeFromBytes(bytes, genesisHash, v);
  } catch (cause) {
    throw new ClipError("This network's runtime couldn't be read.", "substrate/bad-metadata", cause);
  }
  cache.set(key, rt);
  return rt;
}

/** Seeds the cache (tests, or metadata shipped with the extension). */
export function provideRuntime(rt: Runtime): void {
  cache.set(`${rt.genesisHash.toLowerCase()}|${rt.version.specVersion}`, rt);
}

export { hex };
