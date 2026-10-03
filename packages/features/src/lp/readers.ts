import { type ChainContext, ClipError } from "@clip-wallet/core";
import { ledgerOf, mirrorFor, mirrorUrl } from "@clip-wallet/chains-hedera";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { ethCall, mirrorCall } from "../http.js";
import { SAUCERSWAP_V2 } from "../swap/saucerswap.js";
import { formatUnits, fromLongZero, longZero } from "../util.js";
import type { LpPositionView } from "../views.js";
import { FACTORY_ABI, NPM_ABI, type RawPosition } from "./abi.js";
import { amountsForLiquidity } from "./math.js";

type Call = (to: string, data: Hex) => Promise<Hex>;

/** First two words of slot0 (sqrtPriceX96, tick) read directly, so fork differences in later fields don't matter. */
export function decodeSlot0(raw: Hex): { sqrtPriceX96: bigint; tick: number } {
  const h = raw.slice(2);
  if (h.length < 128) throw new Error("short slot0");
  const sqrtPriceX96 = BigInt(`0x${h.slice(0, 64)}`);
  let tick = BigInt(`0x${h.slice(64, 128)}`);
  if (tick >= 1n << 255n) tick -= 1n << 256n;
  return { sqrtPriceX96, tick: Number(tick) };
}

const SLOT0: Hex = "0x3850c7bd";

async function readPosition(call: Call, npm: string, tokenId: bigint): Promise<RawPosition> {
  const raw = await call(npm, encodeFunctionData({ abi: NPM_ABI, functionName: "positions", args: [tokenId] }));
  const r = decodeFunctionResult({ abi: NPM_ABI, functionName: "positions", data: raw });
  return { token0: r[2], token1: r[3], fee: Number(r[4]), tickLower: Number(r[5]), tickUpper: Number(r[6]), liquidity: r[7], tokensOwed0: r[10], tokensOwed1: r[11] };
}

async function poolPrice(call: Call, factory: string, p: RawPosition): Promise<{ sqrtPriceX96: bigint; tick: number }> {
  const poolRaw = await call(factory, encodeFunctionData({ abi: FACTORY_ABI, functionName: "getPool", args: [getAddress(p.token0), getAddress(p.token1), p.fee] }));
  const pool = decodeFunctionResult({ abi: FACTORY_ABI, functionName: "getPool", data: poolRaw });
  return decodeSlot0(await call(pool, SLOT0));
}

interface TokenInfo {
  symbol: string;
  decimals: number;
  key?: string;
}

function view(
  p: RawPosition,
  price: { sqrtPriceX96: bigint },
  t0: TokenInfo,
  t1: TokenInfo,
  meta: { id: string; app: string; url: string; networkId: string; usd?: (k: string) => number | undefined },
): LpPositionView {
  const a = amountsForLiquidity(price.sqrtPriceX96, p.tickLower, p.tickUpper, p.liquidity);
  const fmt = (v: bigint, t: TokenInfo) => `${formatUnits(v, t.decimals, 4)} ${t.symbol}`;
  const v: LpPositionView = {
    id: meta.id,
    app: meta.app,
    pair: `${t0.symbol} / ${t1.symbol}`,
    holdings: `${fmt(a.amount0, t0)} + ${fmt(a.amount1, t1)}`,
    status: a.inRange ? "Earning fees" : "Out of range: not earning fees",
    inRange: a.inRange,
    url: meta.url,
    networkId: meta.networkId,
  };
  if (p.tokensOwed0 > 0n || p.tokensOwed1 > 0n) v.fees = `At least ${fmt(p.tokensOwed0, t0)} + ${fmt(p.tokensOwed1, t1)} waiting to be collected`;
  const u0 = t0.key ? meta.usd?.(t0.key) : undefined;
  const u1 = t1.key ? meta.usd?.(t1.key) : undefined;
  if (u0 !== undefined && u1 !== undefined) {
    v.fiatValue = (Number(a.amount0) / 10 ** t0.decimals) * u0 + (Number(a.amount1) / 10 ** t1.decimals) * u1;
  }
  return v;
}

/* ------------------------------------------------------------------ Uniswap v3 (EVM) */

/**
 * NonfungiblePositionManager per chain id (https://developers.uniswap.org/docs/protocols/v3/deployments/…).
 * Read on-chain with eth_call: The Graph's gateway needs an API key now, so the subgraph isn't used.
 */
export const UNISWAP_V3_NPM: Record<number, string> = {
  1: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  42161: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  8453: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  11155111: "0x1238536071E1c677A632429e3655c799b22cDA52",
  421614: "0x6b2937Bde17889EDCf8fbD8dE31C3C2a70Bc4d65",
  84532: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
};

const MAX_POSITIONS = 20;

