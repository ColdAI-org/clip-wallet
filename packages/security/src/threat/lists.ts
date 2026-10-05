import type { FeatureHost } from "@clip-wallet/features";
import { fetchJson } from "../util.js";
import type { ProviderStatus, ThreatFinding, ThreatIntelProvider } from "./types.js";
import { say } from "@clip-wallet/core";

/**
 * Open phishing lists, downloaded whole and matched on the device. Verified 2026-10-03:
 *
 *  - MetaMask eth-phishing-detect: https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json
 *    `{ version, tolerance, fuzzylist, whitelist, blacklist }` (~102k blacklisted domains). Matching follows
 *    MetaMask's PhishingDetector (MetaMask/core packages/phishing-controller): allowlist first; a blocklist
 *    entry matches the domain or any subdomain of it; then the "fuzzy form" (the domain without its TLD) is
 *    compared to each fuzzylist entry's fuzzy form by Levenshtein distance ≤ tolerance.
 *  - ScamSniffer scam-database (daily, published with a 7-day delay per its README):
 *    https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json (string[]) and
 *    .../blacklist/address.json (EVM addresses, string[]).
 *  - Phantom blocklist: https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml
 *    (YAML list of `- url: <domain>`).
 *  - PolkadotJS phishing: https://raw.githubusercontent.com/polkadot-js/phishing/master/all.json
 *    `{ allow, deny }` and .../address.json `{ "<site or label>": [ss58 addresses] }`.
 *
 * Privacy: only the list file is requested (GitHub sees your IP, as for any download). No site you visit and
 * no address of yours leaves the device.
 */

export interface CompactList {
  allow: string[];
  deny: string[];
  fuzzy: string[];
  tolerance: number;
}

export interface ListSource {
  id: string;
  name: string;
  url: string;
  kind: "domains" | "addresses";
  /** Raw body → compact list. Throws on a malformed file (the last good copy is kept). */
  parse(body: string): CompactList;
  /** Text shown with a hit. */
  hitMessage(entry: string): string;
}

const empty = (): CompactList => ({ allow: [], deny: [], fuzzy: [], tolerance: 0 });
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const domain = (s: string) => s.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");

export const LIST_SOURCES: ListSource[] = [
  {
    id: "metamask",
    name: "MetaMask phishing list",
    url: "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json",
    kind: "domains",
    parse(body) {
      const j = JSON.parse(body) as Record<string, unknown>;
      const deny = strings(j.blacklist).map(domain);
      if (!deny.length) throw new Error("empty");
      return { allow: strings(j.whitelist).map(domain), deny, fuzzy: strings(j.fuzzylist).map(domain), tolerance: typeof j.tolerance === "number" ? j.tolerance : 0 };
    },
    hitMessage: () => "This site is on MetaMask's list of phishing sites. Don't connect or sign anything.",
  },
  {
    id: "scamsniffer",
    name: "ScamSniffer scam sites",
    url: "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json",
    kind: "domains",
    parse(body) {
      const deny = strings(JSON.parse(body)).map(domain);
      if (!deny.length) throw new Error("empty");
      return { ...empty(), deny };
    },
    hitMessage: () => "This site is on ScamSniffer's list of crypto scams. Don't connect or sign anything.",
  },
  {
    id: "scamsniffer-addresses",
    name: "ScamSniffer scam addresses",
    url: "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json",
    kind: "addresses",
    parse(body) {
      const deny = strings(JSON.parse(body)).map((a) => a.trim().toLowerCase());
      if (!deny.length) throw new Error("empty");
      return { ...empty(), deny };
    },
    hitMessage: (a) => `${short(a)} is on ScamSniffer's list of scam addresses. Don't send to it or give it permission.`,
  },
  {
    id: "phantom",
    name: "Phantom blocklist",
    url: "https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml",
    kind: "domains",
    parse(body) {
      const deny = [...body.matchAll(/^\s*-\s*url:\s*["']?([^"'\s#]+)["']?\s*$/gm)].map((m) => domain(m[1]!));
      if (!deny.length) throw new Error("empty");
      return { ...empty(), deny };
    },
    hitMessage: () => "This site is on Phantom's list of scam sites. Don't connect or sign anything.",
  },
  {
    id: "polkadot",
    name: "PolkadotJS phishing list",
    url: "https://raw.githubusercontent.com/polkadot-js/phishing/master/all.json",
    kind: "domains",
    parse(body) {
      const j = JSON.parse(body) as Record<string, unknown>;
      const deny = strings(j.deny).map(domain);
      if (!deny.length) throw new Error("empty");
      return { ...empty(), allow: strings(j.allow).map(domain), deny };
    },
    hitMessage: () => "This site is on the Polkadot community's list of phishing sites. Don't connect or sign anything.",
  },
  {
    id: "polkadot-addresses",
    name: "PolkadotJS scam addresses",
    url: "https://raw.githubusercontent.com/polkadot-js/phishing/master/address.json",
    kind: "addresses",
    parse(body) {
      const j = JSON.parse(body) as Record<string, unknown>;
      const deny = Object.values(j).flatMap(strings).map((a) => a.trim());
      if (!deny.length) throw new Error("empty");
      return { ...empty(), deny };
    },
    hitMessage: (a) => `${short(a)} is on the Polkadot community's list of scam addresses. Don't send to it.`,
  },
];

