/**
 * Koios REST client (https://api.koios.rest, OpenAPI koiosapi.yaml). Public tier: no API key.
 * Only the endpoints the module needs; responses are validated loosely and turned into plain errors.
 */
import { ClipError } from "@clip-wallet/core";
import { hex } from "./util.js";

export interface KoiosAsset {
  policy_id: string;
  asset_name: string | null;
  fingerprint?: string;
  decimals?: number | null;
  quantity: string;
}

export interface KoiosUtxo {
  tx_hash: string;
  tx_index: number;
  address: string;
  value: string;
  stake_address?: string | null;
  payment_cred?: string | null;
  datum_hash?: string | null;
  inline_datum?: { bytes: string } | null;
  reference_script?: { bytes?: string } | null;
  asset_list?: KoiosAsset[] | null;
  is_spent?: boolean;
}

export interface KoiosAccount {
  stake_address: string;
  status: "registered" | "not registered";
  delegated_pool: string | null;
  delegated_drep?: string | null;
  total_balance: string;
  rewards_available: string;
  deposit?: string;
}

export interface KoiosAssetInfo {
  policy_id: string;
  asset_name: string | null;
  asset_name_ascii?: string;
  fingerprint?: string;
  total_supply?: string;
  minting_tx_metadata?: Record<string, unknown> | null;
  token_registry_metadata?: { name?: string | null; ticker?: string | null; decimals?: number | null; logo?: string | null } | null;
  cip68_metadata?: Record<string, unknown> | null;
}

export interface KoiosPool {
  pool_id_bech32: string;
  meta_json?: { name?: string; ticker?: string } | null;
  pool_status?: string;
  /** Fraction (0.05 = 5 %). */
  margin?: number | null;
  /** Lovelace. */
  fixed_cost?: string | null;
  pledge?: string | null;
  live_pledge?: string | null;
  live_stake?: string | null;
  active_stake?: string | null;
  /** Percent of the saturation point (70.74 = 70.74 %). */
  live_saturation?: number | null;
  retiring_epoch?: number | null;
  block_count?: number | null;
}

/** GET /pool_list row (select=pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch). */
export interface KoiosPoolListItem {
  pool_id_bech32: string;
  ticker: string | null;
  margin: number | null;
  fixed_cost: string | null;
  pledge: string | null;
  active_stake: string | null;
  retiring_epoch: number | null;
}

/** GET /epoch_info row (select=epoch_no,active_stake,total_rewards,start_time,end_time). */
export interface KoiosEpochRewards {
  epoch_no: number;
  active_stake: string | null;
  total_rewards: string | null;
  start_time: number;
  end_time: number;
}

/** The protocol parameters the builder needs (cli_protocol_params names). */
export interface ProtocolParams {
  txFeePerByte: number;
  txFeeFixed: number;
  utxoCostPerByte: number;
  stakeAddressDeposit: number;
  maxTxSize: number;
  maxValueSize?: number;
  collateralPercentage?: number;
}

export class Koios {
  constructor(
    private readonly base: string,
    private readonly f: typeof fetch,
  ) {}

