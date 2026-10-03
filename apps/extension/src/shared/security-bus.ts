/**
 * Page-side SecurityClient over the wallet bus (Settings → Security: permissions, spam cleanup, scam protection).
 * Messages are SECURITY_REQUESTS from @clip-wallet/security, merged into shared/messages.ts.
 */
import type { SecurityRequest, SecurityResponseMap } from "@clip-wallet/security/messages";
import type { SecurityClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { Envelope } from "./messages";

class SecurityBusError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

export type SecurityTransport = (m: SecurityRequest) => Promise<unknown>;

export function createSecurityBusClient(transport: SecurityTransport = (m) => browser.runtime.sendMessage(m)): SecurityClient {
  async function call<T extends SecurityRequest["type"]>(msg: Extract<SecurityRequest, { type: T }>): Promise<SecurityResponseMap[T]> {
    let raw: unknown;
    try {
      raw = await transport(msg);
    } catch {
      throw new SecurityBusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
    }
    const env = Envelope.safeParse(raw);
    if (!env.success) throw new SecurityBusError("Something went wrong. Please try again.", "bus/bad-reply");
    if (!env.data.ok) throw new SecurityBusError(env.data.error.userMessage, env.data.error.code);
    return env.data.data as SecurityResponseMap[T];
  }
  return {
    approvalsScan: () => call({ type: "secApprovalsScan" }),
    revoke: (p) => call({ type: "secRevoke", ...p }),
    cleanupScan: () => call({ type: "secCleanupScan" }),
    cleanupPreview: (p) => call({ type: "secCleanupPreview", ...p }),
    cleanupRun: (p) => call({ type: "secCleanupRun", ...p }),
    unhide: (p) => call({ type: "secUnhide", ...p }),
    threatStatus: () => call({ type: "secThreatStatus" }),
    threatRefresh: () => call({ type: "secThreatRefresh" }),
    checkSite: (p) => call({ type: "secCheckSite", ...p }),
  };
}
