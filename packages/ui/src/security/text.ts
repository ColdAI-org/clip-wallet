/**
 * The security views are built in the background in English (the security package). Where a view carries
 * structured data or a stable code, the screen says it in the user's language from these helpers; anything without
 * one (an error the provider returned, a site warning) falls back to the background's own words.
 */
import type { UiMessageId } from "../i18n";
import type { CleanupItemView, CleanupSummaryView, GrantRisk, GrantView, ThreatProviderStatusView } from "./client";
import { relativeTime } from "../lib/format";

type T = (id: UiMessageId, vars?: Record<string, string | number>) => string;

const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a);

/** "Uniswap can spend all your USDC", "… up to 100 USDC", "… every NFT you hold in Pudgy Penguins". */
export function grantTitle(g: GrantView, t: T): string {
  const app = g.spender.name ?? (g.spender.known ? shortAddr(g.spender.address) : t("security.grant.unknownApp"));
  if (g.kind === "nft-all" || g.kind === "hts-nft-all") return t("security.grant.nftAll", { app, collection: g.asset.name });
  const permit2 = g.kind === "permit2";
  // A limited permission from a background without `limit` can't be re-worded: keep its own title.
  if (!g.unlimited && !g.limit && g.kind !== "spl-delegate") return g.title;
  if (g.limit) return t(permit2 ? "security.grant.upToPermit2" : "security.grant.upTo", { app, amount: g.limit, symbol: g.asset.symbol });
  return t(permit2 ? "security.grant.allPermit2" : "security.grant.all", { app, symbol: g.asset.symbol });
}

const RISK: Record<GrantRisk["code"], UiMessageId> = {
  unlimited: "security.risk.unlimited",
  "unknown-spender": "security.risk.unknownSpender",
  old: "security.risk.old",
  unused: "security.risk.unused",
  "flagged-spender": "security.risk.flagged",
};

export function riskText(r: GrantRisk, g: GrantView, t: T): string {
  if (r.code === "old") return g.grantedAt ? t("security.risk.old", { when: relativeTime(g.grantedAt) }) : r.label;
  return RISK[r.code] ? t(RISK[r.code]) : r.label;
}

/** Notes keyed "no-permissions:<family>", "not-yet:<family>", "hide-only:evm|other". */
export function noteText(code: string | undefined, fallback: string, t: T): string {
  const ids: Record<string, UiMessageId> = {
    "no-permissions:aptos": "security.note.noPermissions.aptos",
    "no-permissions:sui": "security.note.noPermissions.sui",
    "no-permissions:bitcoin": "security.note.noPermissions.bitcoin",
    "not-yet:starknet": "security.note.notYet.starknet",
    "not-yet:tezos": "security.note.notYet.tezos",
    "not-yet:substrate": "security.note.notYet.substrate",
    "not-yet:stellar": "security.note.notYet.stellar",
    "hide-only:evm": "security.note.hideOnly.evm",
    "hide-only:other": "security.note.hideOnly.other",
  };
  const id = code ? ids[code] : undefined;
  return id ? t(id) : fallback;
}

export function partialText(p: { code: string; message: string; network?: string }, t: T): string {
  if (!p.network) return p.message;
  if (p.code === "approvals/unreachable" || p.code === "cleanup/unreachable") return t("security.partial.unreachable", { network: p.network });
  if (p.code === "approvals/recent-only") return t("security.partial.recentOnly", { network: p.network });
  return p.message;
}

const REASON: Record<NonNullable<CleanupItemView["reasonCode"]>, UiMessageId> = {
  "empty-account": "security.reason.emptyAccount",
  "spam-locked": "security.reason.spamLocked",
  "spam-burn": "security.reason.spamBurn",
  "spam-gone": "security.reason.spamGone",
  "unused-token": "security.reason.unusedToken",
  "spam-deleted": "security.reason.spamDeleted",
  "spam-held-hedera": "security.reason.spamHeldHedera",
  "spam-hide": "security.reason.spamHide",
  "spam-nft-hide": "security.reason.spamNftHide",
};

export function cleanupReason(i: CleanupItemView, t: T): string {
  const id = i.reasonCode ? REASON[i.reasonCode] : undefined;
  return id ? t(id, { symbol: i.symbol, amount: i.reclaim?.display ?? "" }) : i.reason;
}

/** SOL from lamports, like the background's "~0.0082 SOL" (number formatting is the user's locale). */
function sol(lamports: string): string {
  const v = Number(lamports) / 1e9;
  if (v > 0 && v < 0.0001) return "<0.0001 SOL";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 0.01 ? 4 : 3 })} SOL`;
}

export function cleanupLines(s: CleanupSummaryView, t: T): { headline: string; lines: string[] } {
  const c = s.counts;
  if (!c) return { headline: s.headline, lines: s.lines };
  const lines: string[] = [];
  if (c.close) lines.push(t("security.clean.line.close", { count: c.close }));
  if (c["burn-close"]) lines.push(t("security.clean.line.burn", { count: c["burn-close"] }));
  if (c.dissociate) lines.push(t("security.clean.line.dissociate", { count: c.dissociate }));
  if (c.hide) lines.push(t("security.clean.line.hide", { count: c.hide }));
  const total = c.close + c["burn-close"] + c.dissociate + c.hide;
  const headline =
    BigInt(s.reclaimLamports || "0") > 0n
      ? t("security.clean.getBack", { amount: sol(s.reclaimLamports) })
      : c.hide === total
        ? t("security.clean.tidy")
        : t("security.clean.cleanUp");
  return { headline, lines };
}

const PRIVACY: Record<string, UiMessageId> = {
  local: "security.privacy.local",
  blockaid: "security.privacy.blockaid",
};

export function privacyText(p: ThreatProviderStatusView, t: T): string {
  if (PRIVACY[p.id]) return t(PRIVACY[p.id]!);
  // Every open list says the same thing: downloaded, checked on the device, nothing sent.
  return p.sendsUserData ? p.privacy : t("security.privacy.list");
}

export function sourceUnavailable(u: { code: string; message: string }, t: T): string {
  return u.code === "threat/blockaid-off" ? t("security.protect.blockaidOff") : u.message;
}

const SOURCE: Record<string, UiMessageId> = {
  metamask: "security.source.metamask",
  scamsniffer: "security.source.scamsnifferSites",
  "scamsniffer-addresses": "security.source.scamsnifferAddresses",
  phantom: "security.source.phantom",
  polkadot: "security.source.polkadot",
  "polkadot-addresses": "security.source.polkadotAddresses",
  blockaid: "security.source.blockaid",
  local: "security.source.local",
};

/** "MetaMask phishing list": the list's owner stays as is, the rest is translated. */
export function sourceName(p: ThreatProviderStatusView, t: T): string {
  return SOURCE[p.id] ? t(SOURCE[p.id]!) : p.name;
}
