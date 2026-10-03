/**
 * NEP-141 fungible tokens and NEP-171 NFTs.
 *  - Which contracts an account touches: FastNEAR API (github.com/fastnear/fastnear-api-server-rs README)
 *    GET /v1/account/{id}/ft → { tokens: [{ contract_id, balance, last_update_block_height }] }
 *    GET /v1/account/{id}/nft → { tokens: [{ contract_id, last_update_block_height }] }
 *    GET /v1/account/{id}/staking → { pools: [{ pool_id, last_update_block_height }] }
 *    GET /v0/public_key/{pk} → { public_key, account_ids } (full-access keys)
 *  - Token metadata from the contract itself: ft_metadata (NEP-148), nft_metadata (NEP-177),
 *    nft_tokens_for_owner (NEP-181).
 */
import type { AssetRef, Network, NetworkId, Nft } from "@clip-wallet/core";
import type { NearRpc } from "./rpc.js";
import { USDC_CONTRACTS, WRAP_CONTRACTS, networkName, tokenAssetKey } from "./networks.js";

export interface FtMetadata {
  spec?: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string | null;
}

const ftCache = new Map<string, FtMetadata | null>();
const nftCache = new Map<string, { name?: string; symbol?: string; base_uri?: string | null } | null>();

export function clearTokenCache(): void {
  ftCache.clear();
  nftCache.clear();
}

export async function ftMetadata(rpc: NearRpc, contract: string): Promise<FtMetadata | null> {
  const k = `${rpc.url}|${contract}`;
  if (ftCache.has(k)) return ftCache.get(k)!;
  let meta: FtMetadata | null = null;
  try {
    const m = await rpc.view<FtMetadata>(contract, "ft_metadata", {});
    if (m && typeof m.symbol === "string" && Number.isInteger(m.decimals) && m.decimals >= 0 && m.decimals <= 48) meta = m;
  } catch {
    meta = null;
  }
  ftCache.set(k, meta);
  return meta;
}

/** Folds look-alike characters (Cyrillic/Greek capitals, full-width) so "USDС" with a Cyrillic С still reads USDC. */
function fold(s: string): string {
  const map: Record<string, string> = { "С": "C", "с": "C", "Ѕ": "S", "ѕ": "S", "Ц": "U", "υ": "U", "Ꭰ": "D", "ᗪ": "D", "Ⅾ": "D", "ⅾ": "D", "Ν": "N", "Е": "E", "Α": "A", "А": "A", "Ε": "E", "Ꭱ": "R", "Ʀ": "R" };
  return [...s.normalize("NFKC")].map((c) => map[c] ?? c).join("").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A token that pretends to be USDC or NEAR without being the real contract. */
export function isLookalike(networkId: NetworkId, contract: string, symbol: string, name = ""): boolean {
  const n = networkName(networkId);
  const s = fold(symbol);
  const nm = fold(name);
  if ((s.includes("USDC") || nm.includes("USDCOIN")) && (!n || USDC_CONTRACTS[n] !== contract)) return true;
  if ((s === "NEAR" || s === "WNEAR") && (!n || WRAP_CONTRACTS[n] !== contract)) return true;
  return false;
}

export function assetFor(networkId: NetworkId, contract: string, meta: FtMetadata | null): AssetRef {
  const asset: AssetRef = {
    key: tokenAssetKey(networkId, contract),
    symbol: meta?.symbol ?? "token",
    name: meta?.name ?? contract,
    decimals: meta?.decimals ?? 0,
    networkId,
    address: contract,
  };
  if (meta && isLookalike(networkId, contract, meta.symbol, meta.name)) asset.spam = true;
  if (!meta) asset.spam = true;
  return asset;
}

export function fastnearUrl(net: Network): string {
  if (!net.indexerUrl) throw new Error("no FastNEAR URL");
  return net.indexerUrl.replace(/\/$/, "");
}

export async function fastnearJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`FastNEAR ${res.status}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ NFTs */

interface NftToken {
  token_id: string;
  owner_id?: string;
  metadata?: { title?: string | null; media?: string | null; extra?: string | null } | null;
}

async function nftContractMeta(rpc: NearRpc, contract: string) {
  const k = `${rpc.url}|${contract}`;
  if (nftCache.has(k)) return nftCache.get(k)!;
  let m: { name?: string; symbol?: string; base_uri?: string | null } | null = null;
  try {
    m = await rpc.view(contract, "nft_metadata", {});
  } catch {
    m = null;
  }
  nftCache.set(k, m);
  return m;
}

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(\/.*)?$/;

/** NEP-177: `media` may be a full URL or a path relative to the contract's `base_uri`. Only https/ipfs/ar URLs are kept. */
export function resolveMedia(media: string | null | undefined, baseUri: string | null | undefined, gateway: string): string | undefined {
  if (!media) return undefined;
  let url = media.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (baseUri) url = `${baseUri.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
    else if (CID.test(url)) url = `${gateway}${url}`;
    else return undefined;
  }
  if (url.startsWith("ipfs://")) url = `${gateway}${url.slice(7).replace(/^ipfs\//, "")}`;
  return /^(https:\/\/|ar:\/\/)/i.test(url) ? url : undefined;
}

function attributesOf(extra: string | null | undefined): { trait: string; value: string }[] {
  if (!extra) return [];
  try {
    const x = JSON.parse(extra) as { attributes?: { trait_type?: unknown; value?: unknown }[] };
    if (!Array.isArray(x.attributes)) return [];
    return x.attributes
      .filter((a) => a && typeof a.trait_type === "string")
      .map((a) => ({ trait: String(a.trait_type), value: String(a.value ?? "") }));
  } catch {
    return [];
  }
}

export async function nftsFor(rpc: NearRpc, net: Network, owner: string, contracts: string[], gateway: string): Promise<Nft[]> {
  const out: Nft[] = [];
  for (const contract of contracts) {
    const meta = await nftContractMeta(rpc, contract);
    let tokens: NftToken[] = [];
    try {
      tokens = await rpc.view<NftToken[]>(contract, "nft_tokens_for_owner", { account_id: owner, from_index: "0", limit: 50 });
    } catch {
      continue;
    }
    if (!Array.isArray(tokens)) continue;
    for (const t of tokens) {
      if (!t || typeof t.token_id !== "string") continue;
      if (t.owner_id && t.owner_id !== owner) continue;
      const nft: Nft = {
        networkId: net.id,
        standard: "nep171",
        collection: { address: contract, name: meta?.name || meta?.symbol || contract },
        tokenId: t.token_id,
      };
      if (t.metadata?.title) nft.name = t.metadata.title;
      const media = resolveMedia(t.metadata?.media, meta?.base_uri, gateway);
      if (media) nft.mediaUrl = media; // untrusted: sandboxed media proxy only
      const attrs = attributesOf(t.metadata?.extra);
      if (attrs.length) nft.attributes = attrs;
      out.push(nft);
    }
  }
  return out;
}
