import { ClipError, msg } from "@clip-wallet/core";
import { hex } from "./util.js";

/**
 * Hiro's public Stacks API (no key): the node RPC (/v2/*) and the indexer (/extended/*).
 * https://docs.hiro.so/stacks/api — every call here was checked with curl against api.hiro.so and
 * api.testnet.hiro.so (2026-10). Errors become plain-words ClipErrors with a "stacks/" code.
 */
export class HiroError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface AccountInfo {
  /** µSTX, hex-encoded u128 in /v2/accounts. */
  balance: bigint;
  locked: bigint;
  nonce: bigint;
}

export interface FtBalance {
  balance: string;
}

export interface BalancesV1 {
  stx: { balance: string; locked: string; estimated_balance?: string; pending_balance_inbound?: string; pending_balance_outbound?: string };
  fungible_tokens?: Record<string, FtBalance>;
}

export interface TxStatus {
  tx_status: "pending" | "success" | "abort_by_response" | "abort_by_post_condition" | "dropped_replace_by_fee" | "dropped_replace_across_fork" | "dropped_too_expensive" | "dropped_stale_garbage_collect" | string;
  tx_result?: { repr?: string };
}

export interface FtMetadata {
  name?: string;
  symbol?: string;
  decimals?: number;
}

const bigOf = (v: unknown): bigint => {
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(v)) return BigInt(v);
  return 0n;
};

export class Hiro {
  constructor(
    readonly base: string,
    readonly fetchImpl: typeof fetch,
  ) {}

  async #req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base.replace(/\/$/, "")}${path}`, init);
    } catch (e) {
      throw new ClipError(msg("bg.err.couldntReach", { what: "Stacks" }), "stacks/offline", e);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* plain text */
    }
    if (!res.ok) throw new HiroError(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : text.slice(0, 200), res.status, body);
    return body as T;
  }

  get<T>(path: string): Promise<T> {
    return this.#req<T>(path);
  }

  async account(address: string): Promise<AccountInfo> {
    const r = await this.#req<{ balance?: string; locked?: string; nonce?: number }>(`/v2/accounts/${address}?proof=0`);
    return { balance: bigOf(r.balance), locked: bigOf(r.locked), nonce: bigOf(r.nonce) };
  }

  /** Next nonce: the indexer's `possible_next_nonce` (counts the mempool), else the node's account nonce. */
  async nextNonce(address: string): Promise<bigint> {
    try {
      const r = await this.#req<{ possible_next_nonce?: number }>(`/extended/v1/address/${address}/nonces`);
      if (typeof r.possible_next_nonce === "number") return BigInt(r.possible_next_nonce);
    } catch {
      /* fall back to the node */
    }
    return (await this.account(address)).nonce;
  }

  balances(address: string): Promise<BalancesV1> {
    return this.#req<BalancesV1>(`/extended/v1/address/${address}/balances`);
  }

  async ftMetadata(contract: string): Promise<FtMetadata | null> {
    try {
      return await this.#req<FtMetadata>(`/metadata/v1/ft/${contract}`);
    } catch {
      return null;
    }
  }

  /**
   * Fee for a payload: POST /v2/fees/transaction (the middle of the three estimates), else the per-byte rate of
   * GET /v2/fees/transfer × the transaction length. Never below 1 µSTX per byte.
   */
  async fee(payload: Uint8Array, txLength: number): Promise<bigint> {
    const floor = BigInt(Math.max(txLength, 180));
    try {
      const r = await this.#req<{ estimations?: { fee?: number }[] }>("/v2/fees/transaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction_payload: hex(payload), estimated_len: txLength }),
      });
      const e = r.estimations ?? [];
      const mid = e[1]?.fee ?? e[0]?.fee;
      if (typeof mid === "number" && Number.isFinite(mid) && mid > 0) {
        const fee = BigInt(Math.ceil(mid));
        return fee > floor ? fee : floor;
      }
    } catch {
      /* fall back */
    }
    try {
      const rate = await this.#req<number>("/v2/fees/transfer");
      if (typeof rate === "number" && rate > 0) {
        const fee = BigInt(Math.ceil(rate * txLength));
        return fee > floor ? fee : floor;
      }
    } catch {
      /* fall back */
    }
    return floor;
  }

  /** POST /v2/transactions (raw bytes) → txid (hex, no 0x). */
  async broadcast(raw: Uint8Array): Promise<string> {
    const r = await this.#req<unknown>("/v2/transactions", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: raw as unknown as BodyInit,
    });
    if (typeof r === "string" && /^(0x)?[0-9a-f]{64}$/i.test(r.trim())) return r.trim().replace(/^0x/i, "");
    throw new HiroError("unexpected broadcast reply", 200, r);
  }

  tx(txid: string): Promise<TxStatus> {
    return this.#req<TxStatus>(`/extended/v1/tx/0x${txid.replace(/^0x/i, "")}`);
  }
}

/**
 * The node's rejection reasons (stacks-core `MemPoolRejection`, the `reason` field of a 400 from /v2/transactions)
 * in plain words. Never shows the raw error.
 */
export function plainStacksError(e: unknown): ClipError {
  if (e instanceof ClipError) return e;
  const body = e instanceof HiroError && e.body && typeof e.body === "object" ? (e.body as { reason?: string; error?: string }) : {};
  const reason = body.reason ?? "";
  switch (reason) {
    case "NotEnoughFunds":
    case "FeeTooLow":
      return reason === "FeeTooLow"
        ? new ClipError("The network fee was too low, so the network didn't take it. Nothing was sent. Try again.", "stacks/fee-too-low", e)
        : new ClipError(msg("bg.err.notEnoughForFee", { symbol: "STX" }), "stacks/insufficient-funds", e);
    case "BadNonce":
    case "ConflictingNonceInMempool":
      return new ClipError("Another transaction from this account is still waiting. Wait for it to finish, then try again.", "stacks/nonce-busy", e);
    case "BadAddressVersionByte":
    case "BadTransactionVersion":
      return new ClipError("This transaction is for a different Stacks network, so it wasn't sent.", "stacks/network-mismatch", e);
    case "NoSuchContract":
    case "NoSuchPublicFunction":
    case "BadFunctionArgument":
    case "ContractAlreadyExists":
      return new ClipError("The app's contract call doesn't match the contract on the network. Nothing was sent.", "stacks/bad-contract-call", e);
    case "TransferRecipientIsSender":
      return new ClipError("That's your own address.", "stacks/self-transfer", e);
    case "TooMuchChaining":
      return new ClipError("This account has too many transactions waiting. Wait for some to finish, then try again.", "stacks/too-many-pending", e);
    case "SignatureValidation":
      return new ClipError("The network didn't accept the signature. Nothing was sent.", "stacks/bad-signature", e);
    default:
      if (e instanceof HiroError && e.status >= 500) return new ClipError(msg("bg.err.isBusy", { what: "Stacks" }), "stacks/busy", e);
      return new ClipError("The network rejected this. Nothing was sent.", "stacks/rejected", e);
  }
}
