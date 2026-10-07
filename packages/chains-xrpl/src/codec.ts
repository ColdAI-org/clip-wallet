import { sha512 } from "@noble/hashes/sha2.js";
import { decodeClassic } from "./address.js";
import { concat, fromHex, hex, isObj } from "./util.js";

/**
 * A hand-written subset of the XRPL binary format (https://xrpl.org/docs/references/protocol/binary-format), enough
 * for the transactions Clip Wallet reads and signs. Field type codes, field codes and the signing-field set are
 * copied from ripple-binary-codec's definitions.json (rippled's SField.cpp); test/codec.test.ts encodes the same JSON
 * with ripple-binary-codec and checks the bytes are identical.
 *
 *  - Fields are sorted by (type code, field code). Field ids are 1–3 bytes.
 *  - Blob, AccountID and Vector256 are length-prefixed (VL: 1–3 bytes).
 *  - Amount: XRP = 8 bytes (bit 62 "positive", drops in the low 62 bits); issued = 8 bytes (bit 63, sign bit 62,
 *    exponent + 97 in 8 bits, 54-bit mantissa normalised to [10^15, 10^16)) ‖ currency (20) ‖ issuer (20).
 *  - STObject ends with 0xE1, STArray with 0xF1. PathSet steps are flagged 0x01/0x10/0x20, paths split by 0xFF,
 *    the set ends with 0x00.
 * Anything else (unknown fields, MPT amounts, XChain types) throws `UnsupportedField`, so nothing is ever signed
 * that this file can't fully serialise.
 */

type FieldType = "UInt8" | "UInt16" | "UInt32" | "Hash128" | "Hash256" | "Amount" | "Blob" | "AccountID" | "STObject" | "STArray" | "PathSet" | "Vector256" | "Issue";

const TYPE_CODE: Record<FieldType, number> = {
  UInt16: 1,
  UInt32: 2,
  Hash128: 4,
  Hash256: 5,
  Amount: 6,
  Blob: 7,
  AccountID: 8,
  STObject: 14,
  STArray: 15,
  UInt8: 16,
  PathSet: 18,
  Vector256: 19,
  Issue: 24,
};

interface FieldDef {
  type: FieldType;
  nth: number;
  /** Part of the single-signing payload (TxnSignature and Signers aren't). */
  signing: boolean;
}

const f = (type: FieldType, nth: number, signing = true): FieldDef => ({ type, nth, signing });

/** name → definition (ripple-binary-codec definitions.json, FIELDS). */
export const FIELDS: Record<string, FieldDef> = {
  TransactionType: f("UInt16", 2),
  SignerWeight: f("UInt16", 3),
  TransferFee: f("UInt16", 4),
  TradingFee: f("UInt16", 5),
  NetworkID: f("UInt32", 1),
  Flags: f("UInt32", 2),
  SourceTag: f("UInt32", 3),
  Sequence: f("UInt32", 4),
  Expiration: f("UInt32", 10),
  TransferRate: f("UInt32", 11),
  DestinationTag: f("UInt32", 14),
  QualityIn: f("UInt32", 20),
  QualityOut: f("UInt32", 21),
  OfferSequence: f("UInt32", 25),
  LastLedgerSequence: f("UInt32", 27),
  OperationLimit: f("UInt32", 29),
  SetFlag: f("UInt32", 33),
  ClearFlag: f("UInt32", 34),
  SignerQuorum: f("UInt32", 35),
  CancelAfter: f("UInt32", 36),
  FinishAfter: f("UInt32", 37),
  TicketSequence: f("UInt32", 41),
  NFTokenTaxon: f("UInt32", 42),
  EmailHash: f("Hash128", 1),
  WalletLocator: f("Hash256", 7),
  AccountTxnID: f("Hash256", 9),
  NFTokenID: f("Hash256", 10),
  InvoiceID: f("Hash256", 17),
  NFTokenBuyOffer: f("Hash256", 28),
  NFTokenSellOffer: f("Hash256", 29),
  Amount: f("Amount", 1),
  LimitAmount: f("Amount", 3),
  TakerPays: f("Amount", 4),
  TakerGets: f("Amount", 5),
  Fee: f("Amount", 8),
  SendMax: f("Amount", 9),
  DeliverMin: f("Amount", 10),
  Amount2: f("Amount", 11),
  NFTokenBrokerFee: f("Amount", 19),
  LPTokenOut: f("Amount", 25),
  LPTokenIn: f("Amount", 26),
  EPrice: f("Amount", 27),
  MessageKey: f("Blob", 2),
  SigningPubKey: f("Blob", 3),
  TxnSignature: f("Blob", 4, false),
  URI: f("Blob", 5),
  Domain: f("Blob", 7),
  MemoType: f("Blob", 12),
  MemoData: f("Blob", 13),
  MemoFormat: f("Blob", 14),
  Fulfillment: f("Blob", 16),
  Condition: f("Blob", 17),
  Account: f("AccountID", 1),
  Owner: f("AccountID", 2),
  Destination: f("AccountID", 3),
  Issuer: f("AccountID", 4),
  RegularKey: f("AccountID", 8),
  NFTokenMinter: f("AccountID", 9),
  Memo: f("STObject", 10),
  SignerEntry: f("STObject", 11),
  SignerEntries: f("STArray", 4),
  Memos: f("STArray", 9),
  TickSize: f("UInt8", 16),
  Paths: f("PathSet", 1),
  NFTokenOffers: f("Vector256", 4),
  Asset: f("Issue", 3),
  Asset2: f("Issue", 4),
};

