/**
 * Keeping scams out of Discover. The security stream's token lists plug in through `TokenRiskSource` (code
 * against the interface; this stream doesn't depend on that package). Heuristics always run as well:
 *
 *  - impersonation: a protected symbol (USDC, ETH, …) or a canonical stablecoin symbol at a non-canonical
 *    address (e.g. a token called "USDC" that is really "UpSideDownCat")
 *  - name/symbol bait: URLs, "claim", "airdrop", "reward", "visit", "free" (classic airdrop-phishing tokens)
 *  - invisible or mixed-script characters in the symbol/name
 *  - too thin to trade: under MIN_LIQUIDITY_USD
 */
import { CANONICAL, PROTECTED_SYMBOLS, plainSymbol } from "./chains.js";

export type TokenVerdict = "ok" | "spam" | "scam";

export interface TokenRef {
  /** DEX Screener chain id ("base", "solana"…). */
  chain: string;
  address?: string;
  symbol: string;
  name: string;
  liquidityUsd?: number;
}

/** The security stream's lists (allow/deny), by interface. Return undefined to defer to the heuristics. */
export interface TokenRiskSource {
  verdict(token: TokenRef): TokenVerdict | undefined | Promise<TokenVerdict | undefined>;
}

export const MIN_LIQUIDITY_USD = 50_000;

const BAIT = /(https?:|www\.|\.(com|io|xyz|net|org|app|gg|top|site|claim)\b|claim|airdrop|reward|visit|free\s|giveaway|bonus|voucher)/i;
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;
const SCRIPTS: [string, RegExp][] = [
  ["latin", /[A-Za-zÀ-ɏ]/],
  ["cyrillic", /[Ѐ-ӿ]/],
  ["greek", /[Ͱ-Ͽ]/],
];

function mixedScripts(s: string): boolean {
  return SCRIPTS.filter(([, re]) => re.test(s)).length > 1;
}

function sameAddress(a: string, b: string): boolean {
  return a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Heuristic verdict for one token. `trusted` = an address the wallet already knows (its own asset list). */
export function heuristicVerdict(t: TokenRef, opts: { minLiquidityUsd?: number; trusted?: (chain: string, address: string) => boolean } = {}): TokenVerdict {
  const sym = plainSymbol(t.symbol);
  if (t.address && opts.trusted?.(t.chain, t.address)) return "ok";
  const canonical = Object.entries(CANONICAL).find(([s]) => plainSymbol(s) === sym || (s === "USDT" && sym === "USDT0"))?.[1];
  if (canonical && t.address) {
    const list = canonical[t.chain] ?? [];
    if (list.some((a) => sameAddress(a, t.address!))) return "ok";
    return "scam";
  }
  if (INVISIBLE.test(t.symbol) || INVISIBLE.test(t.name) || mixedScripts(t.symbol)) return "scam";
  // Real tickers are short; keyword-stuffed symbols ("BTCETHUSDT…", thousands of characters) are search bait.
  if ([...t.symbol].length > 20) return "spam";
  if (BAIT.test(t.symbol) || BAIT.test(t.name)) return "scam";
  if (PROTECTED_SYMBOLS.has(sym)) return "scam";
  if (t.liquidityUsd !== undefined && t.liquidityUsd < (opts.minLiquidityUsd ?? MIN_LIQUIDITY_USD)) return "spam";
  return "ok";
}

export async function verdictOf(t: TokenRef, source: TokenRiskSource | undefined, opts: Parameters<typeof heuristicVerdict>[1] = {}): Promise<TokenVerdict> {
  const listed = source ? await Promise.resolve(source.verdict(t)).catch(() => undefined) : undefined;
  if (listed === "scam" || listed === "spam") return listed;
  const h = heuristicVerdict(t, opts);
  // An allow-list "ok" can't override impersonation or bait, only thin liquidity.
  return listed === "ok" && h === "spam" ? "ok" : h;
}
