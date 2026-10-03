import type { DappRequest, DecodedRequest, Network, Warning } from "@clip-wallet/core";
import type { SecurityConfig, SecurityHost } from "../host.js";
import { hostOf } from "../util.js";
import type { SiteCheckView, ThreatProviderStatusView } from "../views.js";
import { BlockaidProvider } from "./blockaid.js";
import { LocalHeuristics } from "./heuristics.js";
import { LIST_SOURCES, ListProvider } from "./lists.js";
import type { ThreatFinding, ThreatIntelProvider, TxCheckInput } from "./types.js";

const ADDRESS = /^(0x[0-9a-fA-F]{40}|0\.0\.\d+|[1-9A-HJ-NP-Za-km-z]{32,48})$/;
const RECIPIENT_LABELS = /^(to|recipient|send to|pay to)$/i;

/** Addresses named on the approval screen: recipients ("To") and everything else (spenders, contracts). */
export function addressesOf(request: DappRequest, decoded: DecodedRequest, extraRecipients: string[] = []): { recipients: string[]; counterparties: string[] } {
  const recipients = new Set(extraRecipients);
  const all = new Set(extraRecipients);
  for (const l of decoded.lines) {
    const v = l.value.trim();
    if (!ADDRESS.test(v)) continue;
    all.add(v);
    if (RECIPIENT_LABELS.test(l.label.trim())) recipients.add(v);
  }
  const p = (request.params as { to?: unknown }[] | undefined)?.[0];
  if (request.family === "evm" && p && typeof p.to === "string" && ADDRESS.test(p.to)) all.add(p.to);
  return { recipients: [...recipients], counterparties: [...all] };
}

function toWarnings(findings: ThreatFinding[]): Warning[] {
  const seen = new Set<string>();
  const out: Warning[] = [];
  // Danger first, then one warning per (code, message).
  for (const f of [...findings].sort((a, b) => rank(b.level) - rank(a.level))) {
    const k = `${f.code}|${f.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ level: f.level, code: f.code, message: f.message });
  }
  return out;
}

const rank = (l: Warning["level"]) => (l === "danger" ? 2 : l === "caution" ? 1 : 0);

/**
 * Consulted on connect (assessSite) and right after the chain module's decode (apply). Never throws: a provider
 * that fails just contributes nothing. Only providers with `sendsUserData` send anything about the request,
 * and the only one is Blockaid, which is off unless configured.
 */
export class ThreatIntel {
  readonly providers: ThreatIntelProvider[];

  constructor(
    private readonly host: SecurityHost,
    config: SecurityConfig["threat"] = {},
    providers?: ThreatIntelProvider[],
  ) {
    if (providers) {
      this.providers = providers;
    } else {
      const lists = config.openLists === false ? [] : LIST_SOURCES.filter((s) => !config.lists || config.lists.includes(s.id)).map((s) => new ListProvider(s, host, config.refreshHours ?? 24));
      this.providers = [...lists, new LocalHeuristics(host, config.newContractDays ?? 7), new BlockaidProvider(host.fetch, config.blockaid)];
    }
  }

  /** Load cached lists, then refresh stale ones in the background. Call once at background start. */
  async start(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.load?.().catch(() => undefined)));
    void this.refresh(false);
  }

  async refresh(force = true): Promise<ThreatProviderStatusView[]> {
    await Promise.all(this.providers.map((p) => p.refresh?.(force).catch(() => undefined)));
    return this.status();
  }

  status(): ThreatProviderStatusView[] {
    return this.providers.map((p) => {
      const s = p.status();
      return { id: p.id, name: p.name, privacy: p.privacy, sendsUserData: p.sendsUserData, enabled: s.enabled, updatedAt: s.updatedAt, entries: s.entries, unavailable: s.unavailable };
    });
  }

  /** Synchronous list check, for WalletConnect's `isKnownScam` hook (assessVerify). */
  isKnownScam = (origin: string): boolean => {
    const h = hostOf(origin);
    return !!h && this.providers.some((p) => (p.checkSiteSync?.(h).length ?? 0) > 0);
  };

  /** Synchronous address check against scam address lists (the revoker's `flagged-spender`). */
  isFlaggedAddress = (address: string): boolean => this.providers.some((p) => (p.checkAddressSync?.(address).length ?? 0) > 0);

  /** Connect path: warnings for a site. */
  async assessSite(origin: string): Promise<Warning[]> {
    const h = hostOf(origin);
    if (!h) return [];
    const findings: ThreatFinding[] = [];
    for (const p of this.providers) findings.push(...(p.checkSiteSync?.(h) ?? []));
    const remote = await Promise.all(this.providers.filter((p) => p.checkSite).map((p) => p.checkSite!(origin).catch(() => [])));
    return toWarnings([...findings, ...remote.flat()]);
  }

  async checkSite(origin: string): Promise<SiteCheckView> {
    const warnings = await this.assessSite(origin);
    return { origin, warnings, safe: !warnings.some((w) => w.level === "danger") };
  }

  /** Decode path: the warnings threat intel adds for this request. */
  async assessRequest(request: DappRequest, decoded: DecodedRequest, network: Network, account: string, extra: { recipients?: string[] } = {}): Promise<Warning[]> {
    const { recipients, counterparties } = addressesOf(request, decoded, extra.recipients);
    const input: TxCheckInput = { request, decoded, network, account, recipients, counterparties };
    const findings: ThreatFinding[] = [];
    const h = hostOf(request.origin);
    for (const p of this.providers) {
      if (h) findings.push(...(p.checkSiteSync?.(h) ?? []));
      for (const a of counterparties) findings.push(...(p.checkAddressSync?.(a) ?? []));
    }
    const remote = await Promise.all(this.providers.filter((p) => p.checkTransaction).map((p) => p.checkTransaction!(input).catch(() => [])));
    return toWarnings([...findings, ...remote.flat()]);
  }

  /** decoded + threat warnings (existing warnings kept; duplicates by code+message dropped). */
  async apply(request: DappRequest, decoded: DecodedRequest, network: Network, account: string, extra: { recipients?: string[] } = {}): Promise<DecodedRequest> {
    let add: Warning[];
    try {
      add = await this.assessRequest(request, decoded, network, account, extra);
    } catch {
      return decoded;
    }
    const have = new Set(decoded.warnings.map((w) => `${w.code}|${w.message}`));
    const fresh = add.filter((w) => !have.has(`${w.code}|${w.message}`));
    return fresh.length ? { ...decoded, warnings: [...fresh.filter((w) => w.level === "danger"), ...decoded.warnings, ...fresh.filter((w) => w.level !== "danger")] } : decoded;
  }
}
