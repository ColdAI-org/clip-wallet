/**
 * Solana Name Service (.sol) via Bonfida's public SDK proxy, which runs `resolve()` from @bonfida/spl-name-service
 * (SOL record v2 → v1 → domain owner, per the SNS resolution spec):
 *   GET https://sdk-proxy.sns.id/resolve/<domain>          → { s: "ok", result: "<base58>" } | { s: "error", result: "Domain not found" }
 *   GET https://sdk-proxy.sns.id/favorite-domain/<owner>   → { s: "ok", result: { domain, reverse, stale } }
 * Checked live on 2026-10-03 (the older sns-sdk-proxy.bonfida.workers.dev host now returns 404).
 * Source: https://github.com/SolanaNameService/sns-sdk (proxy/), https://docs.sns.id.
 *
 * SNS is a mainnet registry. The resolved key is an ed25519 public key, which is the same address on every
 * Solana cluster, so networkIds is left empty (the Send screen uses the wallet's Solana network).
 */
import type { Family, NetworkId } from "@clip-wallet/core";
import { getJson } from "./http.js";
import type { Backend, ResolvedName } from "./types.js";

export const SNS_PROXY = "https://sdk-proxy.sns.id";
const BASE58_32 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Labels: lower-case letters, digits, '-', '_' and non-ASCII (SNS allows emoji), up to 63 chars. Subdomains allowed. */
const SNS_NAME = /^([a-z0-9_\-\u0080-￿]{1,63}\.){1,2}sol$/u;

/** Invisible / direction-changing characters can make one name look like another (audit NAME-01). */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0]/u;

export function isSnsName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return SNS_NAME.test(n) && !INVISIBLE.test(n);
}

export class SnsBackend implements Backend {
  readonly service = "sns" as const;
  constructor(private readonly opts: { fetch?: typeof fetch; baseUrl?: string } = {}) {}

  private get f(): typeof fetch {
    return this.opts.fetch ?? globalThis.fetch.bind(globalThis);
  }
  private get base(): string {
    return (this.opts.baseUrl ?? SNS_PROXY).replace(/\/+$/, "");
  }

  handles(name: string): boolean {
    return isSnsName(name);
  }

  async resolve(raw: string): Promise<ResolvedName | null> {
    const name = raw.trim().toLowerCase();
    if (!isSnsName(name)) return null;
    const domain = name.slice(0, -4);
    const { body } = await getJson<{ s: string; result: unknown }>(this.f, `${this.base}/resolve/${encodeURIComponent(domain)}`, "sns");
    if (!body || body.s !== "ok" || typeof body.result !== "string" || !BASE58_32.test(body.result)) return null;
    return { name, address: body.result, family: "solana", networkIds: [], service: "sns", displayName: name };
  }

  async reverse(address: string, family: Family, _networkId?: NetworkId): Promise<string | null> {
    if (family !== "solana" || !BASE58_32.test(address)) return null;
    try {
      const { body } = await getJson<{ s: string; result: { reverse?: string; stale?: boolean } | string }>(this.f, `${this.base}/favorite-domain/${address}`, "sns");
      if (!body || body.s !== "ok" || typeof body.result !== "object" || !body.result.reverse || body.result.stale) return null;
      const n = `${body.result.reverse}.sol`;
      return isSnsName(n) ? n : null;
    } catch {
      return null;
    }
  }
}
