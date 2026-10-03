import type { AssetRef, DecodedRequest, TokenBalance } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { Need, Shortfall } from "./types.js";

function sameAsset(a: AssetRef, b: AssetRef): boolean {
  return a.networkId === b.networkId && (a.address ?? "").toLowerCase() === (b.address ?? "").toLowerCase();
}

function toBig(v: string, what: string): bigint {
  if (!/^-?\d+$/.test(v)) throw new ClipError(`Amount "${v}" for ${what} is not a whole number of base units.`, "bad-amount");
  return BigInt(v);
}

/**
 * What a decoded request takes from the user: every negative balance change plus the fee (unless sponsored),
 * summed per asset.
 */
export function needsFromDecoded(decoded: DecodedRequest): Need[] {
  const out: Need[] = [];
  const add = (asset: AssetRef, amount: bigint) => {
    if (amount <= 0n) return;
    const hit = out.find((n) => sameAsset(n.asset, asset));
    if (hit) hit.amount = (BigInt(hit.amount) + amount).toString();
    else out.push({ asset, amount: amount.toString() });
  };
  for (const c of decoded.balanceChanges) {
    const d = toBig(c.delta, c.asset.symbol);
    if (d < 0n) add(c.asset, -d);
  }
  if (decoded.fee && !decoded.fee.sponsored) add(decoded.fee.asset, toBig(decoded.fee.amount, decoded.fee.asset.symbol));
  return out;
}

/**
 * Compare what a request needs with what the user holds. Returns only the assets that fall short, each with the
 * balances that could fund it: the same asset on other networks first, then everything else the user holds.
 */
export function findShortfall(needs: Need[] | DecodedRequest, portfolio: TokenBalance[]): Shortfall[] {
  const list = Array.isArray(needs) ? needs : needsFromDecoded(needs);
  const out: Shortfall[] = [];
  for (const need of list) {
    const want = toBig(need.amount, need.asset.symbol);
    const have = portfolio
      .filter((b) => sameAsset(b.asset, need.asset))
      .reduce((s, b) => s + toBig(b.amount, b.asset.symbol), 0n);
    if (have >= want) continue;
    const elsewhere = portfolio.filter(
      (b) =>
        b.asset.networkId !== need.asset.networkId &&
        b.asset.key === need.asset.key &&
        !b.asset.bridged &&
        !b.asset.spam &&
        BigInt(b.amount) > 0n,
    );
    const other = portfolio.filter(
      (b) =>
        b.asset.networkId !== need.asset.networkId &&
        !elsewhere.includes(b) &&
        !b.asset.spam &&
        BigInt(b.amount) > 0n,
    );
    const byValue = (a: TokenBalance, b: TokenBalance) => (b.fiatValue ?? 0) - (a.fiatValue ?? 0);
    out.push({
      asset: need.asset,
      need: want.toString(),
      have: have.toString(),
      missing: (want - have).toString(),
      sameAssetElsewhere: [...elsewhere].sort(byValue),
      otherBalances: [...other].sort(byValue),
    });
  }
  return out;
}
