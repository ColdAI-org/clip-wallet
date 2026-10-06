// A scam-check source: implement ThreatIntelProvider and say exactly what leaves the device.
import type { ThreatFinding, ThreatIntelProvider, TxCheckInput } from "@clip-wallet/security";

/** Flags sites on a list you download once a day. Matching runs on the device. */
export function createExampleListProvider(fetchList: () => Promise<string[]>): ThreatIntelProvider {
  let hosts = new Set<string>();
  let updatedAt: number | undefined;
  return {
    id: "example-list",
    name: "Example blocklist",
    // Shown in Settings → Security. Plain words, and true: only the list download leaves the device.
    privacy: "Downloads the Example blocklist once a day. Nothing about you or the sites you visit is sent.",
    sendsUserData: false,
    status: () => ({ enabled: true, entries: hosts.size, ...(updatedAt ? { updatedAt } : {}) }),
    async refresh(force = false) {
      if (!force && updatedAt && Date.now() - updatedAt < 24 * 3_600_000) return;
      try {
        hosts = new Set((await fetchList()).map((h) => h.toLowerCase()));
        updatedAt = Date.now();
      } catch {
        // Keep the last copy: a failed download must never switch protection off.
      }
    },
    checkSiteSync(host: string): ThreatFinding[] {
      return hosts.has(host.toLowerCase())
        ? [{ level: "danger", code: "phishing-site", message: "This site is on the Example blocklist. Don't connect or sign anything.", source: "example-list" }]
        : [];
    },
    async checkSite(origin: string) {
      return this.checkSiteSync!(new URL(origin).host);
    },
    async checkTransaction({ counterparties }: TxCheckInput) {
      return counterparties.some((a) => hosts.has(a.toLowerCase()))
        ? [{ level: "danger" as const, code: "malicious-transaction" as const, message: "This sends to an address on the Example blocklist.", source: "example-list" }]
        : [];
    },
  };
}
