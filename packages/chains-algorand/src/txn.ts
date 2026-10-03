import { ClipError } from "@clip-wallet/core";
import {
  type Transaction,
  computeGroupID,
  decodeSignedTransaction,
  decodeUnsignedTransaction,
  encodeUnsignedTransaction,
  isValidAddress,
} from "algosdk";
import type { AlgorandNetSpec } from "./networks.js";
import { b64decode, bytesEqual } from "./util.js";

/** ARC-1 WalletTransaction. */
export interface WalletTransaction {
  txn: string;
  authAddr?: string;
  msig?: unknown;
  signers?: string[];
  stxn?: string;
  message?: string;
  groupMessage?: string;
}

export interface Item {
  index: number;
  /** Canonical msgpack of the unsigned transaction, as received. */
  raw: Uint8Array;
  txn: Transaction;
  sender: string;
  /** This account must sign it. */
  sign: boolean;
  /** Signing with this account as the authorized address of another (rekeyed) account → SignedTxn.sgnr. */
  sgnr?: string;
  /** Pre-signed by someone else (signers: []). */
  stxn?: Uint8Array;
  message?: string;
  groupMessage?: string;
}

export interface Normalized {
  items: Item[];
  /** Indexes of items, one array per atomic group (or lone transaction), in order. */
  groups: number[][];
  message?: string;
}

/** Protocol MaxTxGroupSize (dev.algorand.co protocol parameters). */
export const MAX_GROUP = 16;
/** Wallet limit for a request (ARC-1 allows a wallet limit ≥ the group size). */
export const MAX_TXNS = 64;
const SUPPORTED_TYPES = new Set(["pay", "axfer", "acfg", "afrz", "appl", "keyreg"]);
const KNOWN_FIELDS = new Set(["txn", "authAddr", "msig", "signers", "stxn", "message", "groupMessage"]);

const bad = (msg: string, code = "algorand/bad-params") => new ClipError(msg, code);

/** Accepts `WalletTransaction[]`, ARC-25's `[WalletTransaction[], SignTxnOpts?]`, or `{ txns, opts }`. */
export function walletTxnsOf(params: unknown): { txns: unknown[]; opts?: Record<string, unknown> } {
  if (Array.isArray(params)) {
    if (Array.isArray(params[0])) {
      const opts = params[1] && typeof params[1] === "object" ? (params[1] as Record<string, unknown>) : undefined;
      return opts ? { txns: params[0], opts } : { txns: params[0] };
    }
    return { txns: params };
  }
  if (params && typeof params === "object" && Array.isArray((params as { txns?: unknown }).txns)) {
    const p = params as { txns: unknown[]; opts?: Record<string, unknown> };
    return p.opts ? { txns: p.txns, opts: p.opts } : { txns: p.txns };
  }
  throw bad("This request is missing its transactions.");
}

function decodeTxn(b64: unknown, i: number): { raw: Uint8Array; txn: Transaction } {
  if (typeof b64 !== "string" || !b64) throw bad(`Transaction ${i + 1} is missing.`, "algorand/bad-transaction");
  let raw: Uint8Array;
  let txn: Transaction;
  try {
    raw = b64decode(b64);
    txn = decodeUnsignedTransaction(raw);
  } catch (cause) {
    throw new ClipError(`Transaction ${i + 1} can't be read.`, "algorand/bad-transaction", cause);
  }
  // ARC-1: unknown fields must be rejected. Re-encoding drops anything algosdk doesn't model, so a byte mismatch
  // means an unknown or non-canonical field.
  if (!bytesEqual(encodeUnsignedTransaction(txn), raw)) {
    throw new ClipError(`Transaction ${i + 1} has fields Clip Wallet doesn't recognize, so it won't sign it.`, "algorand/unknown-field");
  }
  return { raw, txn };
}

function zeroGroup(g: Uint8Array | undefined): boolean {
  return !g || g.every((b) => b === 0);
}

export function groupKey(t: Transaction): string {
  return zeroGroup(t.group) ? "" : Array.from(t.group!).join(",");
}

/**
 * ARC-1 validation of a signTxns request for this account and network. No network access: the rekey check
 * (on-chain auth-addr) happens in decode().
 */
