import type { AssetRef, Nft, NetworkId, TokenBalance } from "@clip-wallet/core";
import { short } from "./encoding.js";
import { KNOWN_TOKENS, tokenAssetKey } from "./networks.js";
import type { Tzkt } from "./rpc.js";

/** TzKT token (GET /v1/tokens, and `token` inside /v1/tokens/balances). Metadata is TZIP-21, all values untrusted. */
export interface TzktToken {
  id?: number;
  contract: { address: string; alias?: string };
  tokenId: string;
  standard: "fa1.2" | "fa2";
  totalSupply?: string;
  metadata?: {
    name?: string;
    symbol?: string;
    decimals?: string;
    artifactUri?: string;
    displayUri?: string;
    thumbnailUri?: string;
    isBooleanAmount?: boolean;
    attributes?: { name?: unknown; value?: unknown }[];
    [k: string]: unknown;
  } | null;
}

export interface TzktTokenBalance {
  account: { address: string };
  token: TzktToken;
  balance: string;
}

const decimalsOf = (t: TzktToken) => {
  const d = Number(t.metadata?.decimals ?? "0");
  return Number.isInteger(d) && d >= 0 && d <= 36 ? d : 0;
};

/** TZIP-21 NFT: boolean amount, or 0 decimals with an artifact/display image. */
export function isNftToken(t: TzktToken): boolean {
  const m = t.metadata;
  if (!m) return false;
  if (m.isBooleanAmount === true) return true;
  return decimalsOf(t) === 0 && (typeof m.artifactUri === "string" || typeof m.displayUri === "string");
}

/** Symbols people copy to pass off fake tokens. Only the issuer's own contract may use them. */
const PROTECTED_SYMBOLS = new Set(["xtz", "tez", "tezos", "usdt", "usdc", "tzbtc", "btc", "eth", "eurc", "kusd", "ctez"]);

export function isSpamToken(networkId: NetworkId, t: TzktToken): boolean {
  const m = t.metadata;
  if (!m || (!m.symbol && !m.name)) return true;
  const known = KNOWN_TOKENS.some((k) => k.networkId === networkId && k.contract === t.contract.address && k.tokenId === t.tokenId);
  if (known) return false;
  const norm = (s: unknown) => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "");
  const sym = norm(m.symbol);
  if (PROTECTED_SYMBOLS.has(sym) || (sym && [...PROTECTED_SYMBOLS].some((p) => sym !== p && sym.replace(/0/g, "o").replace(/1/g, "l") === p))) return true;
  const text = `${m.name ?? ""} ${m.symbol ?? ""}`;
  return /https?:\/\/|www\.|\.(com|io|xyz|net|org)\b|claim|airdrop|reward|visit/i.test(text);
}

export function tokenAsset(networkId: NetworkId, t: TzktToken): AssetRef {
  const known = KNOWN_TOKENS.find((k) => k.networkId === networkId && k.contract === t.contract.address && k.tokenId === t.tokenId);
  const m = t.metadata ?? {};
  const symbol = known?.symbol ?? (typeof m.symbol === "string" && m.symbol ? m.symbol.slice(0, 16) : short(t.contract.address));
  const asset: AssetRef = {
    key: tokenAssetKey(networkId, t.contract.address, t.tokenId),
    symbol,
    name: known?.name ?? (typeof m.name === "string" && m.name ? m.name.slice(0, 64) : (t.contract.alias ?? symbol)),
    decimals: known?.decimals ?? decimalsOf(t),
    networkId,
    address: t.contract.address,
  };
  if (isSpamToken(networkId, t)) asset.spam = true;
  return asset;
}

export async function tokenBalances(tzkt: Tzkt, me: string): Promise<TzktTokenBalance[]> {
  return (await tzkt.get<TzktTokenBalance[]>(`/v1/tokens/balances?account=${me}&balance.gt=0&limit=1000`)) ?? [];
}

export function fungibleBalances(networkId: NetworkId, list: TzktTokenBalance[]): TokenBalance[] {
  return list.filter((b) => !isNftToken(b.token)).map((b) => ({ asset: tokenAsset(networkId, b.token), amount: b.balance }));
}

/** ipfs:// → gateway; only https and ipfs are kept. Untrusted: render through the sandboxed media proxy only. */
export function mediaUrl(uri: unknown, gateway: string): string | undefined {
  if (typeof uri !== "string") return undefined;
  if (uri.startsWith("ipfs://")) return `${gateway}${uri.slice(7).replace(/^ipfs\//, "")}`;
  if (uri.startsWith("https://")) return uri;
  return undefined;
}

export function nftsFrom(networkId: NetworkId, list: TzktTokenBalance[], gateway: string): Nft[] {
  return list
    .filter((b) => isNftToken(b.token))
    .map((b) => {
      const t = b.token;
      const m = t.metadata ?? {};
      const nft: Nft = {
        networkId,
        standard: "fa2",
        collection: { address: t.contract.address, name: t.contract.alias ?? short(t.contract.address) },
        tokenId: t.tokenId,
      };
      if (typeof m.name === "string" && m.name) nft.name = m.name.slice(0, 120);
      const media = mediaUrl(m.displayUri, gateway) ?? mediaUrl(m.artifactUri, gateway) ?? mediaUrl(m.thumbnailUri, gateway);
      if (media) nft.mediaUrl = media;
      const attrs = (Array.isArray(m.attributes) ? m.attributes : [])
        .filter((a) => a && (typeof a.name === "string" || typeof a.name === "number") && a.value != null)
        .map((a) => ({ trait: String(a.name), value: typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value) }));
      if (attrs.length) nft.attributes = attrs;
      if (isSpamToken(networkId, t) && !m.name) nft.spam = true;
      return nft;
    });
}
