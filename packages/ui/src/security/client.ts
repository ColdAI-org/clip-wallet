/**
 * Settings → Security's door to the background (permission revoker, spam cleanup, scam protection).
 * Implemented over the extension's message bus (docs/phase25/integration/security.md); a plain fake in tests.
 * Nothing here carries key material: revokes and cleanups return the approval they queued on the normal
 * approval path. View types come from @clip-wallet/security/views (type-only).
 */
import type {
  ApprovalsOverviewView,
  CleanupOverviewView,
  CleanupSummaryView,
  SecurityRunResult,
  SiteCheckView,
  ThreatProviderStatusView,
} from "@clip-wallet/security/views";

export type {
  ApprovalsOverviewView,
  CleanupAction,
  CleanupItemView,
  CleanupOverviewView,
  CleanupSummaryView,
  GrantRisk,
  GrantView,
  SecurityRunResult,
  SiteCheckView,
  ThreatProviderStatusView,
} from "@clip-wallet/security/views";

export interface SecurityClient {
  approvalsScan(): Promise<ApprovalsOverviewView>;
  revoke(p: { ids: string[] }): Promise<SecurityRunResult>;
  cleanupScan(): Promise<CleanupOverviewView>;
  cleanupPreview(p: { ids: string[] }): Promise<CleanupSummaryView>;
  cleanupRun(p: { ids: string[] }): Promise<SecurityRunResult>;
  unhide(p: { ids: string[] }): Promise<{ ok: true }>;
  threatStatus(): Promise<ThreatProviderStatusView[]>;
  threatRefresh(): Promise<ThreatProviderStatusView[]>;
  checkSite(p: { origin: string }): Promise<SiteCheckView>;
}
