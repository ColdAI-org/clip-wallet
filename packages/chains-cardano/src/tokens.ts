/**
 * Native asset metadata from Koios /asset_info: Cardano Token Registry (decimals, ticker), CIP-25 (label 721 in the
 * latest mint transaction's metadata) and CIP-68 (reference-token datum, labels 222 NFT / 333 FT / 444 RFT).
 */
import type { AssetRef, Nft, NetworkId } from "@clip-wallet/core";
import type { Koios, KoiosAssetInfo } from "./koios.js";
import { tokenAssetKey } from "./networks.js";
import { cip68Label, displayAssetName, nameOf, policyOf } from "./value.js";

export interface AssetMeta {
  unit: string;
  name: string;
  ticker?: string;
  decimals: number;
  totalSupply?: string;
  nft?: { standard: "cip25" | "cip68"; name?: string; image?: string; attributes?: { trait: string; value: string }[] };
}

const cache = new Map<string, AssetMeta>();
export function clearAssetCache(): void {
  cache.clear();
}

const utf8 = (h: string): string | null => {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
};

/** Untrusted media: keep only https / ipfs / ar URLs (rendered through the sandboxed media proxy). */
export function safeMedia(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v.filter((x) => typeof x === "string").join("") : typeof v === "string" ? v : "";
  if (/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(s)) return s;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$|^baf[a-z2-7]{50,}$/.test(s)) return `ipfs://${s}`;
  return undefined;
}

function attributesOf(meta: Record<string, unknown>, skip: Set<string>): { trait: string; value: string }[] {
  const out: { trait: string; value: string }[] = [];
  const add = (k: string, v: unknown) => {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push({ trait: k, value: String(v) });
  };
  const attrs = meta.attributes ?? meta.traits;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) for (const [k, v] of Object.entries(attrs)) add(k, v);
  for (const [k, v] of Object.entries(meta)) if (!skip.has(k)) add(k, v);
  return out.slice(0, 32);
}

/** CIP-25: metadata[721][policy][assetName] (v1 keys are UTF-8 names, v2 keys are hex). */
export function cip25Of(info: KoiosAssetInfo): Record<string, unknown> | null {
  const m = info.minting_tx_metadata as Record<string, unknown> | null | undefined;
  const l721 = (m?.["721"] ?? null) as Record<string, Record<string, Record<string, unknown>>> | null;
  if (!l721 || typeof l721 !== "object") return null;
  const byPolicy = l721[info.policy_id];
  if (!byPolicy || typeof byPolicy !== "object") return null;
  const nameHex = info.asset_name ?? "";
  return byPolicy[info.asset_name_ascii ?? ""] ?? byPolicy[nameHex] ?? byPolicy[utf8(nameHex) ?? "\u0000"] ?? null;
}

/** Plutus-data JSON (Koios / cardano-cli detailed schema) → plain JS. Bytes become UTF-8 when printable. */
export function plutusJson(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (typeof o.bytes === "string") return utf8(o.bytes) ?? o.bytes;
  if (typeof o.int === "number" || typeof o.int === "string") return o.int;
  if (Array.isArray(o.list)) return o.list.map(plutusJson);
  if (Array.isArray(o.map)) {
    const out: Record<string, unknown> = {};
    for (const e of o.map as { k: unknown; v: unknown }[]) out[String(plutusJson(e.k))] = plutusJson(e.v);
    return out;
  }
  if (Array.isArray(o.fields)) return { constructor: o.constructor, fields: o.fields.map(plutusJson) };
  return v;
}

/** CIP-68: the reference datum is Constr 0 [metadata map, version, extra]. */
export function cip68Of(info: KoiosAssetInfo): Record<string, unknown> | null {
  const label = cip68Label(info.asset_name ?? "");
  const key = label === "nft" ? "222" : label === "ft" ? "333" : label === "rft" ? "444" : null;
  if (!key) return null;
  const datum = info.cip68_metadata?.[key];
  if (!datum) return null;
  const d = plutusJson(datum) as { fields?: unknown[] };
  const meta = d?.fields?.[0];
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;
}

function metaFrom(unit: string, info: KoiosAssetInfo | undefined): AssetMeta {
  const nameHex = nameOf(unit);
  const fallback = displayAssetName(nameHex);
  if (!info) return { unit, name: fallback, decimals: 0 };
  const reg = info.token_registry_metadata ?? null;
  const label = cip68Label(nameHex);
  const c68 = cip68Of(info);
  const c25 = label ? null : cip25Of(info);
  const decimals =
    typeof reg?.decimals === "number" ? reg.decimals : typeof c68?.decimals === "number" || typeof c68?.decimals === "string" ? Number(c68.decimals) : 0;
  const meta: AssetMeta = { unit, name: String(c68?.name ?? reg?.name ?? c25?.name ?? fallback), decimals: Number.isFinite(decimals) ? decimals : 0 };
  const ticker = reg?.ticker ?? (typeof c68?.ticker === "string" ? c68.ticker : undefined);
  if (ticker) meta.ticker = ticker;
  if (info.total_supply) meta.totalSupply = info.total_supply;
  const isNft = label === "nft" || label === "rft" || (c25 !== null && info.total_supply === "1") || (c25 !== null && label === null && !reg);
  if (isNft) {
    const src = (c68 ?? c25 ?? {}) as Record<string, unknown>;
    const nft: NonNullable<AssetMeta["nft"]> = { standard: c68 ? "cip68" : "cip25" };
    if (typeof src.name === "string") nft.name = src.name;
    const image = safeMedia(src.image);
    if (image) nft.image = image;
    const attributes = attributesOf(src, new Set(["name", "image", "mediaType", "files", "description", "attributes", "traits"]));
    if (attributes.length) nft.attributes = attributes;
    meta.nft = nft;
  }
  return meta;
}

/** Metadata for many units, cached per network + unit. Failures fall back to the asset name. */
export async function assetMetas(koios: Koios, networkId: NetworkId, units: string[]): Promise<Map<string, AssetMeta>> {
  const out = new Map<string, AssetMeta>();
  const missing = [...new Set(units)].filter((u) => {
    const c = cache.get(`${networkId}|${u}`);
    if (c) out.set(u, c);
    return !c;
  });
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const infos = await koios.assetInfo(chunk.map((u) => [policyOf(u), nameOf(u)])).catch(() => [] as KoiosAssetInfo[]);
    for (const u of chunk) {
      const info = infos.find((x) => x.policy_id === policyOf(u) && (x.asset_name ?? "") === nameOf(u));
      const m = metaFrom(u, info);
      if (info) cache.set(`${networkId}|${u}`, m);
      out.set(u, m);
    }
  }
  return out;
}

export function assetRefFor(networkId: NetworkId, meta: AssetMeta): AssetRef {
  return {
    key: tokenAssetKey(meta.unit),
    symbol: meta.ticker ?? meta.name.slice(0, 12),
    name: meta.name,
    decimals: meta.decimals,
    networkId,
    address: meta.unit,
  };
}

export function nftFor(networkId: NetworkId, meta: AssetMeta): Nft {
  const n = meta.nft!;
  const nft: Nft = {
    networkId,
    standard: n.standard,
    collection: { address: policyOf(meta.unit), name: meta.ticker ?? `Policy ${policyOf(meta.unit).slice(0, 8)}…` },
    tokenId: meta.unit,
  };
  const name = n.name ?? meta.name;
  if (name) nft.name = name;
  if (n.image) nft.mediaUrl = n.image; // untrusted: sandboxed media proxy only
  if (n.attributes) nft.attributes = n.attributes;
  return nft;
}
