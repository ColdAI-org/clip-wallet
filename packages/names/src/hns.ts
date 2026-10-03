/**
 * Hashgraph Name Service (.hbar, .boo, .cream) via its public resolver (no API key), the same endpoints the
 * official SDK uses (@hedera-name-service/hns-resolution-sdk 2.0.15, src/helpers/IndexerAPI.ts):
 *   GET https://{mainnet|testnet}.resolver.hashgraph.name/slds/domains?domain=<name>
 *       → { account_id: "0.0.x", expiration: <ms since epoch>, deleted: bool, … } | 404 { message: "Not Found" }
 *         | 403 "Domain is reserved."
 *   GET …/slds/default-name/<accountId> → { account_id, domain }
 * Checked live 2026-10-03 (hashpack.hbar → 0.0.944899 on mainnet). `account_id` is the holder of the domain
 * NFT: that is who the SDK's resolveSLD() pays. Expiration is in milliseconds in live responses (the SDK
 * reads it as seconds, which never expires); we accept both.
 *
 * A .hbar name implies the Hedera ledger whose resolver answered, so networkIds is that one ledger.
 */
import type { Family, NetworkId } from "@clip-wallet/core";
import { getJson } from "./http.js";
import type { Backend, ResolvedName } from "./types.js";

export const HNS_RESOLVERS = {
  mainnet: "https://mainnet.resolver.hashgraph.name",
  testnet: "https://testnet.resolver.hashgraph.name",
} as const;

const HNS_NAME = /^[a-z0-9-]{1,63}\.(hbar|boo|cream)$/;
const ACCOUNT_ID = /^0\.0\.\d+$/;

export function isHnsName(name: string): boolean {
  return HNS_NAME.test(name.trim().toLowerCase());
}

interface HnsDomain {
  account_id?: string;
  expiration?: number;
  deleted?: boolean;
  domain?: string;
}

export class HnsBackend implements Backend {
  readonly service = "hns" as const;
  constructor(private readonly opts: { ledger?: "mainnet" | "testnet"; fetch?: typeof fetch; now?: () => number } = {}) {}

  private get ledger() {
    return this.opts.ledger ?? "testnet";
  }
  private get f(): typeof fetch {
    return this.opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  handles(name: string): boolean {
    return isHnsName(name);
  }

  async resolve(raw: string): Promise<ResolvedName | null> {
    const name = raw.trim().toLowerCase();
    if (!isHnsName(name)) return null;
    const { status, body } = await getJson<HnsDomain>(this.f, `${HNS_RESOLVERS[this.ledger]}/slds/domains?domain=${encodeURIComponent(name)}`, "hns");
    if (status !== 200 || !body || body.deleted || !body.account_id || !ACCOUNT_ID.test(body.account_id)) return null;
    if (typeof body.expiration === "number") {
      const ms = body.expiration > 1e12 ? body.expiration : body.expiration * 1000;
      if (ms < (this.opts.now ?? Date.now)()) return null;
    }
    return { name, address: body.account_id, family: "hedera", networkIds: [`hedera:${this.ledger}`], service: "hns", displayName: name };
  }

  async reverse(address: string, family: Family, networkId?: NetworkId): Promise<string | null> {
    if (family !== "hedera" || !ACCOUNT_ID.test(address)) return null;
    if (networkId && networkId !== `hedera:${this.ledger}`) return null;
    try {
      const { status, body } = await getJson<HnsDomain>(this.f, `${HNS_RESOLVERS[this.ledger]}/slds/default-name/${address}`, "hns");
      return status === 200 && body?.domain && isHnsName(body.domain) && body.account_id === address ? body.domain : null;
    } catch {
      return null;
    }
  }
}
