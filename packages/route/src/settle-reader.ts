import { ClipError } from "@clip-wallet/core";
import { hexToNumber, isHex } from "viem";
import type { Hex } from "viem";

/**
 * Reads from Hedera for the settle client: contract calls, Hedera's clock and order-book logs.
 *
 * Primary path: the Hedera mirror node REST API (OpenAPI 0.164.0, https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml,
 * docs https://docs.hedera.com/hedera/sdks-and-apis/rest-api):
 *  - `POST /api/v1/contracts/call` with `{ to, data, block: "latest" }` → `{ result }` (read-only EVM execution);
 *  - `GET /api/v1/blocks?limit=1&order=desc` → `blocks[0].timestamp.to` ("seconds.nanos"), Hedera's clock;
 *  - `GET /api/v1/contracts/{address}/results/logs?topic0=..&topic2=..&timestamp=gte:A&timestamp=lt:B&order=desc&limit=100`,
 *    following `links.next`. A topic filter needs a timestamp range of at most 7 days (checked live on testnet
 *    2026-10-03: gte+lt spanning exactly 604800 s is accepted, gte+lte over the same span is refused).
 * Why the mirror node: it is public without an API key, it is what the wallet already uses for Hedera
 * (packages/chains-hedera `MIRROR_NODE_URLS`), and it serves logs with topic filters.
 *
 * Fallback: a Hedera JSON-RPC relay (https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay,
 * e.g. Hashio) for `eth_call` and `eth_getBlockByNumber("latest")`. It does not list logs here (relays cap
 * `eth_getLogs` ranges), so with a relay only `listOrders` falls back to orders created in this session.
 */
export interface HederaReader {
  call(to: Hex, data: Hex): Promise<Hex>;
  /** Hedera consensus time of the latest block, unix seconds. */
  now(): Promise<number>;
  logs?(q: LogQuery): Promise<RawLog[]>;
}

export interface LogQuery {
  address: Hex;
  topic0: Hex;
  topic2?: Hex;
  /** Unix seconds, inclusive. */
  from: number;
  /** Unix seconds, exclusive. */
  to: number;
}

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  transactionHash?: Hex;
  timestamp?: string;
}

const unreachable = (e?: unknown) =>
  new ClipError("We couldn't check Hedera right now. Try again in a minute.", "hedera-unreachable", e);

/** Max span of one topic-filtered log query on the mirror node. */
export const MIRROR_LOG_WINDOW_S = 7 * 24 * 3600;
const MAX_LOG_PAGES = 20;

export class MirrorNodeReader implements HederaReader {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(baseUrl: string, fetchImpl?: typeof fetch) {
    this.base = baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    this.f = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
    } catch (e) {
      throw unreachable(e);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      throw unreachable(e);
    }
    return { status: res.status, body };
  }

  async call(to: Hex, data: Hex): Promise<Hex> {
    const { status, body } = await this.json("/api/v1/contracts/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, data, block: "latest" }),
    });
    if (status === 200 && typeof body?.result === "string" && isHex(body.result)) return body.result as Hex;
    if (status === 429) throw new ClipError("Hedera is busy right now. Try again in a minute.", "hedera-rate-limited");
    throw new ClipError("Hedera couldn't answer a check we need. Try again in a minute.", "hedera-call-failed", body);
  }

  async now(): Promise<number> {
    const { status, body } = await this.json("/api/v1/blocks?limit=1&order=desc");
    const ts = body?.blocks?.[0]?.timestamp?.to ?? body?.blocks?.[0]?.timestamp?.from;
    if (status !== 200 || typeof ts !== "string" || !/^\d+(\.\d+)?$/.test(ts)) throw unreachable(body);
    return Number(ts.split(".")[0]);
  }

  async logs(q: LogQuery): Promise<RawLog[]> {
    const params = new URLSearchParams();
    params.append("topic0", q.topic0);
    if (q.topic2) params.append("topic2", q.topic2);
    params.append("timestamp", `gte:${q.from}.000000000`);
    params.append("timestamp", `lt:${q.to}.000000000`);
    params.append("order", "desc");
    params.append("limit", "100");
    let path: string | null = `/api/v1/contracts/${q.address}/results/logs?${params.toString()}`;
    const out: RawLog[] = [];
    for (let page = 0; path && page < MAX_LOG_PAGES; page++) {
      const { status, body }: { status: number; body: any } = await this.json(path);
      if (status !== 200 || !Array.isArray(body?.logs)) throw unreachable(body);
      for (const l of body.logs) {
        if (typeof l?.address !== "string" || !Array.isArray(l?.topics)) continue;
        out.push({
          address: l.address as Hex,
          topics: l.topics as Hex[],
          data: (l.data ?? "0x") as Hex,
          transactionHash: l.transaction_hash,
          timestamp: l.timestamp,
        });
      }
      const next: unknown = body?.links?.next;
      path = typeof next === "string" && next.startsWith("/api/v1/") ? next : null;
    }
    return out;
  }
}

export class JsonRpcReader implements HederaReader {
  private readonly url: string;
  private readonly f: typeof fetch;
  private id = 0;

  constructor(url: string, fetchImpl?: typeof fetch) {
    this.url = url;
    this.f = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async rpc(method: string, params: unknown[]): Promise<any> {
    let body: any;
    try {
      const res = await this.f(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      });
      body = await res.json();
    } catch (e) {
      throw unreachable(e);
    }
    if (body?.error) throw new ClipError("Hedera couldn't answer a check we need. Try again in a minute.", "hedera-call-failed", body.error);
    return body?.result;
  }

  async call(to: Hex, data: Hex): Promise<Hex> {
    const r = await this.rpc("eth_call", [{ to, data }, "latest"]);
    if (typeof r !== "string" || !isHex(r)) throw unreachable(r);
    return r as Hex;
  }

  async now(): Promise<number> {
    const b = await this.rpc("eth_getBlockByNumber", ["latest", false]);
    if (typeof b?.timestamp !== "string" || !isHex(b.timestamp)) throw unreachable(b);
    return hexToNumber(b.timestamp as Hex);
  }
}
