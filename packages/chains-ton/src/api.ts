import { ClipError } from "@clip-wallet/core";
import { sleep } from "./util.js";

/**
 * Keyless clients for toncenter and tonapi over the context's fetch. Both public tiers allow about one request
 * per second per IP, so calls to the same host are spaced `minIntervalMs` apart (default 1100 ms) and a 429 is
 * retried once after a pause.
 */
const lastCall = new Map<string, number>();

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

export class TonHttp {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly minIntervalMs = 1100,
  ) {}

  private async pace(url: string): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const host = new URL(url).host;
    const wait = (lastCall.get(host) ?? 0) + this.minIntervalMs - Date.now();
    lastCall.set(host, Date.now() + Math.max(0, wait));
    if (wait > 0) await sleep(wait);
  }

  async json<T>(url: string, init?: { method?: string; body?: unknown }, retry = true): Promise<T> {
    await this.pace(url);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
        headers: init?.body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (cause) {
      throw new ClipError("Couldn't reach TON right now. Check your connection and try again.", "ton/unreachable", cause);
    }
    if (res.status === 429 && retry) {
      await sleep(Math.max(this.minIntervalMs, 0) * 2);
      return this.json<T>(url, init, false);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) throw new HttpError(res.status, body);
    return body as T;
  }
}

/* ------------------------------------------------------------------ shapes we read */

export interface WalletInformation {
  balance: string;
  status: "active" | "uninit" | "frozen" | "nonexist" | string;
  seqno?: number;
  wallet_type?: string;
}

export interface TonapiAddress {
  address: string;
  name?: string;
  is_scam?: boolean;
  is_wallet?: boolean;
}

export interface JettonPreview {
  address: string;
  name: string;
  symbol: string;
  decimals: number | string;
  image?: string;
  verification?: "whitelist" | "blacklist" | "none" | string;
}

export interface JettonBalance {
  balance: string;
  wallet_address: TonapiAddress;
  jetton: JettonPreview;
}

export interface TonapiNft {
  address: string;
  index?: number;
  owner?: TonapiAddress;
  collection?: { address: string; name: string };
  metadata?: { name?: string; image?: string; attributes?: { trait_type?: string; value?: unknown }[] };
  previews?: { resolution: string; url: string }[];
  trust?: string;
  approved_by?: string[];
}

export interface AccountEvent {
  actions: {
    type: string;
    status?: string;
    TonTransfer?: { sender: TonapiAddress; recipient: TonapiAddress; amount: number | string };
    JettonTransfer?: { sender?: TonapiAddress; recipient?: TonapiAddress; amount: string; jetton: JettonPreview };
    NftItemTransfer?: { sender?: TonapiAddress; recipient?: TonapiAddress; nft: string };
  }[];
  extra: number | string;
  is_scam?: boolean;
}
