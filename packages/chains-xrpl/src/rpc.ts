import { type ChainContext, ClipError } from "@clip-wallet/core";

/**
 * rippled JSON-RPC over `ctx.fetch` (https://xrpl.org/docs/references/http-websocket-apis): POST { method,
 * params: [ { … } ] } to each of the network's public servers in turn. A server that can't be reached or answers
 * "slowDown"/"tooBusy"/"noNetwork" is skipped; an answer with `status: "error"` is the ledger's answer and is thrown
 * as an XrplRpcError (its `error` code, e.g. "actNotFound").
 */
export class XrplRpcError extends Error {
  constructor(
    public readonly error: string,
    message?: string,
  ) {
    super(message || error);
    this.name = "XrplRpcError";
  }
}

const RETRY_ERRORS = new Set(["slowDown", "tooBusy", "noNetwork", "noCurrent", "noClosed", "amendmentBlocked", "notSynced", "highFee"]);

export interface AccountRoot {
  Account: string;
  Balance: string;
  Flags: number;
  OwnerCount: number;
  Sequence: number;
  RegularKey?: string;
}

export interface Reserves {
  /** Drops. */
  base: bigint;
  /** Drops per owned object. */
  inc: bigint;
  /** Validated ledger index. */
  ledger: number;
}

export interface TrustLine {
  account: string;
  balance: string;
  currency: string;
  limit: string;
}

export interface Rpc {
  call<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** null when the account doesn't exist (never funded, or deleted). */
  accountInfo(address: string): Promise<AccountRoot | null>;
  reserves(): Promise<Reserves>;
  /** Fee to get into the open ledger now, in drops (the `fee` command). */
  fee(): Promise<{ openLedger: bigint; base: bigint; ledger: number }>;
  lines(address: string, peer?: string): Promise<TrustLine[]>;
}

const xrpToDrops = (x: unknown): bigint => {
  const s = typeof x === "number" ? String(x) : typeof x === "string" ? x : "";
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return 0n;
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
};

const big = (x: unknown): bigint => (typeof x === "string" && /^\d+$/.test(x) ? BigInt(x) : typeof x === "number" && Number.isInteger(x) ? BigInt(x) : 0n);

export function rpcFor(ctx: ChainContext): Rpc {
  const urls = ctx.network.rpcUrls;

  async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    let last: unknown;
    for (const url of urls) {
      let body: { result?: Record<string, unknown> };
      try {
        const res = await ctx.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params: [params] }) });
        if (!res.ok) {
          last = new Error(`HTTP ${res.status}`);
          continue;
        }
        body = (await res.json()) as typeof body;
      } catch (e) {
        last = e;
        continue;
      }
      const r = body.result;
      if (!r || typeof r !== "object") {
        last = new Error("bad answer");
        continue;
      }
      if (r.status === "error") {
        const code = String(r.error ?? "unknown");
        if (RETRY_ERRORS.has(code)) {
          last = new XrplRpcError(code);
          continue;
        }
        throw new XrplRpcError(code, typeof r.error_message === "string" ? r.error_message : undefined);
      }
      return r as T;
    }
    throw new ClipError("Couldn't reach the XRP Ledger. Check your connection and try again.", "xrpl/offline", last);
  }

  return {
    call,
    async accountInfo(address) {
      try {
        const r = await call<{ account_data: AccountRoot }>("account_info", { account: address, ledger_index: "current" });
        return r.account_data;
      } catch (e) {
        if (e instanceof XrplRpcError && e.error === "actNotFound") return null;
        throw e;
      }
    },
    async reserves() {
      const r = await call<{ info: { validated_ledger?: { reserve_base_xrp?: unknown; reserve_inc_xrp?: unknown; seq?: number } } }>("server_info");
      const v = r.info.validated_ledger;
      if (!v) throw new ClipError("The XRP Ledger server isn't in sync right now. Try again in a minute.", "xrpl/unavailable");
      return { base: xrpToDrops(v.reserve_base_xrp), inc: xrpToDrops(v.reserve_inc_xrp), ledger: Number(v.seq ?? 0) };
    },
    async fee() {
      const r = await call<{ drops: { open_ledger_fee?: string; base_fee?: string; minimum_fee?: string }; ledger_current_index?: number }>("fee");
      const base = big(r.drops.base_fee) || 10n;
      return { openLedger: big(r.drops.open_ledger_fee) || base, base, ledger: Number(r.ledger_current_index ?? 0) };
    },
    async lines(address, peer) {
      const out: TrustLine[] = [];
      let marker: unknown;
      for (let page = 0; page < 10; page++) {
        try {
          const r = await call<{ lines: TrustLine[]; marker?: unknown }>("account_lines", {
            account: address,
            ledger_index: "validated",
            limit: 400,
            ...(peer ? { peer } : {}),
            ...(marker ? { marker } : {}),
          });
          out.push(...r.lines);
          marker = r.marker;
        } catch (e) {
          if (e instanceof XrplRpcError && e.error === "actNotFound") return out;
          throw e;
        }
        if (!marker) break;
      }
      return out;
    },
  };
}

