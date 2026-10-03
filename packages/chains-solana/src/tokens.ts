import type { AssetRef, NetworkId, Nft } from "@clip-wallet/core";
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { clusterOf, tokenAssetKey, USDC_MINTS } from "./networks.js";
import { type ParsedAccount, type SolanaRpc, base64Data, getMultipleAccounts } from "./rpc.js";
import { short } from "./util.js";

export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ADDRESS as string, TOKEN_2022_PROGRAM];
export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export interface MintInfo {
  mint: string;
  program: string;
  decimals: number;
  supply: string;
  symbol: string | null;
  name: string | null;
  uri: string | null;
  /** Verified Metaplex collection mint, if any. */
  collection: string | null;
}

export interface TokenAccountInfo {
  address: string;
  mint: string;
  owner: string;
  amount: bigint;
  decimals: number;
  delegate: string | null;
  program: string;
}

const mintCache = new Map<string, MintInfo | null>();

export function clearTokenCache(): void {
  mintCache.clear();
}

export async function metadataPda(mint: string): Promise<string> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(METADATA_PROGRAM),
    seeds: ["metadata", enc.encode(address(METADATA_PROGRAM)), enc.encode(address(mint))],
  });
  return pda;
}

/** Metaplex Token Metadata account (borsh): key, update authority, mint, name, symbol, uri, …, collection. */
export function parseMetaplexMetadata(data: Uint8Array): { name: string; symbol: string; uri: string; collection: string | null } | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 1 + 32 + 32;
    const str = () => {
      const len = view.getUint32(o, true);
      o += 4;
      if (len > 1000 || o + len > data.length) throw new Error("bad string");
      const s = new TextDecoder().decode(data.subarray(o, o + len)).replace(/\0+$/g, "").trim();
      o += len;
      return s;
    };
    const name = str();
    const symbol = str();
    const uri = str();
    let collection: string | null = null;
    try {
      o += 2; // seller fee bps
      if (data[o++] === 1) {
        const n = view.getUint32(o, true);
        o += 4 + n * 34;
      }
      o += 2; // primary sale, mutable
      if (data[o++] === 1) o += 1; // edition nonce
      if (data[o++] === 1) o += 1; // token standard
      if (data[o++] === 1) {
        const verified = data[o++] === 1;
        const key = getAddressDecoder().decode(data.subarray(o, o + 32));
        if (verified) collection = key;
      }
    } catch {
      collection = null;
    }
    return { name, symbol, uri, collection };
  } catch {
    return null;
  }
}

function parsedInfo(acc: ParsedAccount | null): Record<string, unknown> | null {
  if (!acc || Array.isArray(acc.data) || !acc.data.parsed) return null;
  return acc.data.parsed.info;
}

/** Decimals, supply and metadata for mints (token-2022 metadata extension first, then the Metaplex PDA). */
export async function mintInfos(rpc: SolanaRpc, mints: string[], networkId: NetworkId, cacheKey = ""): Promise<Map<string, MintInfo>> {
  const out = new Map<string, MintInfo>();
  const todo = [...new Set(mints)].filter((m) => {
    const hit = mintCache.get(`${cacheKey}|${m}`);
    if (hit) out.set(m, hit);
    return hit === undefined;
  });
  if (!todo.length) return out;
  const accounts = await getMultipleAccounts(rpc, todo, "jsonParsed");
  const needMetaplex: MintInfo[] = [];
  todo.forEach((mint, i) => {
    const acc = accounts[i] ?? null;
    const info = parsedInfo(acc);
    if (!acc || !info || !TOKEN_PROGRAMS.includes(acc.owner)) {
      mintCache.set(`${cacheKey}|${mint}`, null);
      return;
    }
    const ext = ((info.extensions as { extension: string; state?: Record<string, unknown> }[] | undefined) ?? []).find((e) => e.extension === "tokenMetadata");
    const m: MintInfo = {
      mint,
      program: acc.owner,
      decimals: Number(info.decimals ?? 0),
      supply: String(info.supply ?? "0"),
      symbol: (ext?.state?.symbol as string | undefined) || null,
      name: (ext?.state?.name as string | undefined) || null,
      uri: (ext?.state?.uri as string | undefined) || null,
      collection: null,
    };
    const c = clusterOf(networkId);
    if (c && USDC_MINTS[c] === mint && !m.symbol) {
      m.symbol = "USDC";
      m.name = "USD Coin";
    }
    if (!m.symbol) needMetaplex.push(m);
    out.set(mint, m);
    mintCache.set(`${cacheKey}|${mint}`, m);
  });
  if (needMetaplex.length) {
    const pdas = await Promise.all(needMetaplex.map((m) => metadataPda(m.mint)));
    const metas = await getMultipleAccounts(rpc, pdas, "base64").catch(() => pdas.map(() => null));
    needMetaplex.forEach((m, i) => {
      const data = base64Data(metas[i] ?? null);
      const md = data ? parseMetaplexMetadata(data) : null;
      if (md) {
        m.symbol = md.symbol || null;
        m.name = md.name || null;
        m.uri = md.uri || null;
        m.collection = md.collection;
      }
    });
  }
  return out;
}