/** TRANSACTION_TYPES (definitions.json). Only these can be serialised; decode() reads a subset of them. */
export const TX_TYPES: Record<string, number> = {
  Payment: 0,
  EscrowCreate: 1,
  EscrowFinish: 2,
  AccountSet: 3,
  EscrowCancel: 4,
  SetRegularKey: 5,
  OfferCreate: 7,
  OfferCancel: 8,
  TicketCreate: 10,
  SignerListSet: 12,
  TrustSet: 20,
  AccountDelete: 21,
  NFTokenMint: 25,
  NFTokenBurn: 26,
  NFTokenCreateOffer: 27,
  NFTokenCancelOffer: 28,
  NFTokenAcceptOffer: 29,
  AMMDeposit: 36,
  AMMWithdraw: 37,
};

export class UnsupportedField extends Error {
  constructor(public readonly field: string, why = "isn't supported") {
    super(`${field} ${why}`);
    this.name = "UnsupportedField";
  }
}

/* ------------------------------------------------------------------ primitives */

function fieldId(type: number, nth: number): Uint8Array {
  if (type < 16 && nth < 16) return new Uint8Array([(type << 4) | nth]);
  if (type < 16) return new Uint8Array([type << 4, nth]);
  if (nth < 16) return new Uint8Array([nth, type]);
  return new Uint8Array([0, type, nth]);
}

export function vlPrefix(len: number): Uint8Array {
  if (len <= 192) return new Uint8Array([len]);
  if (len <= 12480) {
    const l = len - 193;
    return new Uint8Array([193 + (l >>> 8), l & 0xff]);
  }
  if (len <= 918744) {
    const l = len - 12481;
    return new Uint8Array([241 + (l >>> 16), (l >>> 8) & 0xff, l & 0xff]);
  }
  throw new Error("VL too long");
}

function uint(value: unknown, bytes: number, name: string): Uint8Array {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0 || n >= 2 ** (bytes * 8)) throw new UnsupportedField(name, "isn't a valid number");
  const out = new Uint8Array(bytes);
  let v = n;
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function hashOf(value: unknown, bytes: number, name: string): Uint8Array {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value)) throw new UnsupportedField(name, "isn't a valid hash");
  return fromHex(value);
}

function blob(value: unknown, name: string): Uint8Array {
  if (typeof value !== "string" || !/^([0-9a-fA-F]{2})*$/.test(value)) throw new UnsupportedField(name, "isn't hex");
  return fromHex(value);
}

export function accountId(value: unknown, name = "Account"): Uint8Array {
  const id = typeof value === "string" ? decodeClassic(value) : null;
  if (!id) throw new UnsupportedField(name, "isn't a valid XRPL address");
  return id;
}

const STANDARD_CODE = /^[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}$/;

/** 20-byte currency code: "XRP" (all zero, only where XRP is allowed), a 3-character code, or 40 hex digits. */
export function currencyCode(code: unknown, allowXrp: boolean, name: string): Uint8Array {
  if (code === "XRP") {
    if (!allowXrp) throw new UnsupportedField(name, "can't use XRP as an issued currency");
    return new Uint8Array(20);
  }
  if (typeof code === "string" && STANDARD_CODE.test(code)) {
    const out = new Uint8Array(20);
    for (let i = 0; i < 3; i++) out[12 + i] = code.charCodeAt(i);
    return out;
  }
  if (typeof code === "string" && /^[0-9a-fA-F]{40}$/.test(code)) {
    const b = fromHex(code);
    if (b.every((x) => x === 0)) throw new UnsupportedField(name, "has an invalid currency code");
    return b;
  }
  throw new UnsupportedField(name, "has an invalid currency code");
}

