import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { generateValidStart, parseAccountId } from "./ids.js";
import { type HederaLedger, GRPC_WEB_NODES, NODES_PER_TRANSACTION } from "./networks.js";
import {
  type AccountIdP,
  BODY,
  type BodyP,
  type TimestampP,
  decodeBody,
  decodeSignedTransaction,
  decodeTransaction,
  decodeTransactionList,
  encodeAccountId,
  encodeDuration,
  encodeEcdsaSignaturePair,
  encodeSignatureMap,
  encodeSignedTransaction,
  encodeTransactionId,
  encodeTransactionList,
  signaturePairEcdsa,
  signaturePairPrefix,
} from "./proto/hapi.js";
import { Writer, concat, rawFields } from "./proto/wire.js";
import { b64decode, b64encode, hex } from "./util.js";

/**
 * Transaction byte plumbing, without the SDK.
 *
 * How Hedera ECDSA(secp256k1) signing works: a frozen transaction is a TransactionList holding one
 * SignedTransaction per (node, transaction id) pair; each carries its own `bodyBytes` (they differ in
 * `nodeAccountID`). Every one of them must be signed. An ECDSA key signs keccak256(bodyBytes) and the 64-byte
 * r||s goes into that SignedTransaction's SignatureMap as `ECDSA_secp256k1`, keyed by the compressed public key.
 * So prepare() emits one 32-byte digest per body, and finalize() puts each signature back on the body whose
 * digest it signed (matched by verification, not by position).
 */

export interface TxEntry {
  /** Came as `signedTransactionBytes` (frozen) rather than the deprecated `bodyBytes` + `sigMap`. */
  signed: boolean;
  /** The SignedTransaction bytes as received (frozen entries only). */
  raw?: Uint8Array;
  bodyBytes: Uint8Array;
  /** Encoded SignaturePairs already present. */
  sigPairs: Uint8Array[];
  useSerializedHash?: boolean;
  body: BodyP;
}

export interface ParsedTransaction {
  entries: TxEntry[];
  /** The SDK's `isFrozen()`: at least one SignedTransaction. Unfrozen = HIP-745 (the wallet picks payer/nodes). */
  frozen: boolean;
  /** The first body; all bodies of one transaction differ only in node (and, for chunks, transaction id). */
  body: BodyP;
}

/**
 * Reads a `TransactionList` (what the SDK's toBytes() writes) or a single `Transaction`, like the SDK's
 * Transaction.fromBytes.
 */
export function parseTransaction(bytes: Uint8Array): ParsedTransaction {
  if (bytes.length === 0) throw new Error("empty transaction");
  let list = decodeTransactionList(bytes);
  if (list.length === 0) list = [bytes];
  const entries: TxEntry[] = [];
  for (const raw of list) {
    const t = decodeTransaction(raw);
    if (t.signedTransactionBytes?.length) {
      const s = decodeSignedTransaction(t.signedTransactionBytes);
      const e: TxEntry = { signed: true, raw: t.signedTransactionBytes, bodyBytes: s.bodyBytes, sigPairs: s.sigPairs, body: decodeBody(s.bodyBytes) };
      if (s.useSerializedHash != null) e.useSerializedHash = s.useSerializedHash;
      entries.push(e);
    } else if (t.bodyBytes?.length) {
      const pairs = t.sigMap ? rawFields(t.sigMap).flatMap((f) => (f.field === 1 && f.value ? [f.value] : [])) : [];
      entries.push({ signed: false, bodyBytes: t.bodyBytes, sigPairs: pairs, body: decodeBody(t.bodyBytes) });
    } else {
      throw new Error("bodyBytes and signedTransactionBytes are empty");
    }
  }
  if (!entries.length) throw new Error("no transactions found in bytes");
  for (const e of entries) if (!e.body.kind) throw new Error("transaction body has no data");
  // Audit 2026-10 (HED-01): decode() describes the first body and prepare() signs every body, so they must be
  // the same transaction sent to different nodes. A list whose bodies differ in anything but nodeAccountID (a
  // second, hidden transfer; multi-chunk messages) is refused rather than half-shown.
  const shape = (b: Uint8Array) => hex(concat(rawFields(b).filter((f) => f.field !== 2).map((f) => f.raw)));
  const first = shape(entries[0]!.bodyBytes);
  if (entries.some((e) => shape(e.bodyBytes) !== first)) throw new Error("the transactions in this list differ in more than the node");
  return { entries, frozen: entries.some((e) => e.signed), body: entries[0]!.body };
}

/** Raw TransactionBody bytes (hedera_signTransaction's `transactionBody`), described like a transaction. */
export function transactionFromBodyBytes(bodyBytes: Uint8Array): ParsedTransaction {
  const body = decodeBody(bodyBytes);
  if (!body.kind) throw new Error("transaction body has no data");
  return { entries: [{ signed: true, bodyBytes, sigPairs: [], body }], frozen: true, body };
}

