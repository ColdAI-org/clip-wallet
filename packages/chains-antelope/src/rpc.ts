import { type ChainContext, ClipError, type Msg, msg } from "@clip-wallet/core";
import type { Abi } from "./abi.js";
import { bytesEqual, parsePublicKey } from "./bytes.js";
import type { AntelopeNetSpec } from "./networks.js";
import { specFor } from "./networks.js";

/**
 * Spring/Leap chain API (`/v1/chain/*`) over `ctx.fetch`, trying each of the network's servers in turn. A server that
 * can't be reached, answers 5xx without an Antelope error, or doesn't have the endpoint (404 "Unknown Endpoint") is
 * skipped; an Antelope error answer (`{ code, error: { name, what, details } }`) is the chain's answer and is thrown
 * as AntelopeRpcError.
 */
export class AntelopeRpcError extends Error {
  constructor(
    /** fc exception name, e.g. "tx_cpu_usage_exceeded". */
    public readonly name: string,
    public readonly code: number,
    public readonly details: string[],
  ) {
    super(`${name}: ${details.join("; ")}`);
  }
}

class Missing extends Error {}

export interface ChainInfo {
  chain_id: string;
  head_block_num: number;
  head_block_time: string;
  last_irreversible_block_num: number;
  last_irreversible_block_id: string;
}

export interface KeyAccount {
  account: string;
  permission: string;
}

export interface Rpc {
  post<T>(path: string, body: unknown): Promise<T>;
  info(): Promise<ChainInfo>;
  /** null when the account has no contract. Cached per network and account. */
  abi(account: string): Promise<Abi | null>;
  /** null when the account doesn't exist. */
  account(name: string): Promise<Record<string, unknown> | null>;
  balance(code: string, account: string, symbol: string): Promise<string | null>;
  /** Accounts (and permissions) this key can sign for: chain API, then Hyperion. */
  accountsForKey(publicKey: string): Promise<KeyAccount[]>;
  /** Hyperion state/get_tokens, when the network has a Hyperion. */
  tokens(account: string): Promise<{ contract: string; symbol: string; precision: number; amount: string }[] | null>;
  send(packedTrx: string, signatures: string[]): Promise<{ transaction_id: string; processed?: Record<string, unknown> }>;
}

const abiCache = new Map<string, Abi | null>();
export const clearAbiCache = () => abiCache.clear();