const MIN_MANTISSA = 10n ** 15n;
const MAX_MANTISSA = 10n ** 16n;

/** Issued-currency value → 8 bytes. Throws when it can't be represented exactly (more than 16 significant digits). */
export function iouValue(value: unknown, name: string): Uint8Array {
  const m = typeof value === "string" ? /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim()) : null;
  if (!m || (!m[2] && !m[3])) throw new UnsupportedField(name, "isn't a valid amount");
  let mantissa = BigInt(`${m[2] ?? ""}${m[3] ?? ""}` || "0");
  let exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
  if (mantissa === 0n) return fromHex("8000000000000000");
  while (mantissa < MIN_MANTISSA) {
    mantissa *= 10n;
    exp -= 1;
  }
  while (mantissa >= MAX_MANTISSA) {
    if (mantissa % 10n !== 0n) throw new UnsupportedField(name, "has too many significant digits");
    mantissa /= 10n;
    exp += 1;
  }
  if (exp < -96 || exp > 80) throw new UnsupportedField(name, "is out of range");
  let bits = (1n << 63n) | (BigInt(exp + 97) << 54n) | mantissa;
  if (m[1] !== "-") bits |= 1n << 62n;
  return u64(bits);
}

function u64(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
}

const MAX_DROPS = 10n ** 17n;

export function amount(value: unknown, name: string): Uint8Array {
  if (typeof value === "string") {
    if (!/^\d+$/.test(value) || BigInt(value) > MAX_DROPS) throw new UnsupportedField(name, "isn't a valid XRP amount in drops");
    return u64((1n << 62n) | BigInt(value));
  }
  if (isObj(value) && typeof value.currency === "string" && typeof value.issuer === "string" && typeof value.value === "string") {
    const extra = Object.keys(value).filter((k) => k !== "currency" && k !== "issuer" && k !== "value");
    if (extra.length) throw new UnsupportedField(`${name}.${extra[0]}`);
    return concat(iouValue(value.value, name), currencyCode(value.currency, false, name), accountId(value.issuer, name));
  }
  // MPT amounts ({ mpt_issuance_id, value }) and anything else.
  throw new UnsupportedField(name, "isn't an XRP or issued-currency amount");
}

function issue(value: unknown, name: string): Uint8Array {
  if (!isObj(value)) throw new UnsupportedField(name);
  if (value.currency === "XRP" && value.issuer === undefined && Object.keys(value).length === 1) return new Uint8Array(20);
  if (typeof value.issuer === "string" && Object.keys(value).length === 2) return concat(currencyCode(value.currency, false, name), accountId(value.issuer, name));
  throw new UnsupportedField(name);
}

function pathSet(value: unknown, name: string): Uint8Array {
  if (!Array.isArray(value) || !value.length) throw new UnsupportedField(name);
  const parts: Uint8Array[] = [];
  value.forEach((path, i) => {
    if (!Array.isArray(path) || !path.length) throw new UnsupportedField(name);
    if (i > 0) parts.push(new Uint8Array([0xff]));
    for (const step of path) {
      if (!isObj(step)) throw new UnsupportedField(name);
      const keys = Object.keys(step).filter((k) => k !== "type" && k !== "type_hex");
      if (keys.some((k) => k !== "account" && k !== "currency" && k !== "issuer") || !keys.length) throw new UnsupportedField(name);
      let type = 0;
      const body: Uint8Array[] = [];
      if (step.account !== undefined) {
        type |= 0x01;
        body.push(accountId(step.account, name));
      }
      if (step.currency !== undefined) {
        type |= 0x10;
        body.push(currencyCode(step.currency, true, name));
      }
      if (step.issuer !== undefined) {
        type |= 0x20;
        body.push(accountId(step.issuer, name));
      }
      parts.push(new Uint8Array([type]), ...body);
    }
  });
  parts.push(new Uint8Array([0x00]));
  return concat(...parts);
}

function vector256(value: unknown, name: string): Uint8Array {
  if (!Array.isArray(value)) throw new UnsupportedField(name);
  const body = concat(...value.map((h) => hashOf(h, 32, name)));
  return concat(vlPrefix(body.length), body);
}

/* ------------------------------------------------------------------ objects */

