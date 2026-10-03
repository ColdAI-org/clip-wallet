import type { DappRequest, DecodedRequest, Network, Warning } from "@clip-wallet/core";
import { ApprovalsService } from "./approvals/service.js";
import { CleanupService } from "./cleanup/service.js";
import type { SecurityConfig, SecurityHost } from "./host.js";
import type { SecurityRequest, SecurityResponseMap } from "./messages.js";
import { ThreatIntel } from "./threat/service.js";
import type { ThreatIntelProvider } from "./threat/types.js";

/**
 * The background side of Settings → Security, plus the two hooks the approval path calls:
 *  - `assessSite(origin)` on connect (injected and WalletConnect),
 *  - `refine(request, decoded, network, account)` right after the chain module's decode().
 * Holds no keys: revokes and cleanups end in host.enqueue() (the normal approval path).
 */
export class SecurityService {
  readonly threat: ThreatIntel;
  readonly approvals: ApprovalsService;
  readonly cleanup: CleanupService;

  constructor(
    private readonly host: SecurityHost,
    config: SecurityConfig,
    deps: { providers?: ThreatIntelProvider[] } = {},
  ) {
    this.threat = new ThreatIntel(host, config.threat, deps.providers);
    this.approvals = new ApprovalsService(host, config, this.threat.isFlaggedAddress);
    this.cleanup = new CleanupService(host);
  }

  /** Load cached lists and refresh stale ones in the background. */
  start(): Promise<void> {
    return this.threat.start();
  }

  assessSite(origin: string): Promise<Warning[]> {
    return this.threat.assessSite(origin);
  }

  refine(request: DappRequest, decoded: DecodedRequest, network: Network, account: string, extra: { recipients?: string[] } = {}): Promise<DecodedRequest> {
    return this.threat.apply(request, decoded, network, account, extra);
  }

  async handle<T extends SecurityRequest["type"]>(m: Extract<SecurityRequest, { type: T }>): Promise<SecurityResponseMap[T]> {
    return (await this.dispatch(m as SecurityRequest)) as SecurityResponseMap[T];
  }

  private async dispatch(m: SecurityRequest): Promise<unknown> {
    switch (m.type) {
      case "secApprovalsScan":
        return this.approvals.scan();
      case "secRevoke":
        return { queued: await this.approvals.revoke(m.ids), hidden: 0 };
      case "secCleanupScan":
        return this.cleanup.scan();
      case "secCleanupPreview":
        return this.cleanup.preview(m.ids);
      case "secCleanupRun":
        return this.cleanup.run(m.ids);
      case "secUnhide":
        await this.cleanup.unhide(m.ids);
        return { ok: true };
      case "secThreatStatus":
        return this.threat.status();
      case "secThreatRefresh":
        return this.threat.refresh(true);
      case "secCheckSite":
        return this.threat.checkSite(m.origin);
    }
  }
}
