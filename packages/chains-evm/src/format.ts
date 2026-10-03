import { formatUnits, getAddress, maxUint256 } from "viem";

/** "0x12…ab" — short form for titles. Full address goes in a line. */
export function shortAddress(a: string): string {
  const c = safeChecksum(a);
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
}

export function safeChecksum(a: string): string {
  try {
    return getAddress(a);
  } catch {
    return a;
  }
}

/** Human amount: trims trailing zeros, caps fraction digits so titles stay short. */
export function formatAmount(base: bigint, decimals: number, maxFraction = 6): string {
  const s = formatUnits(base, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, maxFraction).replace(/0+$/, "");
  const int = (i ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!frac && base > 0n && int === "0") return `<0.${"0".repeat(maxFraction - 1)}1`;
  return frac ? `${int}.${frac}` : int;
}

/** Approvals at or above 2^255 are "unlimited" in practice (some apps use type(uint256).max - n). */
export const isUnlimited = (amount: bigint): boolean => amount >= maxUint256 >> 1n;

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}