export function rpcFor(ctx: ChainContext): Rpc {
  const spec = specFor(ctx.network.id);
  const urls = ctx.network.rpcUrls;
  const hyperion = ctx.network.indexerUrl;

  async function once<T>(base: string, path: string, body: unknown): Promise<T> {
    const res = await ctx.fetch(`${base.replace(/\/$/, "")}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    const err = json && typeof json.error === "object" && json.error ? (json.error as { name?: string; code?: number; what?: string; details?: { message?: string }[] }) : null;
    if (res.status === 404 || (err && /Unknown Endpoint/i.test(JSON.stringify(err.details ?? "")))) throw new Missing(path);
    if (err && err.name) throw new AntelopeRpcError(err.name, Number(err.code ?? 0), (err.details ?? []).map((d) => String(d.message ?? "")).filter(Boolean));
    if (!res.ok || !json) throw new Error(`HTTP ${res.status}`);
    return json as T;
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    let last: unknown;
    let missing = 0;
    for (const url of urls) {
      try {
        return await once<T>(url, path, body);
      } catch (e) {
        if (e instanceof AntelopeRpcError) throw e;
        if (e instanceof Missing) missing++;
        last = e;
      }
    }
    if (missing === urls.length) throw new Missing(path);
    throw new ClipError(msg("bg.antelope.err.offline", { network: ctx.network.name }), "antelope/offline", last);
  }

  return {
    post,
    info: () => post<ChainInfo>("/v1/chain/get_info", {}),
    async abi(account) {
      const key = `${ctx.network.id}/${account}`;
      if (abiCache.has(key)) return abiCache.get(key)!;
      const r = await post<{ abi?: Abi }>("/v1/chain/get_abi", { account_name: account });
      const abi = r.abi && Array.isArray(r.abi.structs) ? r.abi : null;
      abiCache.set(key, abi);
      return abi;
    },
    async account(name) {
      try {
        return await post<Record<string, unknown>>("/v1/chain/get_account", { account_name: name });
      } catch (e) {
        if (e instanceof AntelopeRpcError) return null; // unknown account (exception name differs across versions)
        throw e;
      }
    },
    async balance(code, account, symbol) {
      try {
        const r = await post<string[]>("/v1/chain/get_currency_balance", { code, account, symbol });
        return Array.isArray(r) ? (r[0] ?? null) : null;
      } catch (e) {
        if (e instanceof AntelopeRpcError) return null;
        throw e;
      }
    },
    async accountsForKey(publicKey) {
      const mine = parsePublicKey(publicKey);
      const same = (k: unknown) => {
        try {
          return typeof k === "string" && bytesEqual(parsePublicKey(k), mine);
        } catch {
          return false;
        }
      };
      try {
        const r = await post<{ accounts: { account_name: string; permission_name: string; authorizing_key?: string; weight: number; threshold: number }[] }>(
          "/v1/chain/get_accounts_by_authorizers",
          { keys: [publicKey] },
        );
        // Only permissions this key satisfies alone (weight ≥ threshold).
        return r.accounts.filter((a) => same(a.authorizing_key) && a.weight >= a.threshold).map((a) => ({ account: a.account_name, permission: a.permission_name }));
      } catch (e) {
        if (!(e instanceof Missing) && !(e instanceof ClipError)) throw e;
        if (!hyperion) throw e instanceof Missing ? new ClipError(msg("bg.antelope.err.offline", { network: ctx.network.name }), "antelope/offline", e) : e;
      }
      const r = await once<{ account_names?: string[] }>(hyperion, `/v2/state/get_key_accounts?public_key=${encodeURIComponent(publicKey)}`, undefined).catch((e) => {
        throw new ClipError(msg("bg.antelope.err.offline", { network: ctx.network.name }), "antelope/offline", e);
      });
      return (r.account_names ?? []).map((account) => ({ account, permission: "active" }));
    },
    async tokens(account) {
      if (!hyperion) return null;
      try {
        const r = await once<{ tokens?: { contract: string; symbol: string; precision?: number; amount: number | string }[] }>(hyperion, `/v2/state/get_tokens?account=${account}`, undefined);
        return (r.tokens ?? [])
          .filter((t) => typeof t.precision === "number")
          .map((t) => ({ contract: t.contract, symbol: t.symbol, precision: t.precision!, amount: typeof t.amount === "number" ? t.amount.toFixed(t.precision!) : String(t.amount) }));
      } catch {
        return null;
      }
    },
    async send(packedTrx, signatures) {
      const transaction = { signatures, compression: 0, packed_context_free_data: "", packed_trx: packedTrx };
      try {
        const r = await post<{ transaction_id: string; processed?: Record<string, unknown> }>("/v1/chain/send_transaction2", { transaction, return_failure_trace: false, retry_trx: false });
        return r;
      } catch (e) {
        if (!(e instanceof Missing)) throw e;
      }
      return post<{ transaction_id: string; processed?: Record<string, unknown> }>("/v1/chain/push_transaction", transaction);
    },
  };
}

/** The chain's refusal in plain words, with the network's own way of getting CPU, NET and RAM. */
export function plainAntelopeError(e: AntelopeRpcError, spec: AntelopeNetSpec | null, networkName: string): Msg {
  const text = `${e.name} ${e.details.join(" ")}`;
  if (/tx_cpu_usage_exceeded|leeway_deadline|deadline_exception/.test(text) || /tx_net_usage_exceeded/.test(text)) {
    if (spec?.resources === "free") return msg("bg.antelope.err.cpuFree", { network: networkName });
    if (spec?.resources === "stake-or-powerup") return msg("bg.antelope.err.cpuStake", { network: networkName });
    return msg("bg.antelope.err.cpuPowerup", { network: networkName });
  }
  if (/ram_usage_exceeded/.test(text)) return msg("bg.antelope.err.ram", { network: networkName });
  if (/overdrawn balance|no balance object found|balance/.test(text)) return msg("bg.antelope.err.balance");
  if (/expired_tx|tx_exp|expiration/.test(text)) return msg("bg.antelope.err.expired");
  if (/unsatisfied_authorization|missing_auth|irrelevant_auth/.test(text)) return msg("bg.antelope.err.auth");
  if (/to account does not exist|account_query|unknown account/i.test(text)) return msg("bg.antelope.err.noRecipient");
  if (/tx_duplicate/.test(text)) return msg("bg.antelope.err.duplicate");
  return msg("bg.antelope.err.rejected", { network: networkName });
}