export function assetFor(networkId: NetworkId, mint: string, info: MintInfo | undefined): AssetRef {
  return {
    key: tokenAssetKey(networkId, mint),
    symbol: info?.symbol || short(mint),
    name: info?.name || `Token ${short(mint)}`,
    decimals: info?.decimals ?? 0,
    networkId,
    address: mint,
  };
}

/** Token accounts (SPL and Token-2022) by address; non-token accounts are skipped. */
export async function tokenAccounts(rpc: SolanaRpc, addresses: string[]): Promise<Map<string, TokenAccountInfo>> {
  const out = new Map<string, TokenAccountInfo>();
  const uniq = [...new Set(addresses)];
  if (!uniq.length) return out;
  const accounts = await getMultipleAccounts(rpc, uniq, "jsonParsed");
  uniq.forEach((a, i) => {
    const acc = accounts[i] ?? null;
    const t = toTokenAccount(a, acc);
    if (t) out.set(a, t);
  });
  return out;
}

export function toTokenAccount(addr: string, acc: ParsedAccount | null): TokenAccountInfo | null {
  if (!acc || !TOKEN_PROGRAMS.includes(acc.owner) || Array.isArray(acc.data) || acc.data.parsed?.type !== "account") return null;
  const info = acc.data.parsed.info as { mint: string; owner: string; tokenAmount: { amount: string; decimals: number }; delegate?: string };
  return {
    address: addr,
    mint: info.mint,
    owner: info.owner,
    amount: BigInt(info.tokenAmount.amount),
    decimals: info.tokenAmount.decimals,
    delegate: info.delegate ?? null,
    program: acc.owner,
  };
}

/** Every token account the owner holds under both token programs. */
export async function ownerTokenAccounts(rpc: SolanaRpc, owner: string): Promise<TokenAccountInfo[]> {
  const out: TokenAccountInfo[] = [];
  for (const programId of TOKEN_PROGRAMS) {
    const r = await rpc.call<{ value: { pubkey: string; account: ParsedAccount }[] }>("getTokenAccountsByOwner", [
      owner,
      { programId },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
    for (const { pubkey, account } of r.value) {
      const t = toTokenAccount(pubkey, account);
      if (t) out.push(t);
    }
  }
  return out;
}

export interface OffchainMetadata {
  name?: string;
  image?: string;
  attributes?: { trait: string; value: string }[];
}

export function safeUrl(uri: string | null | undefined, gateway: string): string | null {
  if (!uri) return null;
  const u = uri.trim();
  if (/^ipfs:\/\//i.test(u)) return (gateway.endsWith("/") ? gateway : `${gateway}/`) + u.replace(/^ipfs:\/\/(ipfs\/)?/i, "");
  if (/^https?:\/\//i.test(u)) return u;
  if (/^ar:\/\//i.test(u)) return `https://arweave.net/${u.slice(5)}`;
  return null;
}

/** Metaplex off-chain JSON. Untrusted. */
export async function fetchOffchain(uri: string | null, fetchImpl: typeof fetch, gateway: string): Promise<OffchainMetadata | null> {
  const url = safeUrl(uri, gateway);
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const out: OffchainMetadata = {};
    if (typeof j.name === "string") out.name = j.name.slice(0, 200);
    const img = typeof j.image === "string" ? safeUrl(j.image, gateway) : null;
    if (img) out.image = img;
    if (Array.isArray(j.attributes)) {
      out.attributes = j.attributes
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({ trait: String(a.trait_type ?? ""), value: String(a.value ?? "") }))
        .slice(0, 50);
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface DasAsset {
  id: string;
  interface?: string;
  content?: { metadata?: { name?: string; symbol?: string; attributes?: { trait_type?: string; value?: unknown }[] }; links?: { image?: string } };
  grouping?: { group_key: string; group_value: string }[];
  compression?: { compressed?: boolean };
  burnt?: boolean;
}

/** Compressed NFTs through a DAS (Digital Asset Standard) API endpoint, e.g. Helius or Triton. */
export async function dasCompressedNfts(dasUrl: string, owner: string, networkId: NetworkId, fetchImpl: typeof fetch, gateway: string): Promise<Nft[]> {
  const res = await fetchImpl(dasUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "clip", method: "getAssetsByOwner", params: { ownerAddress: owner, page: 1, limit: 1000 } }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { result?: { items?: DasAsset[] } };
  return (body.result?.items ?? [])
    .filter((a) => a.compression?.compressed && !a.burnt)
    .map((a) => {
      const coll = a.grouping?.find((g) => g.group_key === "collection")?.group_value;
      const nft: Nft = {
        networkId,
        standard: "metaplex",
        collection: { address: coll ?? a.id, name: a.content?.metadata?.symbol || a.content?.metadata?.name || "Collection" },
        tokenId: a.id,
      };
      if (a.content?.metadata?.name) nft.name = a.content.metadata.name;
      const img = safeUrl(a.content?.links?.image, gateway);
      if (img) nft.mediaUrl = img;
      const attrs = a.content?.metadata?.attributes;
      if (attrs?.length) nft.attributes = attrs.map((t) => ({ trait: String(t.trait_type ?? ""), value: String(t.value ?? "") }));
      return nft;
    });
}