function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Host, then every parent domain ("a.b.example.com" → …, "example.com", "com"). */
export function suffixes(host: string): string[] {
  const parts = host.split(".");
  return parts.map((_, i) => parts.slice(i).join("."));
}

/** Levenshtein distance, giving up early once it exceeds `max`. */
export function distance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** MetaMask's fuzzy form: the domain without its last label (TLD). */
const fuzzyForm = (host: string) => host.split(".").slice(0, -1).join(".").replace(/^www\./, "");

/** Matching structure for one list. */
export class Matcher {
  private readonly allow: Set<string>;
  private readonly deny: Set<string>;
  readonly size: number;

  constructor(
    private readonly list: CompactList,
    private readonly kind: "domains" | "addresses",
  ) {
    this.allow = new Set(list.allow);
    this.deny = new Set(kind === "addresses" ? list.deny.map(normAddr) : list.deny);
    this.size = this.deny.size;
  }

  /** "deny" (exact or parent-domain hit), "fuzzy" (look-alike of a protected name) or null. */
  site(host: string): { kind: "deny" | "fuzzy"; entry: string } | null {
    const h = domain(host);
    const sfx = suffixes(h);
    if (sfx.some((s) => this.allow.has(s))) return null;
    const hit = sfx.find((s) => s.includes(".") && this.deny.has(s));
    if (hit) return { kind: "deny", entry: hit };
    if (this.list.tolerance > 0) {
      const form = fuzzyForm(h);
      for (const target of this.list.fuzzy) {
        // The protected site itself (or its subdomains) is not a look-alike of itself.
        if (h === target || h.endsWith(`.${target}`)) continue;
        if (form && distance(form, fuzzyForm(target), this.list.tolerance) <= this.list.tolerance) return { kind: "fuzzy", entry: target };
      }
    }
    return null;
  }

  address(a: string): boolean {
    return this.deny.has(normAddr(a));
  }
}

/** EVM addresses compare case-insensitively; base58/ss58 are case-sensitive. */
export function normAddr(a: string): string {
  const t = a.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? t.toLowerCase() : t;
}

interface Cached {
  fetchedAt: number;
  list: CompactList;
}

/** One open list: cached in kv, refreshed every `refreshHours`, matched locally. */
export class ListProvider implements ThreatIntelProvider {
  readonly sendsUserData = false;
  readonly privacy = "Downloads the public list to your device and checks it there. Nothing about you is sent.";
  readonly id: string;
  readonly name: string;
  private matcher: Matcher | null = null;
  private fetchedAt?: number;
  private lastError?: string;
  private inflight?: Promise<void>;

  constructor(
    readonly source: ListSource,
    private readonly host: Pick<FeatureHost, "kv" | "fetch" | "now">,
    private readonly refreshHours = 24,
  ) {
    this.id = source.id;
    this.name = source.name;
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private get key() {
    return `security/list/${this.source.id}`;
  }

  async load(): Promise<void> {
    if (this.matcher) return;
    const c = await this.host.kv.get<Cached>(this.key);
    if (c?.list) this.use(c);
  }

  private use(c: Cached) {
    this.matcher = new Matcher(c.list, this.source.kind);
    this.fetchedAt = c.fetchedAt;
  }

  refresh(force = false): Promise<void> {
    this.inflight ??= this.doRefresh(force).finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async doRefresh(force: boolean): Promise<void> {
    await this.load();
    if (!force && this.fetchedAt && this.now() - this.fetchedAt < this.refreshHours * 3_600_000) return;
    try {
      const body = await fetchJson<string>(this.host.fetch, this.source.url, this.source.name, { as: "text", timeoutMs: 30_000 });
      const c: Cached = { fetchedAt: this.now(), list: this.source.parse(body) };
      this.use(c);
      this.lastError = undefined;
      await this.host.kv.set(this.key, c);
    } catch {
      this.lastError = this.matcher ? "Couldn't refresh this list. Using the last copy." : "Couldn't download this list yet. It will try again later.";
    }
  }

  status(): ProviderStatus {
    return {
      enabled: true,
      updatedAt: this.fetchedAt,
      entries: this.matcher?.size,
      unavailable: this.lastError ? { code: "threat/list-stale", message: this.lastError } : undefined,
    };
  }

  checkSiteSync(host: string): ThreatFinding[] {
    if (this.source.kind !== "domains" || !this.matcher) return [];
    const hit = this.matcher.site(host);
    if (!hit) return [];
    if (hit.kind === "fuzzy") {
      return [{ level: "danger", code: "phishing-site", source: this.id, message: say("bg.security.lookAlikeSite", { site: hit.entry }) }];
    }
    return [{ level: "danger", code: "phishing-site", source: this.id, message: this.source.hitMessage(hit.entry) }];
  }

  checkAddressSync(address: string): ThreatFinding[] {
    if (this.source.kind !== "addresses" || !this.matcher?.address(address)) return [];
    return [{ level: "danger", code: "malicious-transaction", source: this.id, message: this.source.hitMessage(address) }];
  }
}