  private async req<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new ClipError("Clip Wallet couldn't reach Cardano. Check your connection and try again.", "cardano/offline", cause);
    }
    if (res.status === 429) throw new ClipError("Cardano is busy right now. Try again in a minute.", "cardano/rate-limited");
    if (!res.ok) throw new ClipError("Cardano didn't answer as expected. Try again shortly.", "cardano/indexer-error", await res.text().catch(() => ""));
    return (await res.json()) as T;
  }

  tip(): Promise<{ abs_slot: number; epoch_no: number; block_height?: number }[]> {
    return this.req("/tip");
  }

  async params(): Promise<ProtocolParams> {
    const p = await this.req<ProtocolParams>("/cli_protocol_params");
    if (typeof p.txFeePerByte !== "number" || typeof p.utxoCostPerByte !== "number") {
      throw new ClipError("Cardano's fee settings couldn't be read. Try again shortly.", "cardano/params");
    }
    return p;
  }

  addressUtxos(addresses: string[]): Promise<KoiosUtxo[]> {
    return this.req("/address_utxos", { _addresses: addresses, _extended: true });
  }

  utxoInfo(refs: string[]): Promise<KoiosUtxo[]> {
    return refs.length ? this.req("/utxo_info", { _utxo_refs: refs, _extended: true }) : Promise.resolve([]);
  }

  accountInfo(stakeAddresses: string[]): Promise<KoiosAccount[]> {
    return this.req("/account_info", { _stake_addresses: stakeAddresses });
  }

  assetInfo(list: [string, string][]): Promise<KoiosAssetInfo[]> {
    return list.length ? this.req("/asset_info", { _asset_list: list }) : Promise.resolve([]);
  }

  poolInfo(ids: string[]): Promise<KoiosPool[]> {
    return ids.length ? this.req("/pool_info", { _pool_bech32_ids: ids }) : Promise.resolve([]);
  }

  /**
   * Registered pools with a ticker and a margin at or below `maxMargin` (PostgREST filters on GET /pool_list;
   * Koios returns at most 1,000 rows per call).
   */
  poolList(maxMargin = 0.1): Promise<KoiosPoolListItem[]> {
    const q = `pool_status=eq.registered&ticker=not.is.null&margin=lte.${maxMargin}&select=pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch&limit=1000`;
    return this.req(`/pool_list?${q}`);
  }

  /** The latest epochs whose rewards are known (GET /epoch_info, newest first). */
  epochRewards(limit = 1): Promise<KoiosEpochRewards[]> {
    return this.req(`/epoch_info?select=epoch_no,active_stake,total_rewards,start_time,end_time&order=epoch_no.desc&total_rewards=not.is.null&limit=${limit}`);
  }

  /** POST /submittx with the raw CBOR. Returns the transaction id. */
  async submit(tx: Uint8Array): Promise<string> {
    let res: Response;
    try {
      res = await this.f(`${this.base}/submittx`, { method: "POST", headers: { "content-type": "application/cbor" }, body: tx as BodyInit });
    } catch (cause) {
      throw new ClipError("Clip Wallet couldn't reach Cardano. Nothing was sent.", "cardano/offline", cause);
    }
    const text = await res.text();
    if (!res.ok) throw new ClipError(plainSubmitError(text), "cardano/send-failed", text);
    try {
      const v = JSON.parse(text) as unknown;
      if (typeof v === "string" && /^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
    } catch {
      /* fall through */
    }
    if (/^"?[0-9a-f]{64}"?$/i.test(text.trim())) return text.trim().replace(/"/g, "").toLowerCase();
    throw new ClipError("Cardano didn't confirm the transaction. Check your activity before trying again.", "cardano/send-unknown", text);
  }
}

/** Ledger rejection text → plain words. */
export function plainSubmitError(text: string): string {
  if (/BadInputsUTxO|ValueNotConservedUTxO.*BadInputs/i.test(text)) return "Some of the coins this transaction spends were already spent. Refresh and try again.";
  if (/OutsideValidityIntervalUTxO|ExpiredUTxO/i.test(text)) return "This transaction expired before it was sent. Try again.";
  if (/FeeTooSmallUTxO/i.test(text)) return "The network fee was too low. Try again.";
  if (/OutputTooSmallUTxO|BabbageOutputTooSmallUTxO/i.test(text)) return "One of the amounts is below Cardano's minimum. Send a little more ADA.";
  if (/ValueNotConservedUTxO/i.test(text)) return "The amounts in this transaction don't add up. Nothing was sent.";
  if (/MissingVKeyWitnessesUTXOW|InvalidWitnessesUTXOW/i.test(text)) return "The transaction is missing a signature. Nothing was sent.";
  if (/ScriptFailure|PlutusFailure|ValidationTagMismatch/i.test(text)) return "The app's smart contract rejected this transaction. Nothing was sent.";
  return "Cardano rejected this transaction. Nothing was sent.";
}

export const utxoRef = (txHash: Uint8Array, index: number | bigint) => `${hex(txHash)}#${index}`;
