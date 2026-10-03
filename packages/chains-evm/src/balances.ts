/**
 * Balances and NFTs.
 *  - Native coin: eth_getBalance.
 *  - ERC-20: Blockscout `/api/v2/addresses/{a}/token-balances` when the network has one (Network.indexerUrl);
 *    otherwise the curated list read through Multicall3 (individual eth_calls if Multicall3 is missing).
 *  - NFTs: Blockscout `/api/v2/addresses/{a}/nft` (ERC-721 + ERC-1155); none without an indexer.
 */
import type { ChainContext, Nft, TokenBalance } from "@clip-wallet/core";
import { type Hex, decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, hexToBigInt } from "viem";
import { chainIdOf, ethCall } from "./chain.js";
import { getJson, rpc } from "./rpc.js";
import { curatedAsset, curatedFor, curatedToken, looksLikeSpam, tokenAsset } from "./tokens.js";

/** Multicall3 is deployed at this address on nearly every EVM network. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const multicall3Abi = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [{ name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }],
    outputs: [{ name: "returnData", type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }],
  },
] as const;

interface BlockscoutToken {
  address?: string;
  address_hash?: string;
  name?: string | null;
  symbol?: string | null;
  decimals?: string | null;
  type?: string;
  reputation?: string | null;
  exchange_rate?: string | null;
  icon_url?: string | null;
}

export async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
  const native = hexToBigInt(await rpc<Hex>(ctx.network, ctx.fetch, "eth_getBalance", [ctx.account.address, "latest"]));
  const out: TokenBalance[] = [{ asset: ctx.network.nativeAsset, amount: native.toString() }];
  const tokens = ctx.network.indexerUrl ? await blockscoutTokens(ctx) : undefined;
  out.push(...(tokens ?? (await curatedBalances(ctx))));
  return out;
}

async function blockscoutTokens(ctx: ChainContext): Promise<TokenBalance[] | undefined> {
  const rows = await getJson<{ token: BlockscoutToken; value: string }[]>(
    ctx.fetch,
    `${ctx.network.indexerUrl}/addresses/${ctx.account.address}/token-balances`,
  );
  if (!Array.isArray(rows)) return undefined;
  const chainId = chainIdOf(ctx);
  const out: TokenBalance[] = [];
  for (const r of rows) {
    const t = r.token;
    if (t.type !== "ERC-20") continue;
    const addr = t.address_hash ?? t.address;
    if (!addr || !r.value || r.value === "0") continue;
    const curated = !!curatedToken(chainId, addr);
    const meta: { symbol?: string; name?: string; decimals?: number } = {};
    if (t.symbol) meta.symbol = t.symbol;
    if (t.name) meta.name = t.name;
    if (t.decimals != null) meta.decimals = Number(t.decimals);
    const asset = tokenAsset(ctx.network.id, chainId, addr, meta);
    if (!curated) {
      asset.spam = looksLikeSpam(asset.symbol, asset.name, { curated, reputation: t.reputation ?? null }) || (asset.spam ?? false);
      // An unpriced token claiming a famous ticker is almost always an impersonation.
      if (!t.exchange_rate && looksLikeSpam(asset.symbol, asset.name, { reputation: null })) asset.spam = true;
      if (t.icon_url) asset.logoUrl = t.icon_url;
      if (!asset.spam) delete asset.spam;
    }
    out.push({ asset, amount: r.value });
  }
  return out;
}

async function curatedBalances(ctx: ChainContext): Promise<TokenBalance[]> {
  const list = curatedFor(chainIdOf(ctx));
  if (list.length === 0) return [];
  const callData = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [getAddress(ctx.account.address)] });
  let amounts: (bigint | undefined)[];
  try {
    const data = encodeFunctionData({
      abi: multicall3Abi,
      functionName: "aggregate3",
      args: [list.map((t) => ({ target: t.address, allowFailure: true, callData }))],
    });
    const res = await ethCall(ctx, MULTICALL3, data);
    const decoded = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: res });
    amounts = decoded.map((d) => (d.success && d.returnData.length >= 66 ? hexToBigInt(d.returnData) : undefined));
  } catch {
    amounts = await Promise.all(
      list.map(async (t) => {
        try {
          return hexToBigInt(await ethCall(ctx, t.address, callData));
        } catch {
          return undefined;
        }
      }),
    );
  }
  const out: TokenBalance[] = [];
  list.forEach((t, i) => {
    const a = amounts[i];
    if (a !== undefined && a > 0n) out.push({ asset: curatedAsset(t), amount: a.toString() });
  });
  return out;
}

interface BlockscoutNft {
  id: string;
  token_type?: string;
  value?: string;
  image_url?: string | null;
  animation_url?: string | null;
  metadata?: { name?: string; image?: string; attributes?: { trait_type?: string; value?: unknown }[] } | null;
  token: BlockscoutToken;
}

export async function getNfts(ctx: ChainContext): Promise<Nft[]> {
  if (!ctx.network.indexerUrl) return [];
  const out: Nft[] = [];
  let next: Record<string, unknown> | null | undefined = undefined;
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ type: "ERC-721,ERC-1155" });
    if (next) for (const [k, v] of Object.entries(next)) qs.set(k, String(v));
    const res: { items?: BlockscoutNft[]; next_page_params?: Record<string, unknown> | null } | undefined = await getJson(
      ctx.fetch,
      `${ctx.network.indexerUrl}/addresses/${ctx.account.address}/nft?${qs}`,
    );
    if (!res?.items) break;
    for (const it of res.items) {
      const addr = it.token.address_hash ?? it.token.address;
      if (!addr) continue;
      const type = it.token_type ?? it.token.type;
      const collectionName = it.token.name ?? "Collection";
      const nft: Nft = {
        networkId: ctx.network.id,
        standard: type === "ERC-1155" ? "erc1155" : "erc721",
        collection: { address: getAddress(addr), name: collectionName },
        tokenId: it.id,
      };
      const name = it.metadata?.name;
      if (name) nft.name = name;
      const media = it.image_url ?? it.metadata?.image;
      if (media) nft.mediaUrl = media;
      const attrs = it.metadata?.attributes;
      if (Array.isArray(attrs)) nft.attributes = attrs.filter((a) => a && a.trait_type).map((a) => ({ trait: String(a.trait_type), value: String(a.value) }));
      if (looksLikeSpam(it.token.symbol ?? "", `${collectionName} ${name ?? ""}`, { reputation: it.token.reputation ?? null })) nft.spam = true;
      out.push(nft);
    }
    next = res.next_page_params;
    if (!next) break;
  }
  return out;
}
