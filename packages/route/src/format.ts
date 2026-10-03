import type { TrustTier } from "./clprouter.js";

/** Base units -> decimal string, trimmed to `maxFraction` significant fraction digits. */
export function formatUnits(amount: bigint | string, decimals: number, maxFraction = 6): string {
  const v = BigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0");
  // Keep enough digits to show something for tiny amounts, otherwise cap at maxFraction.
  const firstNonZero = frac.search(/[1-9]/);
  const keep = firstNonZero >= maxFraction ? firstNonZero + 2 : maxFraction;
  frac = frac.slice(0, keep).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Decimal string -> base units, exact. */
export function parseUnits(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal amount: ${value}`);
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals) throw new Error(`too many decimals in ${value} (max ${decimals})`);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/**
 * USD -> base units of a coin priced at `unitUsd`, rounded up at 1e-12 of a coin (never undercharges).
 */
export function usdToUnits(usd: number, unitUsd: number, decimals: number): bigint {
  if (!(unitUsd > 0)) throw new Error("price must be positive");
  if (!(usd >= 0) || !Number.isFinite(usd)) throw new Error(`invalid USD amount ${usd}`);
  const P = 12;
  const scaled = BigInt(Math.ceil((usd / unitUsd) * 10 ** P - 1e-6));
  return decimals >= P ? scaled * 10n ** BigInt(decimals - P) : (scaled + 10n ** BigInt(P - decimals) - 1n) / 10n ** BigInt(P - decimals);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(seconds / 3600);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function formatCarbon(kg: number): string {
  if (kg >= 1) return `about ${kg.toFixed(1)} kg CO2e`;
  const g = kg * 1000;
  if (g >= 0.1) return `about ${g.toFixed(1)} g CO2e`;
  return "under 0.1 g CO2e";
}

export const TRUST_TEXT: Record<TrustTier, string> = {
  attested: "Vouched for by a group of operators; nothing is proven",
  committee: "Checked against a committee of the sending network's validators",
  "light-client": "Checked against the sending network's full consensus",
  "validity-proof": "Checked with a zero-knowledge proof",
};