export async function uniswapPositions(ctx: ChainContext, usd?: (k: string) => number | undefined, knownKey?: (addr: string) => string | undefined): Promise<LpPositionView[]> {
  const npm = ctx.network.chainId !== undefined ? UNISWAP_V3_NPM[ctx.network.chainId] : undefined;
  const rpc = ctx.network.rpcUrls[0];
  if (!npm || !rpc) return [];
  const call: Call = (to, data) => ethCall(ctx.fetch, rpc, to, data, "Uniswap");
  const owner = getAddress(ctx.account.address);
  const n = decodeFunctionResult({ abi: NPM_ABI, functionName: "balanceOf", data: await call(npm, encodeFunctionData({ abi: NPM_ABI, functionName: "balanceOf", args: [owner] })) });
  if (n === 0n) return [];
  const factory = decodeFunctionResult({ abi: NPM_ABI, functionName: "factory", data: await call(npm, encodeFunctionData({ abi: NPM_ABI, functionName: "factory" })) });
  const tokens = new Map<string, TokenInfo>();
  const info = async (addr: string): Promise<TokenInfo> => {
    const k = addr.toLowerCase();
    let t = tokens.get(k);
    if (!t) {
      const symbol = decodeFunctionResult({ abi: erc20Abi, functionName: "symbol", data: await call(addr, encodeFunctionData({ abi: erc20Abi, functionName: "symbol" })) });
      const decimals = decodeFunctionResult({ abi: erc20Abi, functionName: "decimals", data: await call(addr, encodeFunctionData({ abi: erc20Abi, functionName: "decimals" })) });
      t = { symbol, decimals: Number(decimals), key: knownKey?.(addr) };
      tokens.set(k, t);
    }
    return t;
  };
  const out: LpPositionView[] = [];
  for (let i = 0n; i < n && i < BigInt(MAX_POSITIONS); i++) {
    const idRaw = await call(npm, encodeFunctionData({ abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", args: [owner, i] }));
    const tokenId = decodeFunctionResult({ abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", data: idRaw });
    const p = await readPosition(call, npm, tokenId);
    if (p.liquidity === 0n && p.tokensOwed0 === 0n && p.tokensOwed1 === 0n) continue; // closed
    const price = await poolPrice(call, factory, p);
    out.push(
      view(p, price, await info(p.token0), await info(p.token1), {
        id: `uniswap:${ctx.network.id}:${tokenId}`,
        app: "Uniswap",
        url: `https://app.uniswap.org/positions/v3/${tokenId}`,
        networkId: ctx.network.id,
        usd,
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ SaucerSwap V2 (Hedera) */

/**
 * SaucerSwap V2 positions are HTS NFTs ("SaucerSwap v2 Liquidity Position", SSV2-LP): list them with the mirror
 * node, then read positions(serial) / factory.getPool / pool.slot0 through the mirror node's contracts/call.
 */
export async function saucerSwapPositions(ctx: ChainContext, usd?: (k: string) => number | undefined, tokenKey?: (tokenId: string) => string): Promise<LpPositionView[]> {
  let c: (typeof SAUCERSWAP_V2)[keyof typeof SAUCERSWAP_V2];
  try {
    c = SAUCERSWAP_V2[ledgerOf(ctx.network.id)];
  } catch {
    return [];
  }
  if (!c) return [];
  const mirror = mirrorFor(ctx);
  const acct = await mirror.account(ctx.account.hederaAccountId ?? ctx.account.address);
  if (!acct) return [];
  const nfts = await mirror.paged<{ serial_number: number }>(`/api/v1/accounts/${acct.account}/nfts?token.id=${c.lpNft}&limit=100`, "nfts", 1);
  if (!nfts.length) return [];
  const base = mirrorUrl(ctx.network);
  const call: Call = (to, data) => mirrorCall(ctx.fetch, base, to, data, "SaucerSwap");
  const npm = longZero(c.positionManager);
  const factory = longZero(c.factory);
  const tokens = new Map<string, TokenInfo>();
  const info = async (addr: string): Promise<TokenInfo> => {
    const id = fromLongZero(addr);
    if (!id) throw new ClipError("A SaucerSwap position couldn't be read.", "lp/bad-token");
    let t = tokens.get(id);
    if (!t) {
      if (id === c!.whbarToken) t = { symbol: "HBAR", decimals: 8, key: "hbar" };
      else {
        const m = await mirror.token(id);
        t = { symbol: m?.symbol ?? id, decimals: Number(m?.decimals ?? 0), key: tokenKey?.(id) };
      }
      tokens.set(id, t);
    }
    return t;
  };
  const out: LpPositionView[] = [];
  for (const nft of nfts.slice(0, MAX_POSITIONS)) {
    try {
      const p = await readPosition(call, npm, BigInt(nft.serial_number));
      if (p.liquidity === 0n && p.tokensOwed0 === 0n && p.tokensOwed1 === 0n) continue;
      const price = await poolPrice(call, factory, p);
      out.push(
        view(p, price, await info(p.token0), await info(p.token1), {
          id: `saucerswap:${ctx.network.id}:${nft.serial_number}`,
          app: "SaucerSwap",
          url: "https://www.saucerswap.finance/liquidity",
          networkId: ctx.network.id,
          usd,
        }),
      );
    } catch {
      // One unreadable position shouldn't hide the rest.
    }
  }
  return out;
}
