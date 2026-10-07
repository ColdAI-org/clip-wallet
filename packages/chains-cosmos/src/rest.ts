import { ClipError, type ChainContext } from "@clip-wallet/core";
import { b64encode, isObj } from "./util.js";

/** `url` without trailing slashes (a scan, not a regex: linear on any input). */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

/**
 * Cosmos SDK REST (gRPC-gateway "LCD") over ctx.fetch, trying each of the network's endpoints in order when one is
 * unreachable or answers 5xx/429. Routes (cosmos-sdk proto/cosmos/{auth,bank,tx}/…/query.proto, service.proto):
 *  - GET  /cosmos/auth/v1beta1/account_info/{address}   (SDK ≥ 0.47; uniform BaseAccount fields for every account type)
 *  - GET  /cosmos/auth/v1beta1/accounts/{address}       (fallback; the account Any is unwrapped below)
 *  - GET  /cosmos/bank/v1beta1/balances/{address}
 *  - POST /cosmos/tx/v1beta1/simulate  { tx_bytes }
 *  - POST /cosmos/tx/v1beta1/txs       { tx_bytes, mode: "BROADCAST_MODE_SYNC" }
 *  - GET  /cosmos/tx/v1beta1/txs/{hash}
 */

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
  /** gRPC status code inside the gateway's error body ({ code, message, details }). */
  get grpcCode(): number | undefined {
    return isObj(this.body) && typeof this.body.code === "number" ? this.body.code : undefined;
  }
  get notFound(): boolean {
    return this.status === 404 || this.grpcCode === 5 || /not found/i.test(this.message);
  }
}

