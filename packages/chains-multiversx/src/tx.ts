import { ClipError } from "@clip-wallet/core";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { b64decode, b64encode, decodeAddress, fromHex, hex, utf8 } from "./util.js";

/**
 * MultiversX transactions as sdk-core's `Transaction.toPlainObject()` / `newFromPlainObject()` spell them (the shape
 * WalletConnect, the extension and web-wallet providers carry): numbers as JSON numbers, `value` as a decimal
 * string, `data` and usernames base64, addresses bech32, signatures hex.
 * https://github.com/multiversx/mx-sdk-js-core/blob/main/src/core/transactionComputer.ts (toPlainObject)
 */
export interface PlainTransaction {
  nonce: number | string;
  value: string;
  receiver: string;
  sender: string;
  senderUsername?: string;
  receiverUsername?: string;
  gasPrice: number | string;
  gasLimit: number | string;
  data?: string;
  chainID: string;
  version: number;
  options?: number;
  guardian?: string;
  relayer?: string;
  signature?: string;
  guardianSignature?: string;
  relayerSignature?: string;
}

/** A checked transaction. */
export interface Tx {
  nonce: bigint;
  value: bigint;
  receiver: string;
  sender: string;
  senderUsername: Uint8Array;
  receiverUsername: Uint8Array;
  gasPrice: bigint;
  gasLimit: bigint;
  data: Uint8Array;
  chainID: string;
  version: number;
  options: number;
  guardian: string;
  relayer: string;
  guardianSignature: string;
  relayerSignature: string;
}

/** options bit 0: the signature covers keccak256 of the serialized transaction (Ledger), bit 1: guarded transaction. */
export const OPTION_HASH_SIGN = 0b01;
export const OPTION_GUARDED = 0b10;

const MAX_U64 = (1n << 64n) - 1n;

function bad(what: string): ClipError {
  return new ClipError(`This transaction can't be read (${what}).`, "multiversx/bad-transaction");
}

function u64(v: unknown, what: string): bigint {
  const s = typeof v === "number" ? (Number.isSafeInteger(v) ? String(v) : "") : typeof v === "string" ? v : typeof v === "bigint" ? v.toString() : "";
  if (!/^\d+$/.test(s)) throw bad(what);
  const n = BigInt(s);
  if (n > MAX_U64) throw bad(what);
  return n;
}

function addr(v: unknown, what: string, optional = false): string {
  if (optional && (v === undefined || v === null || v === "")) return "";
  if (typeof v !== "string" || !decodeAddress(v)) throw bad(what);
  return v;
}

function b64(v: unknown, what: string): Uint8Array {
  if (v === undefined || v === null || v === "") return new Uint8Array();
  if (typeof v !== "string") throw bad(what);
  try {
    return b64decode(v);
  } catch {
    throw bad(what);
  }
}

function sigHex(v: unknown, what: string): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || !/^[0-9a-f]{128}$/i.test(v)) throw bad(what);
  return v.toLowerCase();
}

/** Checks a plain transaction from an app (or the wallet) and parses it. */
export function parseTransaction(input: unknown): Tx {
  if (!input || typeof input !== "object") throw bad("not an object");
  const p = input as Record<string, unknown>;
  const value = typeof p.value === "string" || typeof p.value === "number" ? String(p.value) : "";
  if (!/^\d+$/.test(value)) throw bad("value");
  const chainID = p.chainID ?? p.chainId;
  if (typeof chainID !== "string" || !chainID) throw bad("chain");
  const version = p.version ?? 1;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 255) throw bad("version");
  const options = p.options ?? 0;
  if (typeof options !== "number" || !Number.isInteger(options) || options < 0 || options > 255) throw bad("options");
  if (options && version < 2) throw bad("options need version 2");
  const tx: Tx = {
    nonce: u64(p.nonce, "nonce"),
    value: BigInt(value),
    receiver: addr(p.receiver, "receiver"),
    sender: addr(p.sender, "sender"),
    senderUsername: b64(p.senderUsername, "sender username"),
    receiverUsername: b64(p.receiverUsername, "receiver username"),
    gasPrice: u64(p.gasPrice, "gas price"),
    gasLimit: u64(p.gasLimit, "gas limit"),
    data: b64(p.data, "data"),
    chainID,
    version,
    options,
    guardian: addr(p.guardian, "guardian", true),
    relayer: addr(p.relayer, "relayer", true),
    guardianSignature: sigHex(p.guardianSignature, "guardian signature"),
    relayerSignature: sigHex(p.relayerSignature, "relayer signature"),
  };
  if (tx.gasPrice === 0n || tx.gasLimit === 0n) throw bad("gas");
  return tx;
}

