/**
 * Assets by key, so a dapp says "25 usdc" and never picks a network. Built in: each EVM chain's native coin and
 * Circle-issued USDC (addresses from developers.circle.com/stablecoins/usdc-contract-addresses, checked
 * 2026-10-05; the same table Clip Wallet's EVM module uses). Pass `assets` to connect() for anything else.
 */
import type { Caip2 } from "./caip.js";

export interface AssetSpec {
  /** "usdc", "eth", or your own key. Same key = same asset on every chain. */
  key: string;
  symbol: string;
  decimals: number;
  /** CAIP-2 chain → token address, or "native" for the chain's own coin. */
  on: Record<Caip2, `0x${string}` | "native">;
}

/** EIP-7528 native placeholder (ERC-7682 `requiredAssets`, `auxiliaryFunds.assets`). */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

const USDC: Record<number, `0x${string}`> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  11155420: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
};

/** Chains whose native coin is ETH. */
const ETH_CHAINS = [1, 10, 8453, 42161, 11155111, 84532, 421614, 11155420];

export const BUILTIN_ASSETS: AssetSpec[] = [
  { key: "usdc", symbol: "USDC", decimals: 6, on: Object.fromEntries(Object.entries(USDC).map(([c, a]) => [`eip155:${c}`, a])) },
  { key: "eth", symbol: "ETH", decimals: 18, on: Object.fromEntries(ETH_CHAINS.map((c) => [`eip155:${c}`, "native"])) },
  { key: "hbar", symbol: "HBAR", decimals: 18, on: { "eip155:295": "native", "eip155:296": "native" } },
  { key: "pol", symbol: "POL", decimals: 18, on: { "eip155:137": "native" } },
  { key: "avax", symbol: "AVAX", decimals: 18, on: { "eip155:43114": "native" } },
];

export function assetRegistry(extra: AssetSpec[] = []): Map<string, AssetSpec> {
  const m = new Map<string, AssetSpec>();
  for (const a of [...BUILTIN_ASSETS, ...extra]) {
    const prev = m.get(a.key);
    m.set(a.key, prev ? { ...prev, ...a, on: { ...prev.on, ...a.on } } : a);
  }
  return m;
}

/** "25.5" → base units. Throws on more decimals than the asset has (no silent rounding of money). */
export function parseAmount(value: string | number | bigint, decimals: number): bigint {
  if (typeof value === "bigint") return value;
  const s = typeof value === "number" ? value.toString() : value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Not an amount: ${s}`);
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) throw new Error(`Too many decimal places for this asset (max ${decimals}).`);
  return BigInt(w!) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Base units → "25.5". */
export function formatAmount(units: bigint | string, decimals: number): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / base}${frac ? `.${frac}` : ""}`;
}

/** ERC-20 transfer(address,uint256) calldata. */
export function erc20Transfer(to: string, amount: bigint): `0x${string}` {
  const addr = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0xa9059cbb${addr}${amount.toString(16).padStart(64, "0")}`;
}

/** ERC-20 balanceOf(address) calldata. */
export function erc20BalanceOf(owner: string): `0x${string}` {
  return `0x70a08231${owner.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}
