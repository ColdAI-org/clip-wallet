import { z } from "zod";
import type { ApprovalsOverviewView, CleanupOverviewView, CleanupSummaryView, SecurityRunResult, SiteCheckView, ThreatProviderStatusView } from "./views.js";

/**
 * Bus messages for the security screens, zod-validated in the background like every page message.
 * The integration step spreads SECURITY_REQUESTS into apps/extension/src/shared/messages.ts `Request` and
 * merges SecurityResponseMap into `ResponseMap` (docs/phase25/integration/security.md).
 */
const id = z.string().min(1).max(400);
const ids = z.array(id).min(1).max(500);

export const SECURITY_REQUESTS = [
  z.object({ type: z.literal("secApprovalsScan") }),
  z.object({ type: z.literal("secRevoke"), ids }),
  z.object({ type: z.literal("secCleanupScan") }),
  z.object({ type: z.literal("secCleanupPreview"), ids }),
  z.object({ type: z.literal("secCleanupRun"), ids }),
  z.object({ type: z.literal("secUnhide"), ids }),
  z.object({ type: z.literal("secThreatStatus") }),
  z.object({ type: z.literal("secThreatRefresh") }),
  z.object({ type: z.literal("secCheckSite"), origin: z.string().min(1).max(2048) }),
] as const;

export const SecurityRequest = z.discriminatedUnion("type", SECURITY_REQUESTS);
export type SecurityRequest = z.infer<typeof SecurityRequest>;

export function isSecurityRequest(m: { type: string }): m is SecurityRequest {
  return m.type.startsWith("sec");
}

export interface SecurityResponseMap {
  secApprovalsScan: ApprovalsOverviewView;
  secRevoke: SecurityRunResult;
  secCleanupScan: CleanupOverviewView;
  secCleanupPreview: CleanupSummaryView;
  secCleanupRun: SecurityRunResult;
  secUnhide: { ok: true };
  secThreatStatus: ThreatProviderStatusView[];
  secThreatRefresh: ThreatProviderStatusView[];
  secCheckSite: SiteCheckView;
}
