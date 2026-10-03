import type { NetworkId, TokenBalance } from "@clip-wallet/core";

/** One row on Home: the same asset from the same issuer, summed across every network. */
export interface MergedAsset {
  /** Row id: AssetRef.key, suffixed for bridged copies so they never merge with the native asset. */
  id: string;
  key: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  bridged: boolean;
  spam: boolean;
  /** Decimals used for `amount` (the max across parts). */
  decimals: number;
  /** Sum across networks, base units at `decimals`. */
  amount: string;
  fiatValue?: number;
  /** Per-network balances, shown only on the asset detail screen. */
  parts: TokenBalance[];
  pinned: boolean;
  small: boolean;
}

export interface MergeOptions {
  pinned?: string[];
  hideSmallBalances?: boolean;
  showSpam?: boolean;
  search?: string;
  /** Balances worth less than this (display currency) count as "small". */
  smallThreshold?: number;
}

export interface MergeResult {
  assets: MergedAsset[];
  total: number;
  hiddenSmall: number;
  hiddenSpam: number;
}

export function rowIdFor(b: TokenBalance): string {
  return b.asset.bridged ? `${b.asset.key}#bridged` : b.asset.key;
}

export function mergeBalances(balances: TokenBalance[], opts: MergeOptions = {}): MergeResult {
  const threshold = opts.smallThreshold ?? 1;
  const pinned = new Set(opts.pinned ?? []);
  const groups = new Map<string, TokenBalance[]>();
  for (const b of balances) {
    if (BigInt(b.amount || "0") === 0n) continue;
    const id = rowIdFor(b);
    const g = groups.get(id);
    if (g) g.push(b);
    else groups.set(id, [b]);
  }

  const all: MergedAsset[] = [];
  for (const [id, parts] of groups) {
    const first = parts[0]!;
    const decimals = Math.max(...parts.map((p) => p.asset.decimals));
    let sum = 0n;
    let fiat: number | undefined;
    for (const p of parts) {
      sum += BigInt(p.amount) * 10n ** BigInt(decimals - p.asset.decimals);
      if (p.fiatValue !== undefined) fiat = (fiat ?? 0) + p.fiatValue;
    }
    parts.sort((a, b) => (b.fiatValue ?? 0) - (a.fiatValue ?? 0));
    all.push({
      id,
      key: first.asset.key,
      symbol: first.asset.symbol,
      name: first.asset.name,
      logoUrl: parts.find((p) => p.asset.logoUrl)?.asset.logoUrl,
      bridged: !!first.asset.bridged,
      spam: parts.every((p) => p.asset.spam),
      decimals,
      amount: sum.toString(),
      fiatValue: fiat,
      parts,
      pinned: pinned.has(id) || pinned.has(first.asset.key),
      small: (fiat ?? 0) < threshold,
    });
  }

  const q = opts.search?.trim().toLowerCase();
  let hiddenSmall = 0;
  let hiddenSpam = 0;
  const visible = all.filter((a) => {
    if (a.spam && !opts.showSpam) {
      hiddenSpam++;
      return false;
    }
    if (a.small && opts.hideSmallBalances && !a.pinned) {
      hiddenSmall++;
      return false;
    }
    if (q && !a.symbol.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q)) return false;
    return true;
  });

  visible.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.fiatValue ?? 0) - (a.fiatValue ?? 0);
  });

  const total = all.filter((a) => !a.spam).reduce((t, a) => t + (a.fiatValue ?? 0), 0);
  return { assets: visible, total, hiddenSmall, hiddenSpam };
}

/** Networks the user holds a given asset on (for send/receive candidates). */
export function networksHolding(balances: TokenBalance[], assetKey: string): NetworkId[] {
  return [...new Set(balances.filter((b) => b.asset.key === assetKey).map((b) => b.asset.networkId))];
}
