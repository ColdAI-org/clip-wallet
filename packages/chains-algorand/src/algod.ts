import { ClipError, type ChainContext, includesInOrder } from "@clip-wallet/core";
import { IntDecoding, parseJSON } from "algosdk";
import { specFor } from "./networks.js";

/** An algod / indexer HTTP error. `message` is the node's raw text: never show it to the user. */
export class AlgodError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** algod JSON can hold uint64 values above 2^53 (asset totals): keep those as bigint. */
function parse(text: string): unknown {
  return parseJSON(text, { intDecoding: IntDecoding.MIXED });
}

async function read(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = String((JSON.parse(text) as { message?: unknown }).message ?? text);
    } catch {
      /* not JSON */
    }
    throw new AlgodError(res.status, msg);
  }
  return text ? parse(text) : null;
}

export interface AlgodAccount {
  address: string;
  amount: unknown;
  "min-balance": unknown;
  "auth-addr"?: string;
  assets?: { "asset-id": unknown; amount: unknown; "is-frozen"?: boolean }[];
  "total-assets-opted-in"?: number;
}

export interface AssetParamsJson {
  creator: string;
  decimals: number;
  total: unknown;
  name?: string;
  "unit-name"?: string;
  url?: string;
  reserve?: string;
  manager?: string;
  "default-frozen"?: boolean;
}

export interface SuggestedParamsJson {
  fee: unknown;
  "min-fee": unknown;
  "last-round": unknown;
  "genesis-hash": string;
  "genesis-id": string;
}

export class Algod {
  constructor(
    public readonly url: string,
    private readonly f: typeof fetch,
    public readonly indexerUrl: string | null,
  ) {}

  async get<T>(path: string): Promise<T> {
    return (await read(await this.f(`${this.url}${path}`, { headers: { accept: "application/json" } }))) as T;
  }

  async indexer<T>(path: string): Promise<T> {
    if (!this.indexerUrl) throw new AlgodError(0, "no indexer");
    return (await read(await this.f(`${this.indexerUrl}${path}`, { headers: { accept: "application/json" } }))) as T;
  }

  async post<T>(path: string, body: Uint8Array, contentType: string): Promise<T> {
    return (await read(await this.f(`${this.url}${path}`, { method: "POST", headers: { "content-type": contentType }, body: body as BodyInit }))) as T;
  }

  account(address: string): Promise<AlgodAccount> {
    return this.get<AlgodAccount>(`/v2/accounts/${address}`);
  }

  /** The account's holding of an asset, or null when it hasn't opted in (404). */
  async holding(address: string, assetId: string | bigint): Promise<{ amount: bigint; frozen: boolean } | null> {
    try {
      const r = await this.get<{ "asset-holding": { amount: unknown; "is-frozen"?: boolean } }>(`/v2/accounts/${address}/assets/${assetId}`);
      return { amount: BigInt(String(r["asset-holding"].amount)), frozen: !!r["asset-holding"]["is-frozen"] };
    } catch (e) {
      if (e instanceof AlgodError && e.status === 404) return null;
      throw e;
    }
  }

  params(): Promise<SuggestedParamsJson> {
    return this.get<SuggestedParamsJson>("/v2/transactions/params");
  }
}

export function algodFor(ctx: ChainContext): Algod {
  const url = ctx.network.rpcUrls[0] ?? specFor(ctx.network.id)?.algod;
  if (!url) throw new ClipError("No Algorand connection is set up for this network.", "algorand/no-rpc");
  return new Algod(url.replace(/\/$/, ""), ctx.fetch, ctx.network.indexerUrl ?? specFor(ctx.network.id)?.indexer ?? null);
}

export interface PlainErrorHints {
  /** This account's address. */
  me?: string;
  /** Token symbol for an asset id, when known. */
  tokenName?: (assetId: string) => string | undefined;
}

type Mapper = (m: readonly string[], h: PlainErrorHints) => string;

/** First match wins. "a … b" on one line is includesInOrder (indexOf scans) rather than a regex like /a .* b/i. */
const PLAIN_ERRORS: [RegExp | ((raw: string) => boolean), Mapper][] = [
  [
    /asset (\d+) missing from ([A-Z2-7]{58})/,
    (m, h) => {
      const token = h.tokenName?.(m[1]!) ?? "this token";
      return m[2] === h.me
        ? `You haven't added ${token} to your account yet.`
        : `They haven't added ${token} to their account yet. Ask them to add it first.`;
    },
  ],
  [/overspend/i, () => "You don't have enough ALGO for this, including the network fee."],
  [/below min|balance \d+ below min/i, () => "This would leave your account below its minimum balance. Keep at least the locked ALGO in it."],
  [/underflow on subtracting|insufficient (asset )?balance/i, () => "You don't have enough of that token."],
  [(raw) => includesInOrder(raw, "asset ", " insufficient"), () => "You don't have enough of that token."],
  [/txn dead|round \d+ outside of \d+--\d+/i, () => "This transaction expired before it was sent. Try again."],
  [/fee too small|below threshold/i, () => "The network fee was too low. Try again."],
  [(raw) => includesInOrder(raw, "fee ", " less than"), () => "The network fee was too low. Try again."],
  [/should have been authorized by|authorized by/i, () => "This account is controlled by another key, so Clip Wallet can't sign for it."],
  [/already in ledger/i, () => "This transaction was already sent."],
  [/frozen/i, () => "This token is frozen for this account, so it can't move right now."],
  [/logic eval error|rejected by logic|err opcode|assert failed/i, () => "The app rejected this transaction."],
  [
    (raw) => /incomplete group/i.test(raw) || includesInOrder(raw, "group ", " mismatch") || includesInOrder(raw, "transactionPool.Remember: ", "group"),
    () => "Part of this group of transactions is missing, so nothing was sent.",
  ],
];

/** Maps a raw algod error message to plain words. */
export function plainAlgorandError(raw: string, hints: PlainErrorHints = {}): string {
  for (const [test, f] of PLAIN_ERRORS) {
    const m = test instanceof RegExp ? raw.match(test) : test(raw) ? [raw] : null;
    if (m) return f(m, hints);
  }
  return "The Algorand network refused this transaction. Nothing was sent.";
}