/** Engine results in plain words (https://xrpl.org/docs/references/protocol/transactions/transaction-results). */
export function plainXrplError(code: string, reserve?: string): string {
  switch (code) {
    case "tecNO_DST":
    case "tecNO_DST_INSUF_XRP":
      return `The recipient's XRP Ledger account doesn't exist yet. Send at least ${reserve ?? "the base reserve"} XRP to open it.`;
    case "tecUNFUNDED_PAYMENT":
    case "tecUNFUNDED":
    case "tecUNFUNDED_OFFER":
    case "terINSUF_FEE_B":
      return "You don't have enough for this. Part of your XRP has to stay in your account as a reserve.";
    case "tecINSUFFICIENT_RESERVE":
    case "tecINSUF_RESERVE_LINE":
    case "tecINSUF_RESERVE_OFFER":
      return "Your account needs more XRP in reserve for this. Each token, offer or NFT page locks a little XRP.";
    case "tecDST_TAG_NEEDED":
      return "The recipient needs a destination tag. Ask them for it (or for an X-address) and try again.";
    case "tecPATH_DRY":
    case "tecPATH_PARTIAL":
    case "tecNO_LINE":
    case "tecNO_LINE_INSUF_RESERVE":
      return "The recipient can't receive this token: they haven't added it to their account (no trust line), or there's no way to deliver it.";
    case "tecNO_PERMISSION":
    case "tecNO_AUTH":
      return "The recipient doesn't accept this from you (deposit authorization or token authorization is on).";
    case "tecFROZEN":
      return "This token is frozen by its issuer, so it can't move right now.";
    case "tecHAS_OBLIGATIONS":
    case "tecTOO_SOON":
      return "This account can't be closed yet: it still owns objects, or it was used too recently.";
    case "tefPAST_SEQ":
    case "tefMAX_LEDGER":
    case "tefALREADY":
      return "This transaction is out of date or was already sent. Check Activity before you try again.";
    case "telINSUF_FEE_P":
    case "terQUEUED":
      return "The XRP Ledger is busy right now. Try again in a minute.";
    case "temREDUNDANT":
      return "This transaction doesn't change anything (for example, sending XRP to yourself).";
    case "temBAD_FEE":
    case "temBAD_AMOUNT":
    case "temBAD_CURRENCY":
    case "temDST_IS_SRC":
      return "The XRP Ledger says this transaction is malformed. Nothing was sent.";
    case "tefBAD_AUTH":
    case "tefBAD_AUTH_MASTER":
    case "tefMASTER_DISABLED":
      return "This account is controlled by another key, so Clip Wallet's signature isn't accepted.";
    default:
      return `The XRP Ledger rejected this (${code}). Nothing was sent.`;
  }
}