/** A schedule's inner transaction, from the mirror node's base64 SchedulableTransactionBody. */
export function bodyFromSchedulable(b64: string): BodyP {
  const body = decodeBody(b64decode(b64), true);
  if (!body.kind) throw new Error("empty scheduled transaction");
  return body;
}

/** Encodes the entries back into a TransactionList, the way the SDK's toBytes() does after signing. */
export function serializeTransaction(entries: TxEntry[]): Uint8Array {
  return encodeTransactionList(
    entries.map((e) => {
      const s: { bodyBytes: Uint8Array; sigPairs: Uint8Array[]; useSerializedHash?: boolean } = { bodyBytes: e.bodyBytes, sigPairs: e.sigPairs };
      if (e.useSerializedHash != null) s.useSerializedHash = e.useSerializedHash;
      return encodeSignedTransaction(s);
    }),
  );
}

/* ------------------------------------------------------------------ freezing */

/** The SDK's default max fee per transaction type (`_defaultMaxTransactionFee`, hiero-sdk-js v2.89.1), in tinybars. */
const HBAR = 100_000_000n;
const DEFAULT_FEE = new Map<number, bigint>([
  [BODY.cryptoTransfer, 1n * HBAR],
  [BODY.tokenAssociate, 5n * HBAR],
  [BODY.tokenDissociate, 5n * HBAR],
  [BODY.scheduleCreate, 5n * HBAR],
  [BODY.scheduleSign, 5n * HBAR],
  [BODY.scheduleDelete, 5n * HBAR],
  [BODY.contractCreateInstance, 20n * HBAR],
  [16, 5n * HBAR], // fileAppend
  [17, 5n * HBAR], // fileCreate
  [24, 25n * HBAR], // consensusCreateTopic
  [29, 30n * HBAR], // tokenCreation
]);
export function defaultMaxFee(kind: number): bigint {
  return DEFAULT_FEE.get(kind) ?? 2n * HBAR;
}

/** The SDK's DEFAULT_TRANSACTION_VALID_DURATION. */
export const DEFAULT_VALID_DURATION = 120;

/** A transaction before freezing: the data case plus optional header values. */
export interface TxDraft {
  kind: number;
  data: Uint8Array;
  memo?: string;
  /** Max fee in tinybars; the type's SDK default when absent. */
  maxFee?: bigint;
  validDuration?: number;
}

export interface FreezeOptions {
  payer: string | AccountIdP;
  ledger: HederaLedger;
  /** Node account ids; default: NODES_PER_TRANSACTION random nodes of the ledger. */
  nodes?: string[];
  validStart?: TimestampP;
}

export function pickNodes(ledger: HederaLedger, count = NODES_PER_TRANSACTION): string[] {
  const all = Object.keys(GRPC_WEB_NODES[ledger]);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, Math.min(count, all.length));
}

/**
 * One body per node: `header` (transactionID 1, nodeAccountID 2, transactionFee 3, transactionValidDuration 4)
 * followed by every other field of the template in its original order. That is exactly the SDK's field order,
 * so a freshly built draft comes out byte-identical to `freezeWith(client)`.
 */
function frameBodies(
  rest: Uint8Array,
  head: { txId: Uint8Array; fee: Uint8Array; duration: Uint8Array },
  nodes: string[],
): Uint8Array[] {
  return nodes.map((node) => {
    const w = new Writer().raw(head.txId).message(2, encodeAccountId(parseAccountId(node))).raw(head.fee).raw(head.duration);
    return concat([w.finish(), rest]);
  });
}

function toEntries(bodies: Uint8Array[]): TxEntry[] {
  return bodies.map((bodyBytes) => ({ signed: true, bodyBytes, sigPairs: [], body: decodeBody(bodyBytes) }));
}

/** Freezes a new transaction: payer transaction id, nodes, fee, valid duration. Returns TransactionList bytes. */
export function freezeDraft(draft: TxDraft, opts: FreezeOptions): Uint8Array {
  const payer = typeof opts.payer === "string" ? parseAccountId(opts.payer) : opts.payer;
  const txId = encodeTransactionId({ validStart: opts.validStart ?? generateValidStart(), accountId: payer, scheduled: false });
  const head = {
    txId: new Writer().message(1, txId).finish(),
    fee: new Writer().int(3, draft.maxFee ?? defaultMaxFee(draft.kind)).finish(),
    duration: new Writer().message(4, encodeDuration(draft.validDuration ?? DEFAULT_VALID_DURATION)).finish(),
  };
  const rest = new Writer()
    .string(6, draft.memo ?? "")
    .message(draft.kind, draft.data)
    .finish();
  return serializeTransaction(toEntries(frameBodies(rest, head, opts.nodes ?? pickNodes(opts.ledger))));
}

/**
 * HIP-745: a dapp (or the SDK's toBytes() on an unfrozen transaction) may send a body without a transaction id
 * and nodes. Fill in what's missing, keep everything else byte-for-byte. A no-op for frozen transactions.
 */
