import { type ChainContext, ClipError, type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import {
  LogicSigAccount,
  type SuggestedParams,
  type Transaction,
  assignGroupID,
  decodeUnsignedTransaction,
  encodeUint64,
  encodeUnsignedTransaction,
  isValidAddress,
  makeApplicationNoOpTxnFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
} from "algosdk";
import { AlgodError, algodFor } from "./algod.js";
import { MAX_GROUP } from "./txn.js";
import { b64decode, b64encode, big, randomId } from "./util.js";

/**
 * Wallet-built atomic groups for feature flows (swaps): the caller describes each transaction, this module adds
 * fresh suggested params, a 1000-round validity window and the group id, and returns an `algo_signAndPostTxn`
 * request (decoded, simulated and signed on the normal approval path). The sender is always this account.
 * No rekey-to and no close-to can be expressed here.
 */
export type GroupTxnSpec =
  | { type: "pay"; receiver: string; amount: bigint; note?: Uint8Array }
  | { type: "axfer"; receiver: string; amount: bigint; assetId: bigint; note?: Uint8Array }
  | {
      type: "appl";
      appId: bigint;
      args: Uint8Array[];
      accounts?: string[];
      foreignAssets?: bigint[];
      foreignApps?: bigint[];
      /** Covers inner transactions too: fee = feeMultiplier × min fee (default 1). */
      feeMultiplier?: number;
      note?: Uint8Array;
    };

const VALIDITY = 1000n;

/** Builds one atomic group from specs. Returns the request and the total network fee in microALGO. */
export async function buildGroup(specs: GroupTxnSpec[], ctx: ChainContext): Promise<{ request: DappRequest; fee: bigint; txns: Transaction[] }> {
  if (!specs.length || specs.length > MAX_GROUP) throw new Error(`group must have 1..${MAX_GROUP} transactions`);
  const me = ctx.account.address;
  const algod = algodFor(ctx);
  let p;
  try {
    p = await algod.params();
  } catch (cause) {
    throw new ClipError("Couldn't reach the Algorand network. Check your connection and try again.", "algorand/offline", cause);
  }
  const minFee = big(p["min-fee"]) || 1000n;
  const last = big(p["last-round"]);
  const base = (fee: bigint): SuggestedParams => ({
    fee,
    flatFee: true,
    minFee,
    firstValid: last,
    lastValid: last + VALIDITY,
    genesisHash: b64decode(p["genesis-hash"]),
    genesisID: p["genesis-id"],
  });
  let total = 0n;
  const txns = specs.map((s): Transaction => {
    if (s.type === "pay" || s.type === "axfer") {
      if (!isValidAddress(s.receiver)) throw new Error("bad receiver");
      if (s.amount < 0n) throw new Error("negative amount");
      total += minFee;
      return s.type === "pay"
        ? makePaymentTxnWithSuggestedParamsFromObject({ sender: me, receiver: s.receiver, amount: s.amount, note: s.note, suggestedParams: base(minFee) })
        : makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: me, receiver: s.receiver, amount: s.amount, assetIndex: s.assetId, note: s.note, suggestedParams: base(minFee) });
    }
    const fee = minFee * BigInt(Math.max(1, Math.floor(s.feeMultiplier ?? 1)));
    total += fee;
    return makeApplicationNoOpTxnFromObject({
      sender: me,
      appIndex: s.appId,
      appArgs: s.args,
      accounts: s.accounts,
      foreignAssets: s.foreignAssets,
      foreignApps: s.foreignApps,
      note: s.note,
      suggestedParams: base(fee),
    });
  });
  const grouped = txns.length > 1 ? assignGroupID(txns) : txns;
  const request: DappRequest = {
    id: randomId(),
    origin: WALLET_ORIGIN,
    via: "injected",
    family: "algorand",
    networkId: ctx.network.id,
    method: "algo_signAndPostTxn",
    params: [grouped.map((t) => ({ txn: b64encode(encodeUnsignedTransaction(t)) }))],
  };
  return { request, fee: total, txns: grouped };
}

/** An app's local state for an account, keys decoded to strings (uint → bigint, bytes → Uint8Array). Null if not opted in. */
export async function readLocalState(ctx: ChainContext, address: string, appId: bigint | number): Promise<Map<string, bigint | Uint8Array> | null> {
  let r: { "app-local-state"?: { "key-value"?: { key: string; value: { type: number; uint?: unknown; bytes?: string } }[] } };
  try {
    r = await algodFor(ctx).get(`/v2/accounts/${address}/applications/${appId}`);
  } catch (e) {
    if (e instanceof AlgodError && e.status === 404) return null;
    throw new ClipError("Couldn't read the Algorand network right now. Try again in a moment.", "algorand/read-failed", e);
  }
  const kv = r["app-local-state"]?.["key-value"];
  if (!kv) return null;
  const out = new Map<string, bigint | Uint8Array>();
  for (const { key, value } of kv) {
    const k = new TextDecoder().decode(b64decode(key));
    out.set(k, value.type === 2 ? big(value.uint) : b64decode(value.bytes ?? ""));
  }
  return out;
}

/** This account's ALGO (balance, algod min-balance), whether it's rekeyed, and its holdings of some ASAs (null = not added). */
export async function readAccount(
  ctx: ChainContext,
  assetIds: bigint[] = [],
): Promise<{ balance: bigint; minBalance: bigint; rekeyed: boolean; holdings: Map<string, { amount: bigint; frozen: boolean } | null> }> {
  const algod = algodFor(ctx);
  const me = ctx.account.address;
  try {
    const a = await algod.account(me);
    const holdings = new Map<string, { amount: bigint; frozen: boolean } | null>();
    for (const id of assetIds) if (id > 0n) holdings.set(id.toString(), await algod.holding(me, id));
    return { balance: big(a.amount), minBalance: big(a["min-balance"]), rekeyed: !!a["auth-addr"] && a["auth-addr"] !== me, holdings };
  } catch (e) {
    throw new ClipError("Couldn't read your Algorand account right now. Try again in a moment.", "algorand/read-failed", e);
  }
}

/** Address of a logic signature program (sha512_256("Program" ‖ program)). */
export function logicSigAddress(program: Uint8Array): string {
  return new LogicSigAccount(program).address().toString();
}

export { encodeUint64 };

/** Parses a base64 msgpack unsigned transaction back (tests and reviews). */
export function decodeTxn(b64: string): Transaction {
  return decodeUnsignedTransaction(b64decode(b64));
}
