import { ClipError } from "@clip-wallet/core";

/** Mirror node REST API (https://docs.hedera.com/hedera/sdks-and-apis/rest-api). Read-only. */

export interface MirrorAccount {
  account: string;
  evm_address: string | null;
  alias: string | null;
  balance: { balance: number; timestamp: string; tokens: { token_id: string; balance: number }[] };
  max_automatic_token_associations: number;
  staked_node_id: number | null;
  staked_account_id: string | null;
  decline_reward: boolean;
  pending_reward?: number;
  deleted?: boolean;
  key?: { _type: string; key: string } | null;
}

export interface MirrorTokenRelationship {
  token_id: string;
  balance: number;
  decimals?: number;
  automatic_association: boolean;
  freeze_status: string;
  kyc_status: string;
}

export interface MirrorToken {
  token_id: string;
  name: string;
  symbol: string;
  decimals: string;
  type: "FUNGIBLE_COMMON" | "NON_FUNGIBLE_UNIQUE";
  total_supply?: string;
  max_supply?: string;
}

export interface MirrorNft {
  token_id: string;
  serial_number: number;
  account_id: string;
  metadata: string;
  deleted?: boolean;
  spender?: string | null;
}

export interface MirrorSchedule {
  schedule_id: string;
  creator_account_id: string;
  payer_account_id: string;
  transaction_body: string;
  memo: string;
  executed_timestamp: string | null;
  deleted: boolean;
  expiration_time: string | null;
}

const tokenCache = new Map<string, Promise<MirrorToken | null>>();

export class Mirror {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async get<T>(path: string): Promise<T | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { headers: { accept: "application/json" } });
    } catch (cause) {
      throw new ClipError("Couldn't reach Hedera right now. Check your connection and try again.", "hedera/mirror-unreachable", cause);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ClipError("Hedera is slow to answer right now. Try again in a moment.", `hedera/mirror-${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Follows `links.next` up to `maxPages`. */
  async paged<T>(path: string, key: string, maxPages = 10): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    for (let i = 0; next && i < maxPages; i++) {
      const page: (Record<string, unknown> & { links?: { next: string | null } }) | null = await this.get(next);
      if (!page) break;
      out.push(...((page[key] as T[] | undefined) ?? []));
      next = page.links?.next ?? null;
    }
    return out;
  }

  /** Accepts 0.0.x, an EVM alias (0x…, 40 hex) or a key alias. Null when the account doesn't exist (yet). */
  account(idOrAlias: string): Promise<MirrorAccount | null> {
    return this.get<MirrorAccount>(`/api/v1/accounts/${encodeURIComponent(idOrAlias)}?transactions=false`);
  }

  tokenRelationships(accountId: string): Promise<MirrorTokenRelationship[]> {
    return this.paged<MirrorTokenRelationship>(`/api/v1/accounts/${accountId}/tokens?limit=100`, "tokens");
  }

  async tokenRelationship(accountId: string, tokenId: string): Promise<MirrorTokenRelationship | null> {
    const page = await this.get<{ tokens: MirrorTokenRelationship[] }>(
      `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}&limit=1`,
    );
    return page?.tokens.find((t) => t.token_id === tokenId) ?? null;
  }

  token(tokenId: string): Promise<MirrorToken | null> {
    const key = `${this.base}|${tokenId}`;
    let hit = tokenCache.get(key);
    if (!hit) {
      hit = this.get<MirrorToken>(`/api/v1/tokens/${tokenId}`).catch((e) => {
        tokenCache.delete(key);
        throw e;
      });
      tokenCache.set(key, hit);
    }
    return hit;
  }

  nfts(accountId: string, maxPages = 5): Promise<MirrorNft[]> {
    return this.paged<MirrorNft>(`/api/v1/accounts/${accountId}/nfts?limit=100`, "nfts", maxPages);
  }

  schedule(scheduleId: string): Promise<MirrorSchedule | null> {
    return this.get<MirrorSchedule>(`/api/v1/schedules/${scheduleId}`);
  }
}

/** For tests: forget cached token metadata. */
export function clearMirrorCache(): void {
  tokenCache.clear();
}