export interface Rest {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function restFor(ctx: ChainContext): Rest {
  const bases = ctx.network.rpcUrls.map(withoutTrailingSlashes);
  if (!bases.length) throw new ClipError("No connection is set up for this network.", "cosmos/no-endpoint");

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let last: unknown;
    for (const base of bases) {
      let res: Response;
      try {
        res = await ctx.fetch(base + path, init);
      } catch (e) {
        last = e;
        continue;
      }
      const text = await res.text().catch(() => "");
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep text */
      }
      if (res.ok) return body as T;
      if (res.status >= 500 && !(isObj(body) && typeof body.code === "number" && body.code !== 13 && body.code !== 14)) {
        // 500 with a gRPC code (5 not found, 3 invalid argument) is the node's real answer; other 5xx: next endpoint
        last = new RestError(res.status, body, isObj(body) && typeof body.message === "string" ? body.message : `HTTP ${res.status}`);
        continue;
      }
      if (res.status === 429) {
        last = new RestError(res.status, body, "rate limited");
        continue;
      }
      throw new RestError(res.status, body, isObj(body) && typeof body.message === "string" ? body.message : `HTTP ${res.status}`);
    }
    if (last instanceof RestError) throw last;
    throw new ClipError("We couldn't reach the network. Check your connection and try again.", "cosmos/offline", last);
  }

  return {
    get: (path) => call(path),
    post: (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

/* ------------------------------------------------------------------ accounts */

export interface OnChainAccount {
  address: string;
  accountNumber: bigint;
  sequence: bigint;
  /** Any JSON from the node ({ "@type", key }), when the account has signed before. */
  pubKey?: { "@type"?: string; key?: string };
}

/** Finds the BaseAccount fields in any account JSON (BaseAccount, vesting accounts, ModuleAccount, EthAccount…). */
function findBase(x: unknown, depth = 0): Record<string, unknown> | null {
  if (!isObj(x) || depth > 5) return null;
  if (typeof x.account_number === "string" && typeof x.address === "string") return x;
  for (const v of Object.values(x)) {
    const f = findBase(v, depth + 1);
    if (f) return f;
  }
  return null;
}

/** Module accounts hold no key: nobody can sign for them. */
const MODULE_ACCOUNT = /ModuleAccount$/;

/** The account, or null when it doesn't exist on chain yet (never received anything). */
export async function getAccount(rest: Rest, address: string): Promise<OnChainAccount | null> {
  let raw: unknown;
  try {
    raw = (await rest.get<{ info?: unknown }>(`/cosmos/auth/v1beta1/account_info/${address}`)).info;
  } catch (e) {
    if (!(e instanceof RestError)) throw e;
    if (e.notFound && !/Not Implemented|unknown service|501/i.test(e.message) && e.status !== 501) return null;
    try {
      const r = await rest.get<{ account?: unknown }>(`/cosmos/auth/v1beta1/accounts/${address}`);
      raw = r.account;
      if (isObj(raw) && typeof raw["@type"] === "string" && MODULE_ACCOUNT.test(raw["@type"])) {
        throw new ClipError("This is a module account. Nobody can sign for it.", "cosmos/module-account");
      }
    } catch (e2) {
      if (e2 instanceof RestError && e2.notFound) return null;
      throw e2;
    }
  }
  const b = findBase(raw);
  if (!b) return null;
  const out: OnChainAccount = {
    address: String(b.address),
    accountNumber: BigInt(String(b.account_number ?? "0")),
    sequence: BigInt(String(b.sequence ?? "0")),
  };
  if (isObj(b.pub_key)) out.pubKey = b.pub_key as OnChainAccount["pubKey"];
  return out;
}

/* ------------------------------------------------------------------ balances */

export async function getAllBalances(rest: Rest, address: string): Promise<{ denom: string; amount: string }[]> {
  const out: { denom: string; amount: string }[] = [];
  let key = "";
  for (let page = 0; page < 10; page++) {
    const q = `pagination.limit=200${key ? `&pagination.key=${encodeURIComponent(key)}` : ""}`;
    let r: { balances?: { denom: string; amount: string }[]; pagination?: { next_key?: string | null } };
    try {
      r = await rest.get(`/cosmos/bank/v1beta1/balances/${address}?${q}`);
    } catch (e) {
      if (e instanceof RestError && e.notFound) return out;
      throw e;
    }
    out.push(...(r.balances ?? []));
    key = r.pagination?.next_key ?? "";
    if (!key) break;
  }
  return out;
}

/* ------------------------------------------------------------------ simulate / broadcast */

export async function simulate(rest: Rest, txBytes: Uint8Array): Promise<bigint> {
  const r = await rest.post<{ gas_info?: { gas_used?: string } }>("/cosmos/tx/v1beta1/simulate", { tx_bytes: b64encode(txBytes) });
  const used = r.gas_info?.gas_used;
  if (!used || !/^\d+$/.test(used)) throw new RestError(200, r, "simulate returned no gas");
  return BigInt(used);
}

export interface TxResponse {
  txhash: string;
  code: number;
  codespace?: string;
  raw_log?: string;
  height?: string;
}

export async function broadcastSync(rest: Rest, txBytes: Uint8Array): Promise<TxResponse> {
  const r = await rest.post<{ tx_response?: TxResponse }>("/cosmos/tx/v1beta1/txs", { tx_bytes: b64encode(txBytes), mode: "BROADCAST_MODE_SYNC" });
  if (!r.tx_response) throw new RestError(200, r, "broadcast returned no tx_response");
  return r.tx_response;
}

export async function getTx(rest: Rest, hash: string): Promise<TxResponse | null> {
  try {
    const r = await rest.get<{ tx_response?: TxResponse }>(`/cosmos/tx/v1beta1/txs/${hash}`);
    return r.tx_response ?? null;
  } catch (e) {
    if (e instanceof RestError && (e.notFound || e.status === 400)) return null;
    throw e;
  }
}

/* ------------------------------------------------------------------ errors in plain words */

/**
 * SDK ABCI codes (codespace "sdk", cosmos-sdk types/errors/errors.go) → plain words. Anything else: the network
 * refused, nothing was sent.
 */
export function plainCosmosError(code: number, codespace: string | undefined, log: string | undefined, symbol: string): string {
  const l = log ?? "";
  if (!codespace || codespace === "sdk") {
    switch (code) {
      case 4:
        return "The network didn't accept the signature. Nothing was sent.";
      case 5:
        return `You don't have enough ${symbol} for this and its network fee.`;
      case 7:
        return "That address isn't valid on this network.";
      case 10:
        return "The amount isn't valid.";
      case 11:
        return "The network ran out of gas for this. Nothing was sent; try again.";
      case 13:
        return "The network fee was too low. Try again.";
      case 19:
        return "This transaction is already on its way.";
      case 20:
        return "The network is busy right now. Try again in a minute.";
      case 30:
        return "This transaction expired. Try again.";
      case 32:
        return "Another transaction from this account went first. Try again.";
    }
  }
  if (/insufficient funds|insufficient balance/i.test(l)) return `You don't have enough ${symbol} for this and its network fee.`;
  if (/insufficient fee/i.test(l)) return "The network fee was too low. Try again.";
  return "The network rejected this. Nothing was sent.";
}
