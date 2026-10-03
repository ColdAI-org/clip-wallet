import type { ChainContext } from "@clip-wallet/core";
import type { Step } from "@clip-wallet/features";
import type { GrantRisk, GrantView, Unavailable } from "../views.js";

/** How to take a grant back. Built into a DappRequest on the normal approval path. */
export type RevokeSpec =
  | { kind: "erc20"; token: string; spender: string }
  | { kind: "nft-all"; collection: string; operator: string }
  | { kind: "permit2"; token: string; spender: string }
  | { kind: "spl"; tokenAccount: string; programId: string }
  | { kind: "hedera-hbar"; spender: string }
  | { kind: "hedera-token"; tokenId: string; spender: string }
  | { kind: "hedera-nft-all"; tokenId: string; spender: string };

export interface Grant {
  view: GrantView;
  revoke: RevokeSpec;
}

export interface ScanResult {
  grants: Grant[];
  partial: Unavailable[];
}

export interface ScanOptions {
  now: number;
  oldAfterDays: number;
  /** True when a scam list names this address. */
  isFlagged(address: string): boolean;
  evm: { lookbackBlocks: number; maxBlockRange: number };
}

/** One family's permission finder and revoker. */
export interface ApprovalScanner {
  family: "evm" | "solana" | "hedera";
  scan(ctx: ChainContext, opts: ScanOptions): Promise<ScanResult>;
  /** One or more steps that revoke every grant given (all from this network), batching where the network allows it. */
  revoke(grants: Grant[], ctx: ChainContext): Promise<Step[]>;
}

const DAY = 86_400_000;

/** Shared risk rules, so every family reads the same. */
export function risksFor(p: {
  unlimited: boolean;
  spenderKnown: boolean;
  flagged: boolean;
  grantedAt?: number;
  unused?: boolean;
  now: number;
  oldAfterDays: number;
}): { risks: GrantRisk[]; riskLevel: GrantView["riskLevel"] } {
  const risks: GrantRisk[] = [];
  if (p.flagged) risks.push({ code: "flagged-spender", label: "On a scam list", level: "danger" });
  if (p.unlimited) risks.push({ code: "unlimited", label: "Can take all of it", level: "danger" });
  if (!p.spenderKnown) risks.push({ code: "unknown-spender", label: "Unknown app", level: "caution" });
  if (p.grantedAt !== undefined && p.now - p.grantedAt > p.oldAfterDays * DAY) {
    risks.push({ code: "old", label: `Set ${ageText(p.now - p.grantedAt)} ago`, level: "caution" });
  }
  if (p.unused) risks.push({ code: "unused", label: "Never used", level: "info" });
  const riskLevel: GrantView["riskLevel"] =
    p.flagged || (p.unlimited && !p.spenderKnown) ? "high" : p.unlimited || !p.spenderKnown || risks.some((r) => r.code === "old") ? "medium" : "low";
  return { risks, riskLevel };
}

export function ageText(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days >= 730) return `${Math.floor(days / 365)} years`;
  if (days >= 365) return "over a year";
  if (days >= 60) return `${Math.floor(days / 30)} months`;
  return `${days} days`;
}

export function grantId(networkId: string, spec: RevokeSpec): string {
  const parts = Object.entries(spec)
    .filter(([k]) => k !== "kind")
    .map(([, v]) => (String(v).startsWith("0x") ? String(v).toLowerCase() : String(v)));
  return [networkId, spec.kind, ...parts].join("|");
}