export function freezeIfNeeded(bytes: Uint8Array, opts: FreezeOptions): Uint8Array {
  const parsed = parseTransaction(bytes);
  if (parsed.frozen) return bytes;
  const fields = rawFields(parsed.entries[0]!.bodyBytes);
  const find = (n: number) => fields.find((f) => f.field === n);
  const payer = typeof opts.payer === "string" ? parseAccountId(opts.payer) : opts.payer;
  const fee = parsed.body.fee != null && parsed.body.fee > 0n ? find(3)!.raw : new Writer().int(3, defaultMaxFee(parsed.body.kind)).finish();
  const head = {
    txId:
      find(1)?.raw ??
      new Writer().message(1, encodeTransactionId({ validStart: opts.validStart ?? generateValidStart(), accountId: payer, scheduled: false })).finish(),
    fee,
    duration: find(4)?.raw ?? new Writer().message(4, encodeDuration(DEFAULT_VALID_DURATION)).finish(),
  };
  const rest = concat(fields.filter((f) => f.field > 4).map((f) => f.raw));
  return serializeTransaction(toEntries(frameBodies(rest, head, opts.nodes ?? pickNodes(opts.ledger))));
}

/** Accepts anything a caller may hand the builders: a draft, unfrozen bytes, or an SDK transaction (toBytes()). */
export type TxInput = TxDraft | Uint8Array | { toBytes(): Uint8Array };

export function freezeInput(input: TxInput, opts: FreezeOptions): Uint8Array {
  if (input instanceof Uint8Array) return freezeIfNeeded(input, opts);
  if (typeof (input as { toBytes?: unknown }).toBytes === "function") return freezeIfNeeded((input as { toBytes(): Uint8Array }).toBytes(), opts);
  return freezeDraft(input as TxDraft, opts);
}

/* ------------------------------------------------------------------ keys & signatures */

/** Compressed 33-byte secp256k1 public key from hex (compressed or uncompressed). */
export function ecdsaPublicKey(publicKeyHex: string): Uint8Array {
  return secp256k1.Point.fromHex(publicKeyHex.replace(/^0x/, "")).toBytes(true);
}

export function digest(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

/** Hedera ECDSA: the signature is over keccak256(message); 65-byte r||s||v is accepted as its r||s. */
export function verifyEcdsa(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const sig = signature.length === 65 ? signature.subarray(0, 64) : signature;
  try {
    return secp256k1.verify(sig, keccak_256(message), publicKey, { prehash: false });
  } catch {
    return false;
  }
}

function hasSigner(e: TxEntry, publicKey: Uint8Array): boolean {
  const k = hex(publicKey);
  return e.sigPairs.some((p) => hex(signaturePairPrefix(p)) === k);
}

/** Every body this key still has to sign, in list order. Empty if the key already signed (like the SDK's signWith). */
export function bodiesToSign(txBytes: Uint8Array, publicKey: Uint8Array): Uint8Array[] {
  const parsed = parseTransaction(txBytes);
  if (!parsed.frozen) throw new Error("transaction is not frozen");
  if (parsed.entries.some((e) => hasSigner(e, publicKey))) return [];
  return parsed.entries.map((e) => e.bodyBytes);
}

/**
 * Attaches signatures (each over keccak256 of one body, in any order) and returns the signed TransactionList.
 * Throws if any body is left without a valid signature.
 */
export function attachSignatures(txBytes: Uint8Array, publicKey: Uint8Array, signatures: Uint8Array[]): Uint8Array {
  const parsed = parseTransaction(txBytes);
  if (!parsed.frozen) throw new Error("transaction is not frozen");
  if (parsed.entries.some((e) => hasSigner(e, publicKey))) return serializeTransaction(parsed.entries);
  const entries = parsed.entries.map((e) => {
    const sig = signatures.find((s) => verifyEcdsa(publicKey, e.bodyBytes, s));
    if (!sig) throw new Error(`missing signature for body ${hex(digest(e.bodyBytes))}`);
    return { ...e, sigPairs: [...e.sigPairs, encodeEcdsaSignaturePair(publicKey, sig)] };
  });
  return serializeTransaction(entries);
}

/** Whether every body carries a valid signature from this key (the SDK's PublicKey.verifyTransaction). */
export function verifyTransaction(txBytes: Uint8Array, publicKey: Uint8Array): boolean {
  const k = hex(publicKey);
  return parseTransaction(txBytes).entries.every((e) =>
    e.sigPairs.some((p) => {
      const sig = signaturePairEcdsa(p);
      return hex(signaturePairPrefix(p)) === k && sig != null && verifyEcdsa(publicKey, e.bodyBytes, sig);
    }),
  );
}

/** base64 SignatureMap with one ECDSA pair: the result shape of hedera_signTransaction / hedera_signMessage. */
export function signatureMapBase64(publicKey: Uint8Array, signature: Uint8Array): string {
  return b64encode(encodeSignatureMap([encodeEcdsaSignaturePair(publicKey, signature)]));
}

/** hedera_signMessage prefixing, identical to hedera-wallet-connect's prefixMessageToSign. */
export function prefixMessage(message: string): Uint8Array {
  return new TextEncoder().encode(`\x19Hedera Signed Message:\n${message.length}${message}`);
}
