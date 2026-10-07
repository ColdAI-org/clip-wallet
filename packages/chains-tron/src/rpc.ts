import { type ChainContext, ClipError } from "@clip-wallet/core";
import { big, fromHex, hex } from "./util.js";
import type { RefBlock } from "./tx.js";

/**
 * java-tron full-node HTTP API (https://developers.tron.network/reference/full-node-api-overview), called with plain
 * `ctx.fetch` over the network's endpoints in order (the next one is tried when one can't be reached or is busy).
 * Addresses go out as base58 with `visible: true`.
 */

export interface TronAccount {
  address?: string;
  balance?: number;
  type?: string;
  create_time?: number;
  owner_permission?: TronPermission;
  active_permission?: TronPermission[];
  frozenV2?: { type?: string; amount?: number }[];
  unfrozenV2?: { type?: string; unfreeze_amount?: number; unfreeze_expire_time?: number }[];
  delegated_frozenV2_balance_for_bandwidth?: number;
  account_resource?: { delegated_frozenV2_balance_for_energy?: number };
}

export interface TronPermission {
  type?: string;
  id?: number;
  permission_name?: string;
  threshold?: number;
  operations?: string;
  keys?: { address: string; weight: number }[];
}

export interface TronResources {
  freeNetUsed?: number;
  freeNetLimit?: number;
  NetUsed?: number;
  NetLimit?: number;
  EnergyUsed?: number;
  EnergyLimit?: number;
}

export interface ConstantResult {
  result?: { result?: boolean; code?: string; message?: string };
  constant_result?: string[];
  energy_used?: number;
  energy_penalty?: number;
}

export class TronRpcError extends Error {}

/** Messages java-tron returns hex-encoded (broadcast, contract results). */
export function nodeMessage(m: unknown): string {
  if (typeof m !== "string") return "";
  if (/^([0-9a-f]{2})+$/i.test(m)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(fromHex(m));
    } catch {
      return m;
    }
  }
  return m;
}

export class TronRpc {
  constructor(
    private readonly urls: string[],
    private readonly f: typeof fetch,
  ) {}

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    let last: unknown;
    for (const base of this.urls) {
      try {
        const res = await this.f(`${base.replace(/\/$/, "")}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          // TronGrid answers keyless requests over its limit with 403/429; try the next endpoint.
          last = new TronRpcError(`HTTP ${res.status}`);
          continue;
        }
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      } catch (e) {
        last = e;
      }
    }
    throw new ClipError("Couldn't reach the TRON network. Check your connection and try again.", "tron/offline", last);
  }

  async nowBlock(): Promise<RefBlock> {
    const b = await this.post<{ blockID?: string; block_header?: { raw_data?: { number?: number; timestamp?: number } } }>("/wallet/getnowblock");
    if (!b.blockID || !/^[0-9a-f]{64}$/i.test(b.blockID)) throw new ClipError("The TRON network didn't answer properly. Try again.", "tron/offline");
    return { number: big(b.block_header?.raw_data?.number), blockId: b.blockID, timestamp: big(b.block_header?.raw_data?.timestamp) };
  }

  async blockId(num: bigint): Promise<string | null> {
    const b = await this.post<{ blockID?: string }>("/wallet/getblockbynum", { num: Number(num) });
    return b.blockID && /^[0-9a-f]{64}$/i.test(b.blockID) ? b.blockID.toLowerCase() : null;
  }

  /** `{}` (no `address`) for an account that isn't on chain yet. */
  account(address: string): Promise<TronAccount> {
    return this.post<TronAccount>("/wallet/getaccount", { address, visible: true });
  }

  resources(address: string): Promise<TronResources> {
    return this.post<TronResources>("/wallet/getaccountresource", { address, visible: true });
  }

  async chainParameters(): Promise<Map<string, bigint>> {
    const r = await this.post<{ chainParameter?: { key: string; value?: number }[] }>("/wallet/getchainparameters");
    return new Map((r.chainParameter ?? []).map((p) => [p.key, big(p.value)]));
  }

  /** Runs a contract call without sending it (no fee, no signature). */
  triggerConstant(owner: string, contract: string, data: Uint8Array, callValue = 0n): Promise<ConstantResult> {
    return this.post<ConstantResult>("/wallet/triggerconstantcontract", {
      owner_address: owner,
      contract_address: contract,
      data: hex(data),
      ...(callValue ? { call_value: Number(callValue) } : {}),
      visible: true,
    });
  }

  /** Energy the call needs (null where the node doesn't offer /wallet/estimateenergy, or the call reverts). */
  async estimateEnergy(owner: string, contract: string, data: Uint8Array, callValue = 0n): Promise<bigint | null> {
    const r = await this.post<{ result?: { result?: boolean }; energy_required?: number }>("/wallet/estimateenergy", {
      owner_address: owner,
      contract_address: contract,
      data: hex(data),
      ...(callValue ? { call_value: Number(callValue) } : {}),
      visible: true,
    }).catch(() => null);
    return r?.result?.result && typeof r.energy_required === "number" ? BigInt(r.energy_required) : null;
  }

  broadcastHex(signedHex: string): Promise<{ result?: boolean; txid?: string; code?: string; message?: string }> {
    return this.post("/wallet/broadcasthex", { transaction: signedHex });
  }

  /** Solidified transaction info ({} until the transaction is in a solidified block). */
  async txInfo(txId: string): Promise<{ id?: string; blockNumber?: number; receipt?: { result?: string }; result?: string; resMessage?: string }> {
    return this.post("/walletsolidity/gettransactioninfobyid", { value: txId });
  }
}

export const rpcFor = (ctx: ChainContext) => new TronRpc(ctx.network.rpcUrls, ctx.fetch);

/**
 * Broadcast errors in plain words (java-tron `Return.response_code` plus its message). Hints carry what the module
 * knows that the node doesn't say.
 */
export function plainTronError(code: string | undefined, message: string): string {
  const m = message.toLowerCase();
  if (code === "SIGERROR" || m.includes("validate signature error")) return "The network didn't accept the signature. Nothing was sent.";
  if (code === "BANDWITH_ERROR" || m.includes("account resource insufficient")) return "You need a little TRX to pay for this transaction's bandwidth. Nothing was sent.";
  if (code === "TAPOS_ERROR" || m.includes("tapos")) return "This transaction was made for a different TRON network, or too long ago. Nothing was sent.";
  if (code === "TRANSACTION_EXPIRATION_ERROR" || m.includes("expired")) return "This transaction expired before it was sent. Try again.";
  if (code === "DUP_TRANSACTION_ERROR" || m.includes("dup transaction")) return "This transaction was already sent.";
  if (m.includes("balance is not sufficient") || m.includes("balance is not enough") || m.includes("not enough balance")) return "You don't have enough TRX for this, including the network fee. Nothing was sent.";
  if (m.includes("cannot transfer trx to yourself")) return "That's your own address.";
  if (m.includes("smart contract")) return "TRX can't be sent straight to a smart contract. Nothing was sent.";
  if (m.includes("does not exist") || m.includes("not exists")) return "Your TRON account isn't open yet. Receive some TRX first.";
  if (m.includes("permission")) return "This account's permissions don't let this key sign that. Nothing was sent.";
  if (code === "SERVER_BUSY" || code === "NOT_ENOUGH_EFFECTIVE_CONNECTION") return "The TRON network is busy. Wait a minute and try again.";
  return "The TRON network rejected this. Nothing was sent.";
}