function fieldValue(name: string, def: FieldDef, value: unknown, signingOnly: boolean): Uint8Array {
  switch (def.type) {
    case "UInt8":
      return uint(value, 1, name);
    case "UInt16":
      if (name === "TransactionType") {
        const code = typeof value === "string" ? TX_TYPES[value] : undefined;
        if (code === undefined) throw new UnsupportedField(`TransactionType ${String(value)}`);
        return uint(code, 2, name);
      }
      return uint(value, 2, name);
    case "UInt32":
      return uint(value, 4, name);
    case "Hash128":
      return hashOf(value, 16, name);
    case "Hash256":
      return hashOf(value, 32, name);
    case "Amount":
      return amount(value, name);
    case "Blob": {
      const b = blob(value, name);
      return concat(vlPrefix(b.length), b);
    }
    case "AccountID": {
      const id = accountId(value, name);
      return concat(vlPrefix(20), id);
    }
    case "Issue":
      return issue(value, name);
    case "PathSet":
      return pathSet(value, name);
    case "Vector256":
      return vector256(value, name);
    case "STObject":
      if (!isObj(value)) throw new UnsupportedField(name);
      return concat(serializeObject(value, signingOnly), new Uint8Array([0xe1]));
    case "STArray": {
      if (!Array.isArray(value)) throw new UnsupportedField(name);
      const parts: Uint8Array[] = [];
      for (const el of value) {
        const keys = isObj(el) ? Object.keys(el) : [];
        const inner = keys[0];
        const innerDef = inner ? FIELDS[inner] : undefined;
        if (keys.length !== 1 || !inner || !innerDef || innerDef.type !== "STObject") throw new UnsupportedField(name);
        parts.push(fieldId(TYPE_CODE.STObject, innerDef.nth), fieldValue(inner, innerDef, (el as Record<string, unknown>)[inner], signingOnly));
      }
      parts.push(new Uint8Array([0xf1]));
      return concat(...parts);
    }
  }
}

/** JSON keys that aren't fields of the transaction (answers carry them; they are never serialised). */
const NOT_SERIALIZED = new Set(["hash", "ctid", "date", "inLedger", "ledger_index", "meta", "validated"]);

export function serializeObject(obj: Record<string, unknown>, signingOnly = false): Uint8Array {
  const entries: { name: string; def: FieldDef }[] = [];
  for (const name of Object.keys(obj)) {
    if (NOT_SERIALIZED.has(name) || obj[name] === undefined) continue;
    const def = FIELDS[name];
    if (!def) throw new UnsupportedField(name);
    if (signingOnly && !def.signing) continue;
    entries.push({ name, def });
  }
  entries.sort((a, b) => TYPE_CODE[a.def.type] - TYPE_CODE[b.def.type] || a.def.nth - b.def.nth);
  return concat(...entries.flatMap(({ name, def }) => [fieldId(TYPE_CODE[def.type], def.nth), fieldValue(name, def, obj[name], signingOnly)]));
}

/* ------------------------------------------------------------------ hashing */

export const sha512Half = (b: Uint8Array): Uint8Array => sha512(b).subarray(0, 32);

/** HashPrefix::txSign ("STX\0") and HashPrefix::transactionID ("TXN\0") (rippled HashPrefix.h). */
const PREFIX_SIGN = new Uint8Array([0x53, 0x54, 0x58, 0x00]);
const PREFIX_TXID = new Uint8Array([0x54, 0x58, 0x4e, 0x00]);

/** The single-signing payload (ripple-binary-codec `encodeForSigning`). */
export function signingPayload(tx: Record<string, unknown>): Uint8Array {
  return concat(PREFIX_SIGN, serializeObject(tx, true));
}

/** What the account key signs: SHA-512Half(0x53545800 ‖ signing fields). */
export function signingDigest(tx: Record<string, unknown>): Uint8Array {
  return sha512Half(signingPayload(tx));
}

/** The transaction's id: SHA-512Half(0x54584E00 ‖ signed blob), upper-case hex. */
export function txHash(blobBytes: Uint8Array): string {
  return hex(sha512Half(concat(PREFIX_TXID, blobBytes))).toUpperCase();
}

/** r ‖ s (64 bytes, low-S) → DER, the form TxnSignature carries. */
export function derSignature(rs: Uint8Array): Uint8Array {
  if (rs.length !== 64) throw new Error("expected r||s");
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0 && !(b[i + 1]! & 0x80)) i++;
    const v = b.subarray(i);
    return v[0]! & 0x80 ? concat(new Uint8Array([0]), v) : v;
  };
  const r = int(rs.subarray(0, 32));
  const s = int(rs.subarray(32));
  return concat(new Uint8Array([0x30, 4 + r.length + s.length, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s);
}
