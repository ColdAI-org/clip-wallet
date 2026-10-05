import { ClipError } from "@clip-wallet/core";

/** The fields of Horizon's `GET /accounts/{id}` this module reads. */
export interface HorizonBalance {
  balance: string;
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares" | string;
  asset_code?: string;
  asset_issuer?: string;
  limit?: string;
  selling_liabilities?: string;
  buying_liabilities?: string;
  is_authorized?: boolean;
}

export interface HorizonAccount {
  id: string;
  sequence: string;
  subentry_count: number;
  num_sponsoring?: number;
  num_sponsored?: number;
  balances: HorizonBalance[];
  signers: { key: string; weight: number; type: string }[];
  thresholds?: { low_threshold: number; med_threshold: number; high_threshold: number };
  /** Data entries, values base64. */
  data: Record<string, string>;
}

export interface FeeStats {
  last_ledger_base_fee: string;
  fee_charged: Record<string, string>;
}

export class HorizonError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { title?: string; detail?: string; extras?: { result_codes?: { transaction?: string; operations?: string[] } } },
  ) {
    super(`Horizon ${status}: ${body.title ?? ""}`);
  }
}

/** Backoff before each retry of a read (Horizon has short blips: dropped connections, 502/503/504, 429). */
export const HORIZON_READ_RETRY_MS = [400, 1200];

export class Horizon {
  constructor(
    readonly url: string,
    private readonly f: typeof fetch,
    /** Delays before retrying a failed read; reads only (a submit is never retried here). */
    private readonly retryMs: readonly number[] = HORIZON_READ_RETRY_MS,
  ) {}

  private async get<T>(path: string): Promise<T | null> {
    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= this.retryMs.length;
      try {
        res = await this.f(`${this.url.replace(/\/$/, "")}${path}`, { headers: { accept: "application/json" } });
        if (last || !(res.status === 429 || res.status >= 500)) break;
      } catch (cause) {
        if (last) throw new ClipError("Couldn't reach the Stellar network. Check your connection and try again.", "stellar/offline", cause);
      }
      await new Promise((r) => setTimeout(r, this.retryMs[attempt]));
    }
    if (res.status === 404) return null;
    const body = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new HorizonError(res.status, body as HorizonError["body"]);
    return body;
  }

  /** null when the account doesn't exist yet (never funded). */
  account(id: string): Promise<HorizonAccount | null> {
    return this.get<HorizonAccount>(`/accounts/${encodeURIComponent(id)}`);
  }

  async feeStats(): Promise<FeeStats | null> {
    return this.get<FeeStats>("/fee_stats").catch(() => null);
  }

  /** Base reserve in stroops from the latest ledger (0.5 XLM at the time of writing). */
  async baseReserve(): Promise<bigint> {
    const r = await this.get<{ _embedded?: { records?: { base_reserve_in_stroops?: number }[] } }>("/ledgers?order=desc&limit=1").catch(() => null);
    const v = r?._embedded?.records?.[0]?.base_reserve_in_stroops;
    return typeof v === "number" ? BigInt(v) : 5_000_000n;
  }

  /** POST /transactions. Resolves with the hash on success; null on a gateway timeout (still pending). */
  async submit(envelopeXdr: string): Promise<{ hash: string } | null> {
    let res: Response;
    try {
      res = await this.f(`${this.url.replace(/\/$/, "")}/transactions`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: `tx=${encodeURIComponent(envelopeXdr)}`,
      });
    } catch (cause) {
      throw new ClipError("Couldn't reach the Stellar network. Nothing was sent. Try again.", "stellar/offline", cause);
    }
    if (res.status === 504) return null;
    const body = (await res.json().catch(() => ({}))) as { hash?: string; successful?: boolean } & HorizonError["body"];
    if (!res.ok || !body.hash) {
      const codes = body.extras?.result_codes;
      throw new ClipError(plainStellarError(codes?.transaction, codes?.operations), "stellar/submit-failed", new HorizonError(res.status, body));
    }
    return { hash: body.hash };
  }
}

/** Horizon result codes → plain words. https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes */
const TX_CODES: Record<string, string> = {
  tx_bad_seq: "Another transaction from your account went through first. Try again.",
  tx_insufficient_balance: "You don't have enough XLM left for the fee. Your account must keep a small minimum balance.",
  tx_insufficient_fee: "The network is busy and the fee was too low. Try again in a moment.",
  tx_too_late: "This transaction expired before it was sent. Try again.",
  tx_too_early: "This transaction isn't valid yet. Try again later.",
  tx_bad_auth: "This transaction is missing a signature it needs. Nothing was sent.",
  tx_bad_auth_extra: "This transaction has a signature it doesn't need. Nothing was sent.",
  tx_no_account: "Your Stellar account isn't open yet. Receive at least 1 XLM to open it.",
  tx_bad_sponsorship: "This transaction's reserve sponsorship isn't set up correctly. Nothing was sent.",
  tx_bad_min_seq_age_or_gap: "This transaction isn't valid yet. Try again later.",
  tx_malformed: "This transaction isn't put together correctly. Nothing was sent.",
  tx_soroban_invalid: "This smart contract transaction isn't put together correctly. Ask the app to rebuild it.",
  tx_internal_error: "Stellar had a problem processing this. Try again.",
};

const OP_CODES: Record<string, string> = {
  op_underfunded: "You don't have enough of that asset for this. Your account must also keep a small XLM minimum.",
  op_no_trust: "They need to add this asset to their Stellar account before they can receive it.",
  op_src_no_trust: "You haven't added this asset to your account.",
  op_no_destination: "That Stellar account isn't open yet. Send at least 1 XLM to open it.",
  op_low_reserve: "This needs more XLM set aside than you have free. Each added asset or offer locks 0.5 XLM.",
  op_line_full: "They can't hold that much of this asset.",
  op_not_authorized: "The issuer of this asset hasn't approved this account to hold it.",
  op_src_not_authorized: "The issuer of this asset hasn't approved your account to send it.",
  op_no_issuer: "The issuer of this asset doesn't exist.",
  op_already_exists: "That Stellar account is already open. Send it a normal payment instead.",
  op_too_many_subentries: "Your account has too many assets and offers. Remove some first.",
  op_has_sub_entries: "Remove your added assets and offers before closing this account.",
  op_invalid_limit: "Send or sell all of this asset before removing it.",
  op_under_dest_min: "The price moved and you'd get less than the minimum. Try again.",
  op_over_source_max: "The price moved and it would cost more than the maximum. Try again.",
  op_too_few_offers: "There isn't enough trading on this pair right now. Try a smaller amount.",
  op_cross_self: "This would trade against one of your own offers.",
  op_malformed: "Part of this transaction isn't put together correctly. Nothing was sent.",
  op_bad_auth: "This transaction is missing a signature it needs. Nothing was sent.",
  op_no_account: "One of the accounts in this transaction doesn't exist.",
  op_not_supported: "Stellar doesn't support this action right now.",
  op_line_full_or_low_reserve: "They can't receive this right now.",
};

export function plainStellarError(tx?: string, ops?: string[]): string {
  const code = tx ? snake(tx) : "";
  if (code === "tx_failed" || code === "tx_fee_bump_inner_failed") {
    for (const op of ops ?? []) {
      const m = OP_CODES[snake(op)];
      if (m) return m;
    }
    return "Stellar rejected this transaction. Nothing was sent.";
  }
  return TX_CODES[code] ?? "Stellar rejected this transaction. Nothing was sent.";
}

/** XDR enum names ("txBadSeq") → Horizon codes ("tx_bad_seq"). */
function snake(code: string): string {
  return code.includes("_") ? code : code.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