export function normalizeTxns(params: unknown, me: string, spec: AlgorandNetSpec): Normalized {
  const { txns, opts } = walletTxnsOf(params);
  if (!txns.length) throw bad("This request is missing its transactions.");
  if (txns.length > MAX_TXNS) throw bad(`Clip Wallet signs at most ${MAX_TXNS} transactions at a time.`, "algorand/too-many");
  const genesisHash = b64decode(spec.genesisHash);

  const items: Item[] = txns.map((w, i) => {
    if (!w || typeof w !== "object" || Array.isArray(w)) throw bad(`Transaction ${i + 1} is malformed.`);
    const wt = w as Record<string, unknown>;
    for (const k of Object.keys(wt)) {
      if (!KNOWN_FIELDS.has(k) && !k.startsWith("_")) throw bad(`Transaction ${i + 1} has fields Clip Wallet doesn't recognize, so it won't sign it.`);
    }
    const { raw, txn } = decodeTxn(wt.txn, i);
    if (!SUPPORTED_TYPES.has(txn.type)) throw new ClipError("Clip Wallet can't sign this kind of Algorand transaction.", "algorand/unsupported-type");
    if (!bytesEqual(txn.genesisHash, genesisHash) || (txn.genesisID && txn.genesisID !== spec.genesisId)) {
      throw new ClipError(
        "This transaction is for a different Algorand network than the one this app is connected to. Nothing was signed.",
        "algorand/network-mismatch",
      );
    }
    const sender = txn.sender.toString();
    const item: Item = { index: i, raw, txn, sender, sign: false };
    if (typeof wt.message === "string") item.message = wt.message;
    if (typeof wt.groupMessage === "string") item.groupMessage = wt.groupMessage;

    let signers: string[] | undefined;
    if (wt.signers !== undefined) {
      if (!Array.isArray(wt.signers) || !wt.signers.every((s) => typeof s === "string" && isValidAddress(s))) {
        throw bad(`Transaction ${i + 1} lists signers that aren't Algorand addresses.`);
      }
      signers = wt.signers as string[];
    }
    if (wt.authAddr !== undefined && (typeof wt.authAddr !== "string" || !isValidAddress(wt.authAddr))) {
      throw bad(`Transaction ${i + 1} names a signing account that isn't an Algorand address.`);
    }
    const authAddr = wt.authAddr as string | undefined;

    if (signers && signers.length === 0) {
      if (wt.stxn !== undefined) {
        if (typeof wt.stxn !== "string") throw bad(`Transaction ${i + 1} has a malformed signed copy.`);
        let stxnBytes: Uint8Array;
        try {
          stxnBytes = b64decode(wt.stxn);
          const st = decodeSignedTransaction(stxnBytes);
          if (!bytesEqual(encodeUnsignedTransaction(st.txn), raw)) throw new Error("mismatch");
        } catch (cause) {
          throw new ClipError(`The signed copy of transaction ${i + 1} doesn't match it.`, "algorand/bad-params", cause);
        }
        item.stxn = stxnBytes;
      }
      return item;
    }
    if (wt.stxn !== undefined) throw bad(`Transaction ${i + 1} has a signed copy but also asks for a signature.`);
    if (wt.msig !== undefined) throw new ClipError("Clip Wallet can't sign for multisig accounts yet.", "algorand/multisig-unsupported");
    if (signers && signers.length > 1) throw bad(`Transaction ${i + 1} asks for several signers without a multisig.`);

    const expected = authAddr ?? sender;
    if (signers && signers[0] !== expected) throw bad(`Transaction ${i + 1} lists a signer that doesn't match it.`);
    if (expected !== me) {
      throw new ClipError(
        authAddr ? "This transaction needs a key that isn't in this wallet." : "This transaction is for an account that isn't in this wallet.",
        "algorand/not-your-account",
      );
    }
    item.sign = true;
    if (authAddr && authAddr !== sender) item.sgnr = authAddr;
    return item;
  });

  // Groups: a zero group id is a lone transaction; otherwise consecutive transactions share an id that must equal
  // the id computed over exactly those transactions (so every member is present, in order).
  const groups: number[][] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < items.length) {
    const key = groupKey(items[i]!.txn);
    if (!key) {
      groups.push([i++]);
      continue;
    }
    if (seen.has(key)) throw bad("This request splits a group of transactions apart.", "algorand/bad-group");
    seen.add(key);
    const members: number[] = [];
    while (i < items.length && groupKey(items[i]!.txn) === key) members.push(i++);
    if (members.length > MAX_GROUP) throw bad(`A group can hold at most ${MAX_GROUP} transactions.`, "algorand/bad-group");
    const copies = members.map((m) => {
      const c = decodeUnsignedTransaction(items[m]!.raw);
      c.group = undefined;
      return c;
    });
    if (!bytesEqual(computeGroupID(copies), items[members[0]!]!.txn.group)) {
      throw bad("Part of this group of transactions is missing or out of order, so Clip Wallet won't sign it.", "algorand/bad-group");
    }
    groups.push(members);
  }
  for (const g of groups) {
    for (const m of g.slice(1)) {
      if (items[m]!.groupMessage !== undefined) throw bad("This request is malformed (a group message on the wrong transaction).");
    }
  }
  if (!items.some((it) => it.sign)) throw new ClipError("This request doesn't need your signature.", "algorand/not-a-signer");
  const out: Normalized = { items, groups };
  if (opts && typeof opts.message === "string") out.message = opts.message;
  return out;
}
