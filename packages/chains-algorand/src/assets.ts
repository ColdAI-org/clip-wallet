import type { AssetRef, NetworkId } from "@clip-wallet/core";
import { decodeAddress } from "algosdk";
import { type Algod, AlgodError, type AssetParamsJson } from "./algod.js";
import { asaAssetKey } from "./networks.js";
import { big } from "./util.js";

export interface AsaInfo {
  id: string;
  creator: string;
  decimals: number;
  total: bigint;
  name: string;
  unitName: string;
  url: string;
  reserve: string;
}

const cache = new Map<string, AsaInfo | null>();

export function clearAssetCache(): void {
  cache.clear();
}

export function asaInfoFromParams(id: string, p: AssetParamsJson): AsaInfo {
  return {
    id,
    creator: p.creator,
    decimals: Number(p.decimals ?? 0),
    total: big(p.total),
    name: p.name ?? "",
    unitName: p["unit-name"] ?? "",
    url: p.url ?? "",
    reserve: p.reserve ?? "",
  };
}

/** algod GET /v2/assets/{id}, cached per algod URL. null when the asset doesn't exist (or was destroyed). */
export async function asaInfo(algod: Algod, id: string | bigint): Promise<AsaInfo | null> {
  const key = `${algod.url}|${id}`;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const r = await algod.get<{ index: unknown; params: AssetParamsJson }>(`/v2/assets/${id}`);
    const info = asaInfoFromParams(String(id), r.params);
    cache.set(key, info);
    return info;
  } catch (e) {
    if (e instanceof AlgodError && e.status === 404) {
      cache.set(key, null);
      return null;
    }
    throw e;
  }
}

export function asaAsset(networkId: NetworkId, id: string | bigint, info: AsaInfo | null | undefined): AssetRef {
  const sid = String(id);
  const key = asaAssetKey(networkId, sid);
  const symbol = info?.unitName || (key === "usdc" ? "USDC" : `ASA ${sid}`);
  return {
    key,
    symbol,
    name: info?.name || symbol,
    decimals: info?.decimals ?? 0,
    networkId,
    address: sid,
  };
}

/* ------------------------------------------------------------------ NFTs (ARC-3 / ARC-19 / ARC-69) */

export function isArc3(info: AsaInfo): boolean {
  return info.name === "arc3" || info.name.endsWith("@arc3") || info.url.endsWith("#arc3");
}

export function isArc19(info: AsaInfo): boolean {
  return info.url.startsWith("template-ipfs://");
}

/**
 * ARC-3: pure NFT (total 1, decimals 0) or fractional NFT (total = 10^decimals, decimals > 0).
 * A fractional supply only counts with an ARC-3 / ARC-19 marker, since plenty of fungible tokens have such totals.
 */
export function isNftAsset(info: AsaInfo): boolean {
  if (info.total === 1n && info.decimals === 0) return true;
  return info.decimals > 0 && info.total === 10n ** BigInt(info.decimals) && (isArc3(info) || isArc19(info));
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = `1${s}`;
  }
  return s;
}

function base32Lower(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** Multicodec codes for the content types ARC-19 requires (raw, dag-pb) plus the common IPLD ones. */
const CODECS: Record<string, number> = { raw: 0x55, "dag-pb": 0x70, "dag-cbor": 0x71, "dag-json": 0x0129, json: 0x0200 };
const HASHES: Record<string, number> = { "sha2-256": 0x12 };

const TEMPLATE = /\{ipfscid:([01]):([a-z0-9-]+):([a-z0-9-]+):([a-z0-9-]+)\}/;

/**
 * ARC-19: `template-ipfs://{ipfscid:<version>:<codec>:reserve:<hash>}[/path]` → `ipfs://<cid>[/path]`, with the
 * CID's 32-byte digest taken from the reserve address. Returns null for an unsupported template.
 */
export function resolveArc19Url(url: string, reserve: string): string | null {
  if (!url.startsWith("template-ipfs://")) return url;
  const m = url.match(TEMPLATE);
  if (!m) return null;
  const [, version, codecName, field, hashName] = m;
  if (field !== "reserve") return null;
  const codec = CODECS[codecName!];
  const hash = HASHES[hashName!];
  if (codec == null || hash == null) return null;
  let digest: Uint8Array;
  try {
    digest = decodeAddress(reserve).publicKey;
  } catch {
    return null;
  }
  const multihash = Uint8Array.from([hash, digest.length, ...digest]);
  let cid: string;
  if (version === "0") {
    if (codecName !== "dag-pb" || hashName !== "sha2-256") return null; // CIDv0 is always dag-pb + sha2-256
    cid = base58(multihash);
  } else {
    cid = `b${base32Lower(Uint8Array.from([...varint(1), ...varint(codec), ...multihash]))}`;
  }
  return `ipfs://${url.slice("template-ipfs://".length).replace(m[0], cid)}`;
}

/** ipfs:// → gateway URL; strips a trailing #arc3 / ARC-69 media fragment; other schemes unchanged. */
export function httpUrl(uri: string, gateway: string): string {
  let u = uri.replace(/#arc3$/, "");
  if (u.startsWith("ipfs://")) u = `${gateway.replace(/\/?$/, "/")}${u.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  return u;
}

/** ARC-3: a URI without ":" is relative to the metadata URL. */
export function resolveRelative(uri: string, base: string): string {
  if (uri.includes(":")) return uri;
  const b = base.replace(/#.*$/, "");
  return `${b.slice(0, b.lastIndexOf("/") + 1)}${uri}`;
}

export interface Metadata {
  name?: string;
  image?: string;
  animation_url?: string;
  description?: string;
  properties?: Record<string, unknown>;
  attributes?: { trait_type?: unknown; value?: unknown }[];
  media_url?: string;
  standard?: string;
}

export async function fetchJson(url: string, f: typeof fetch): Promise<Metadata | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await f(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const v = (await res.json()) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Metadata) : null;
  } catch {
    return null;
  }
}

export function attributesOf(md: Metadata): { trait: string; value: string }[] {
  const out: { trait: string; value: string }[] = [];
  if (Array.isArray(md.attributes)) {
    for (const a of md.attributes) if (a && a.trait_type != null) out.push({ trait: String(a.trait_type), value: String(a.value ?? "") });
  }
  if (md.properties && typeof md.properties === "object") {
    for (const [k, v] of Object.entries(md.properties)) if (v == null || typeof v !== "object") out.push({ trait: k, value: String(v ?? "") });
  }
  return out;
}
