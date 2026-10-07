import { ClipError } from "@clip-wallet/core";
import type { PlainTransaction } from "./tx.js";
import type { TokenInfo } from "./networks.js";

/**
 * The MultiversX gateway (proxy, mx-chain-proxy-go) and API (mx-api-service) over plain fetch. Only read calls,
 * plus POST /transaction/send. Every failure becomes a ClipError in plain words.
 *   - gateway: GET /address/{a}, /address/{a}/esdt/{id}, /address/{a}/guardian-data, /network/config,
 *     /transaction/{hash}/process-status; POST /transaction/send
 *   - api: GET /accounts/{a}/tokens, /tokens/{id}, /providers/{a}
 */
export interface NetworkConfig {
  chainId: string;
  minGasPrice: bigint;
  minGasLimit: bigint;
  gasPerDataByte: bigint;
  /** e.g. 0.01: the share of the gas price charged for gas beyond moving the data. */
  gasPriceModifier: number;
}

export interface GatewayAccount {
  address: string;
  nonce: number;
  balance: string;
  username?: string;
}

export interface ApiToken extends TokenInfo {
  balance?: string;
  type?: string;
}

export interface ProcessStatus {
  status: "success" | "fail" | "pending" | "invalid" | string;
  reason?: string;
}

interface SimResult {
  status?: string;
  failReason?: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

const unreachable = (cause: unknown) => new ClipError("We couldn't reach the MultiversX network. Check your connection and try again.", "multiversx/offline", cause);

export class MultiversXClient {
  constructor(
    private readonly gateway: string,
    private readonly api: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async gw<T>(path: string, body?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await this.fetchImpl(`${this.gateway}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      throw unreachable(e);
    }
    const j = (await r.json().catch(() => null)) as { data?: T; error?: string; code?: string } | null;
    if (!r.ok || !j || (j.code && j.code !== "successful") || j.error) throw new GatewayError(j?.error || `HTTP ${r.status}`, r.status, j?.code);
    return j.data as T;
  }

  private async getApi<T>(path: string): Promise<T | null> {
    let r: Response;
    try {
      r = await this.fetchImpl(`${this.api}${path}`);
    } catch (e) {
      throw unreachable(e);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new GatewayError(`HTTP ${r.status}`, r.status);
    return (await r.json()) as T;
  }

  async networkConfig(): Promise<NetworkConfig> {
    const d = await this.gw<{ config: Record<string, unknown> }>("/network/config").catch((e) => {
      throw e instanceof ClipError ? e : unreachable(e);
    });
    const c = d.config;
    return {
      chainId: String(c.erd_chain_id),
      minGasPrice: BigInt(String(c.erd_min_gas_price)),
      minGasLimit: BigInt(String(c.erd_min_gas_limit)),
      gasPerDataByte: BigInt(String(c.erd_gas_per_data_byte)),
      gasPriceModifier: Number(c.erd_gas_price_modifier ?? 1),
    };
  }

  async account(address: string): Promise<GatewayAccount> {
    const d = await this.gw<{ account: GatewayAccount }>(`/address/${address}`).catch((e) => {
      throw e instanceof ClipError ? e : unreachable(e);
    });
    return d.account;
  }

  /** Fungible ESDT balance in base units ("0" when the account holds none). */
  async esdtBalance(address: string, identifier: string): Promise<bigint> {
    try {
      const d = await this.gw<{ tokenData?: { balance?: string } }>(`/address/${address}/esdt/${encodeURIComponent(identifier)}`);
      const b = d.tokenData?.balance ?? "0";
      return /^\d+$/.test(b) ? BigInt(b) : 0n;
    } catch (e) {
      if (e instanceof ClipError) throw e;
      return 0n;
    }
  }

  /** True when the account has an active guardian (every transaction then needs the guardian's co-signature). */
  async isGuarded(address: string): Promise<boolean> {
    const d = await this.gw<{ guardianData?: { guarded?: boolean } }>(`/address/${address}/guardian-data`).catch((e) => {
      throw e instanceof ClipError ? e : unreachable(e);
    });
    return d.guardianData?.guarded === true;
  }

  async send(tx: PlainTransaction): Promise<string> {
    const d = await this.gw<{ txHash: string }>("/transaction/send", tx);
    if (!d?.txHash || !/^[0-9a-f]{64}$/.test(d.txHash)) throw new GatewayError("no transaction hash", 200);
    return d.txHash;
  }

  /**
   * Dry run of an unsigned transaction (POST /transaction/simulate?checkSignature=false with a zero placeholder
   * signature, which the node accepts when signature checks are off). Returns null when the node can't simulate.
   */
  async simulate(tx: PlainTransaction): Promise<{ ok: boolean; reason?: string } | null> {
    try {
      const d = await this.gw<{ result?: SimResult & { senderShard?: SimResult; receiverShard?: SimResult } }>("/transaction/simulate?checkSignature=false", { ...tx, signature: "00".repeat(64) });
      const r = d?.result;
      if (!r) return null;
      const parts = [r, r.senderShard, r.receiverShard].filter((x): x is SimResult => !!x && typeof x.status === "string");
      if (!parts.length) return null;
      const failed = parts.find((x) => x.status === "fail" || x.status === "invalid");
      return failed ? { ok: false, ...(failed.failReason ? { reason: failed.failReason } : {}) } : { ok: true };
    } catch (e) {
      if (e instanceof ClipError) return null;
      return null;
    }
  }

  /**
   * process-status follows the whole transaction, including asynchronous calls between shards, so a call that fails
   * in a callback reports "fail" (GET /transaction/{hash}?withResults=true can still say "success" there).
   */
  async processStatus(hash: string): Promise<ProcessStatus | null> {
    try {
      return await this.gw<ProcessStatus>(`/transaction/${hash}/process-status`);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      return null;
    }
  }

  async tokens(address: string): Promise<ApiToken[]> {
    const r = await this.getApi<ApiToken[]>(`/accounts/${address}/tokens?size=100&fields=identifier,name,ticker,decimals,balance,assets,isVerified,type`);
    return Array.isArray(r) ? r : [];
  }

  async token(identifier: string): Promise<TokenInfo | null> {
    return this.getApi<TokenInfo>(`/tokens/${encodeURIComponent(identifier)}?fields=identifier,name,ticker,decimals,assets,isVerified`).catch(() => null);
  }

  /** Staking provider's identity (e.g. "truststaking"), or null. */
  async providerName(address: string): Promise<string | null> {
    const p = await this.getApi<{ identity?: string }>(`/providers/${address}?fields=identity`).catch(() => null);
    return p?.identity && /^[\w.-]{1,64}$/.test(p.identity) ? p.identity : null;
  }
}

/**
 * Gateway / node rejection messages → plain words. Sources: mx-chain-go process/errors.go and
 * mx-chain-proxy-go (e.g. "insufficient funds", "lowerNonceInTx", "invalid chain ID", "insufficient gas limit",
 * "too many transactions", guardian errors).
 */
export function plainMultiversXError(message: string): string {
  const m = message.toLowerCase();
  if (/insufficient (funds|balance)/.test(m)) return "You don't have enough EGLD for this and its network fee. Nothing was sent.";
  if (/lower ?nonce|nonce too low|lowernonceintx/.test(m)) return "This transaction was already used. Nothing new was sent. Try again from the start.";
  if (/higher ?nonce|nonce too high|veryhighnonceintx/.test(m)) return "Your earlier transactions haven't gone through yet. Wait a moment, then try again.";
  if (/chain ?id/.test(m)) return "This transaction is for a different MultiversX network. Nothing was sent.";
  if (/gas ?limit|not enough gas|insufficient gas/.test(m)) return "This transaction doesn't have enough gas to run. Nothing was sent.";
  if (/gas ?price/.test(m)) return "The network fee price is too low for MultiversX right now. Nothing was sent.";
  if (/guard/.test(m)) return "This account has a guardian, and the guardian's co-signature is missing. Nothing was sent.";
  if (/too many transactions|tx pool|pool is full|cache is full/.test(m)) return "MultiversX is busy right now. Nothing was sent. Try again in a minute.";
  if (/signature/.test(m)) return "The network didn't accept the signature. Nothing was sent.";
  return "The MultiversX network rejected this transaction. Nothing was sent.";
}