/** Same field order and omissions as sdk-core TransactionComputer.toPlainObject (JSON.stringify drops `undefined`). */
function fields(tx: Tx, signature?: string): [string, string][] {
  const out: [string, string][] = [
    ["nonce", tx.nonce.toString()],
    ["value", JSON.stringify(tx.value.toString())],
    ["receiver", JSON.stringify(tx.receiver)],
    ["sender", JSON.stringify(tx.sender)],
  ];
  if (tx.senderUsername.length) out.push(["senderUsername", JSON.stringify(b64encode(tx.senderUsername))]);
  if (tx.receiverUsername.length) out.push(["receiverUsername", JSON.stringify(b64encode(tx.receiverUsername))]);
  out.push(["gasPrice", tx.gasPrice.toString()], ["gasLimit", tx.gasLimit.toString()]);
  if (tx.data.length) out.push(["data", JSON.stringify(b64encode(tx.data))]);
  if (signature) out.push(["signature", JSON.stringify(signature)]);
  out.push(["chainID", JSON.stringify(tx.chainID)], ["version", String(tx.version)]);
  if (tx.options) out.push(["options", String(tx.options)]);
  if (tx.guardian) out.push(["guardian", JSON.stringify(tx.guardian)]);
  if (tx.relayer) out.push(["relayer", JSON.stringify(tx.relayer)]);
  return out;
}

const json = (f: [string, string][]) => `{${f.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(",")}}`;

/** TransactionComputer.computeBytesForSigning: UTF-8 of JSON.stringify(toPlainObject(tx)). */
export function serializeForSigning(tx: Tx): Uint8Array {
  return utf8(json(fields(tx)));
}

/**
 * What the account's ed25519 signature covers (TransactionComputer.computeBytesForVerifying): the serialized
 * transaction, or its keccak256 when options bit 0 (hash signing) is set.
 */
export function bytesToSign(tx: Tx): Uint8Array {
  const raw = serializeForSigning(tx);
  return tx.options & OPTION_HASH_SIGN ? keccak_256(raw) : raw;
}

/** The signed transaction as the gateway's POST /transaction/send takes it (and dapps get back). */
export function signedPlain(tx: Tx, signature: Uint8Array): PlainTransaction {
  const out: PlainTransaction = {
    nonce: Number(tx.nonce),
    value: tx.value.toString(),
    receiver: tx.receiver,
    sender: tx.sender,
    gasPrice: Number(tx.gasPrice),
    gasLimit: Number(tx.gasLimit),
    chainID: tx.chainID,
    version: tx.version,
    signature: hex(signature),
  };
  if (tx.senderUsername.length) out.senderUsername = b64encode(tx.senderUsername);
  if (tx.receiverUsername.length) out.receiverUsername = b64encode(tx.receiverUsername);
  if (tx.data.length) out.data = b64encode(tx.data);
  if (tx.options) out.options = tx.options;
  if (tx.guardian) out.guardian = tx.guardian;
  if (tx.guardianSignature) out.guardianSignature = tx.guardianSignature;
  if (tx.relayer) out.relayer = tx.relayer;
  if (tx.relayerSignature) out.relayerSignature = tx.relayerSignature;
  return out;
}

/** The plain (unsigned) form of a wallet-built transaction. */
export function plainOf(tx: Tx): PlainTransaction {
  const { signature: _s, ...rest } = signedPlain(tx, new Uint8Array(64));
  return rest;
}

/** A smart contract call / built-in function in the data field: "name@hexArg@hexArg…". */
export interface Call {
  fn: string;
  args: Uint8Array[];
}

/** Parses "fn@aa@bb" (ASCII function name, even-length hex arguments; an empty argument is zero bytes), or null. */
export function parseCall(data: Uint8Array): Call | null {
  if (!data.length || data.some((b) => b < 0x20 || b > 0x7e)) return null;
  const parts = new TextDecoder().decode(data).split("@");
  const fn = parts[0]!;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(fn)) return null;
  const args: Uint8Array[] = [];
  for (const a of parts.slice(1)) {
    if (a.length % 2 || /[^0-9a-f]/i.test(a)) return null;
    args.push(fromHex(a));
  }
  return { fn, args };
}
