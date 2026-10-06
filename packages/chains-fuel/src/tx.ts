import { sha256 } from "@noble/hashes/sha2.js";
import { concat, fromHex, hex0x } from "./util.js";

/**
 * Fuel transactions, written by hand from the specs (https://docs.fuel.network/docs/specs/tx-format/ and
 * /docs/specs/identifiers/transaction-id/), byte-compatible with fuels-ts `TransactionCoder` (the tests compare both
 * for every fixture). Only Script transactions are built and signed; the other kinds (Create, Upgrade, Upload, Blob,
 * Mint) are recognised so a request for them can be refused in plain words.
 *
 * Encoding: every field is padded to an 8-byte word (u8/u16/u32 are written as a big-endian u64), byte arrays are
 * zero-padded to a multiple of 8, b256 values are 32 raw bytes.
 */

export const InputType = { Coin: 0, Contract: 1, Message: 2 } as const;
export const OutputType = { Coin: 0, Contract: 1, Change: 2, Variable: 3, ContractCreated: 4 } as const;
export const TransactionType = { Script: 0, Create: 1, Mint: 2, Upgrade: 3, Upload: 4, Blob: 5 } as const;
/** Policy bits (fuel-tx `PolicyType`, fuels-ts PoliciesCoder): values are written in this order. */
export const PolicyType = { Tip: 1, WitnessLimit: 2, Maturity: 4, MaxFee: 8, Expiration: 16, Owner: 32 } as const;

export const ZERO32 = `0x${"00".repeat(32)}`;
/** fuels-ts `returnZeroScript` (RET $zero), the script of a plain transfer: it moves nothing itself. */
export const RETURN_ZERO_SCRIPT = "0x24000000";

export interface TxPointer {
  blockHeight: number;
  txIndex: number;
}

export interface CoinInput {
  type: 0;
  txId: string;
  outputIndex: number;
  owner: string;
  amount: bigint;
  assetId: string;
  txPointer: TxPointer;
  witnessIndex: number;
  predicateGasUsed: bigint;
  predicate: Uint8Array;
  predicateData: Uint8Array;
}

export interface ContractInput {
  type: 1;
  txId: string;
  outputIndex: number;
  balanceRoot: string;
  stateRoot: string;
  txPointer: TxPointer;
  contractId: string;
}

export interface MessageInput {
  type: 2;
  sender: string;
  recipient: string;
  amount: bigint;
  nonce: string;
  witnessIndex: number;
  predicateGasUsed: bigint;
  data: Uint8Array;
  predicate: Uint8Array;
  predicateData: Uint8Array;
}

export type Input = CoinInput | ContractInput | MessageInput;

export type Output =
  | { type: 0; to: string; amount: bigint; assetId: string }
  | { type: 1; inputIndex: number; balanceRoot: string; stateRoot: string }
  | { type: 2; to: string; amount: bigint; assetId: string }
  | { type: 3; to: string; amount: bigint; assetId: string }
  | { type: 4; contractId: string; stateRoot: string };

export interface Policies {
  tip?: bigint;
  witnessLimit?: bigint;
  maturity?: number;
  maxFee: bigint;
  expiration?: number;
  owner?: bigint;
}

export interface ScriptTx {
  type: 0;
  scriptGasLimit: bigint;
  receiptsRoot: string;
  script: Uint8Array;
  scriptData: Uint8Array;
  policies: Policies;
  inputs: Input[];
  outputs: Output[];
  witnesses: Uint8Array[];
}

/* ------------------------------------------------------------------ encoding */

const MAX_U64 = (1n << 64n) - 1n;

function word(v: bigint | number): Uint8Array {
  const b = typeof v === "bigint" ? v : BigInt(v);
  if (b < 0n || b > MAX_U64) throw new RangeError("value out of u64 range");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, b, false);
  return out;
}

function small(v: number, bits: 8 | 16 | 32): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v >= 2 ** bits) throw new RangeError(`value out of u${bits} range`);
  return word(v);
}

function b256(h: string): Uint8Array {
  const b = fromHex(h);
  if (b.length !== 32) throw new RangeError("expected 32 bytes");
  return b;
}

function padded(bytes: Uint8Array): Uint8Array {
  const pad = (8 - (bytes.length % 8)) % 8;
  return pad ? concat(bytes, new Uint8Array(pad)) : bytes;
}

function txPointer(p: TxPointer): Uint8Array {
  return concat(small(p.blockHeight, 32), small(p.txIndex, 16));
}

function encodeInput(i: Input): Uint8Array {
  switch (i.type) {
    case 0:
      return concat(
        word(0),
        b256(i.txId),
        small(i.outputIndex, 16),
        b256(i.owner),
        word(i.amount),
        b256(i.assetId),
        txPointer(i.txPointer),
        small(i.witnessIndex, 16),
        word(i.predicateGasUsed),
        word(i.predicate.length),
        word(i.predicateData.length),
        padded(i.predicate),
        padded(i.predicateData),
      );
    case 1:
      return concat(word(1), b256(i.txId), small(i.outputIndex, 16), b256(i.balanceRoot), b256(i.stateRoot), txPointer(i.txPointer), b256(i.contractId));
    case 2:
      return concat(
        word(2),
        b256(i.sender),
        b256(i.recipient),
        word(i.amount),
        b256(i.nonce),
        small(i.witnessIndex, 16),
        word(i.predicateGasUsed),
        word(i.data.length),
        word(i.predicate.length),
        word(i.predicateData.length),
        padded(i.data),
        padded(i.predicate),
        padded(i.predicateData),
      );
  }
}

function encodeOutput(o: Output): Uint8Array {
  switch (o.type) {
    case 0:
    case 2:
    case 3:
      return concat(word(o.type), b256(o.to), word(o.amount), b256(o.assetId));
    case 1:
      return concat(word(1), small(o.inputIndex, 8), b256(o.balanceRoot), b256(o.stateRoot));
    case 4:
      return concat(word(4), b256(o.contractId), b256(o.stateRoot));
  }
}

function policyBits(p: Policies): { types: number; parts: Uint8Array[] } {
  let types = 0;
  const parts: Uint8Array[] = [];
  if (p.tip !== undefined) {
    types |= PolicyType.Tip;
    parts.push(word(p.tip));
  }
  if (p.witnessLimit !== undefined) {
    types |= PolicyType.WitnessLimit;
    parts.push(word(p.witnessLimit));
  }
  if (p.maturity !== undefined) {
    types |= PolicyType.Maturity;
    parts.push(small(p.maturity, 32));
  }
  types |= PolicyType.MaxFee;
  parts.push(word(p.maxFee));
  if (p.expiration !== undefined) {
    types |= PolicyType.Expiration;
    parts.push(small(p.expiration, 32));
  }
  if (p.owner !== undefined) {
    types |= PolicyType.Owner;
    parts.push(word(p.owner));
  }
  return { types, parts };
}

/** The canonical bytes of a Script transaction (what `submit` and `dryRun` take). */
export function encodeScriptTx(tx: ScriptTx): Uint8Array {
  const { types, parts } = policyBits(tx.policies);
  return concat(
    word(TransactionType.Script),
    word(tx.scriptGasLimit),
    b256(tx.receiptsRoot),
    word(tx.script.length),
    word(tx.scriptData.length),
    small(types, 32),
    small(tx.inputs.length, 16),
    small(tx.outputs.length, 16),
    small(tx.witnesses.length, 16),
    padded(tx.script),
    padded(tx.scriptData),
    ...parts,
    ...tx.inputs.map(encodeInput),
    ...tx.outputs.map(encodeOutput),
    ...tx.witnesses.map((w) => concat(small(w.length, 32), padded(w))),
  );
}

/**
 * Transaction id (specs: identifiers/transaction-id): SHA-256 of the chain id (u64, big-endian) followed by the
 * transaction serialized with the fields that change after signing zeroed: the receipts root, every input's tx
 * pointer and predicate gas used, a contract input's utxo id and roots, a contract output's roots, a change output's
 * amount, a variable output's to/amount/asset id, and with no witnesses at all.
 */
export function transactionId(tx: ScriptTx, chainId: number): Uint8Array {
  const zp: TxPointer = { blockHeight: 0, txIndex: 0 };
  const stripped: ScriptTx = {
    ...tx,
    receiptsRoot: ZERO32,
    inputs: tx.inputs.map((i): Input => {
      if (i.type === 0) return { ...i, txPointer: zp, predicateGasUsed: 0n };
      if (i.type === 2) return { ...i, predicateGasUsed: 0n };
      return { ...i, txPointer: zp, txId: ZERO32, outputIndex: 0, balanceRoot: ZERO32, stateRoot: ZERO32 };
    }),
    outputs: tx.outputs.map((o): Output => {
      if (o.type === 1) return { ...o, balanceRoot: ZERO32, stateRoot: ZERO32 };
      if (o.type === 2) return { ...o, amount: 0n };
      if (o.type === 3) return { ...o, to: ZERO32, amount: 0n, assetId: ZERO32 };
      return o;
    }),
    witnesses: [],
  };
  return sha256(concat(word(BigInt(chainId)), encodeScriptTx(stripped)));
}

/* ------------------------------------------------------------------ fuels-ts TransactionRequest JSON */

/**
 * The wire shape: `JSON.stringify(transactionRequest)` of a fuels-ts ScriptTransactionRequest, as the Fuel Wallet
 * connector sends it (@fuels/connectors FuelWalletConnector.sendTransaction). BN fields are 0x-hex strings (BN.toJSON),
 * bytes are 0x-hex strings; numbers and decimal strings are accepted too. `flag` (the dapp's own dry-run summary) is
 * ignored: nothing a dapp says about the outcome is trusted.
 */
export type TransactionRequestJson = Record<string, unknown>;

export class TxParseError extends Error {}

const bad = (what: string): never => {
  throw new TxParseError(what);
};

function bigOf(v: unknown, what: string, dflt?: bigint): bigint {
  if (v === undefined || v === null) return dflt !== undefined ? dflt : bad(what);
  if (typeof v === "bigint") return v >= 0n ? v : bad(what);
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : bad(what);
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
    if (/^\d+$/.test(v)) return BigInt(v);
  }
  return bad(what);
}

function numOf(v: unknown, what: string, dflt?: number): number {
  const b = bigOf(v, what, dflt === undefined ? undefined : BigInt(dflt));
  if (b > BigInt(Number.MAX_SAFE_INTEGER)) bad(what);
  return Number(b);
}

/** 0x-hex string, a byte array, or the `{ "0": n, … }` object JSON makes of a Uint8Array. */
export function bytesOf(v: unknown, what: string, dflt?: Uint8Array): Uint8Array {
  if (v === undefined || v === null) return dflt ?? bad(what);
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") {
    if (v === "0x" || v === "") return new Uint8Array(0);
    try {
      return fromHex(v.startsWith("0x") || v.startsWith("0X") ? v : bad(what));
    } catch {
      return bad(what);
    }
  }
  let arr: unknown[] | null = null;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const n = Object.keys(o).length;
    arr = [];
    for (let i = 0; i < n; i++) {
      if (!Object.prototype.hasOwnProperty.call(o, String(i))) return bad(what);
      arr.push(o[String(i)]);
    }
  }
  if (!arr || arr.some((x) => typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 255)) return bad(what);
  return Uint8Array.from(arr as number[]);
}

function b256Of(v: unknown, what: string, dflt?: string): string {
  const b = bytesOf(v, what, dflt === undefined ? undefined : fromHex(dflt));
  if (b.length !== 32) bad(what);
  return hex0x(b);
}

function toNumberBE(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) n = n * 256 + b;
  return n;
}

/** fuels-ts `inputify`: blockHeight from bytes 0..8 and txIndex from bytes 8..16 of the request's txPointer. */
function txPointerOf(v: unknown): TxPointer {
  const b = bytesOf(v, "txPointer", new Uint8Array(0));
  const p = { blockHeight: toNumberBE(b.slice(0, 8)), txIndex: toNumberBE(b.slice(8, 16)) };
  if (p.blockHeight >= 2 ** 32 || p.txIndex >= 2 ** 16) bad("txPointer");
  return p;
}

const obj = (v: unknown, what: string): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(what));

function inputOf(raw: unknown, k: number): Input {
  const i = obj(raw, `input ${k}`);
  const type = numOf(i.type, `input ${k} type`);
  if (type === InputType.Coin) {
    const id = bytesOf(i.id, `input ${k} id`);
    if (id.length !== 34) bad(`input ${k} id`);
    return {
      type: 0,
      txId: hex0x(id.slice(0, 32)),
      outputIndex: toNumberBE(id.slice(32, 34)),
      owner: b256Of(i.owner, `input ${k} owner`),
      amount: bigOf(i.amount, `input ${k} amount`),
      assetId: b256Of(i.assetId, `input ${k} assetId`),
      txPointer: txPointerOf(i.txPointer),
      witnessIndex: numOf(i.witnessIndex, `input ${k} witnessIndex`, 0),
      predicateGasUsed: bigOf(i.predicateGasUsed, `input ${k} predicateGasUsed`, 0n),
      predicate: bytesOf(i.predicate, `input ${k} predicate`, new Uint8Array(0)),
      predicateData: bytesOf(i.predicateData, `input ${k} predicateData`, new Uint8Array(0)),
    };
  }
  if (type === InputType.Contract) {
    return {
      type: 1,
      txId: b256Of(i.txID, `input ${k} txID`, ZERO32),
      outputIndex: 0,
      balanceRoot: ZERO32,
      stateRoot: ZERO32,
      txPointer: txPointerOf(i.txPointer),
      contractId: b256Of(i.contractId, `input ${k} contractId`),
    };
  }
  if (type === InputType.Message) {
    return {
      type: 2,
      sender: b256Of(i.sender, `input ${k} sender`),
      recipient: b256Of(i.recipient, `input ${k} recipient`),
      amount: bigOf(i.amount, `input ${k} amount`),
      nonce: b256Of(i.nonce, `input ${k} nonce`),
      witnessIndex: numOf(i.witnessIndex, `input ${k} witnessIndex`, 0),
      predicateGasUsed: bigOf(i.predicateGasUsed, `input ${k} predicateGasUsed`, 0n),
      data: bytesOf(i.data, `input ${k} data`, new Uint8Array(0)),
      predicate: bytesOf(i.predicate, `input ${k} predicate`, new Uint8Array(0)),
      predicateData: bytesOf(i.predicateData, `input ${k} predicateData`, new Uint8Array(0)),
    };
  }
  return bad(`input ${k} type`);
}

function outputOf(raw: unknown, k: number): Output {
  const o = obj(raw, `output ${k}`);
  const type = numOf(o.type, `output ${k} type`);
  switch (type) {
    case OutputType.Coin:
      return { type: 0, to: b256Of(o.to, `output ${k} to`), amount: bigOf(o.amount, `output ${k} amount`), assetId: b256Of(o.assetId, `output ${k} assetId`) };
    case OutputType.Contract:
      return { type: 1, inputIndex: numOf(o.inputIndex, `output ${k} inputIndex`), balanceRoot: ZERO32, stateRoot: ZERO32 };
    case OutputType.Change:
      return { type: 2, to: b256Of(o.to, `output ${k} to`), amount: 0n, assetId: b256Of(o.assetId, `output ${k} assetId`) };
    case OutputType.Variable:
      return { type: 3, to: b256Of(o.to, `output ${k} to`, ZERO32), amount: bigOf(o.amount, `output ${k} amount`, 0n), assetId: b256Of(o.assetId, `output ${k} assetId`, ZERO32) };
    case OutputType.ContractCreated:
      return { type: 4, contractId: b256Of(o.contractId, `output ${k} contractId`), stateRoot: b256Of(o.stateRoot, `output ${k} stateRoot`) };
  }
  return bad(`output ${k} type`);
}

/** Reads a request (object or its JSON text). Returns the transaction kind for non-Script requests. */
export function parseTransactionRequest(raw: unknown): { kind: "script"; tx: ScriptTx } | { kind: "other"; type: number } {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      bad("transaction JSON");
    }
  }
  const r = obj(v, "transaction");
  const type = numOf(r.type, "type");
  if (type !== TransactionType.Script) return { kind: "other", type };
  const list = (x: unknown, what: string): unknown[] => (x === undefined ? [] : Array.isArray(x) ? x : bad(what));
  const policies: Policies = { maxFee: bigOf(r.maxFee, "maxFee", 0n) };
  const tip = bigOf(r.tip, "tip", 0n);
  if (tip > 0n) policies.tip = tip;
  if (r.witnessLimit !== undefined && r.witnessLimit !== null) policies.witnessLimit = bigOf(r.witnessLimit, "witnessLimit");
  const maturity = numOf(r.maturity, "maturity", 0);
  if (maturity > 0) policies.maturity = maturity;
  const expiration = numOf(r.expiration, "expiration", 0);
  if (expiration > 0) policies.expiration = expiration;
  if (r.ownerInputIndex !== undefined && r.ownerInputIndex !== null) policies.owner = bigOf(r.ownerInputIndex, "ownerInputIndex");
  return {
    kind: "script",
    tx: {
      type: 0,
      scriptGasLimit: bigOf(r.gasLimit, "gasLimit", 0n),
      receiptsRoot: ZERO32,
      script: bytesOf(r.script, "script", new Uint8Array(0)),
      scriptData: bytesOf(r.scriptData, "scriptData", new Uint8Array(0)),
      policies,
      inputs: list(r.inputs, "inputs").map(inputOf),
      outputs: list(r.outputs, "outputs").map(outputOf),
      witnesses: list(r.witnesses, "witnesses").map((w, k) => bytesOf(w, `witness ${k}`)),
    },
  };
}

const bnHex = (v: bigint) => `0x${v.toString(16)}`;

/** Back to the fuels-ts request JSON (what `transactionRequestify` reads), e.g. a signed transaction for the dapp. */
export function toTransactionRequestJson(tx: ScriptTx): TransactionRequestJson {
  const out: TransactionRequestJson = {
    type: 0,
    gasLimit: bnHex(tx.scriptGasLimit),
    script: hex0x(tx.script),
    scriptData: hex0x(tx.scriptData),
    maxFee: bnHex(tx.policies.maxFee),
    inputs: tx.inputs.map((i) => {
      if (i.type === 0) {
        const id = concat(fromHex(i.txId), new Uint8Array([i.outputIndex >> 8, i.outputIndex & 0xff]));
        return {
          type: 0,
          id: hex0x(id),
          owner: i.owner,
          amount: bnHex(i.amount),
          assetId: i.assetId,
          txPointer: hex0x(concat(word(i.txPointer.blockHeight), word(i.txPointer.txIndex))),
          witnessIndex: i.witnessIndex,
          predicateGasUsed: bnHex(i.predicateGasUsed),
          predicate: hex0x(i.predicate),
          predicateData: hex0x(i.predicateData),
        };
      }
      if (i.type === 1) return { type: 1, txID: i.txId, txPointer: hex0x(concat(word(i.txPointer.blockHeight), word(i.txPointer.txIndex))), contractId: i.contractId };
      return {
        type: 2,
        sender: i.sender,
        recipient: i.recipient,
        amount: bnHex(i.amount),
        nonce: i.nonce,
        witnessIndex: i.witnessIndex,
        predicateGasUsed: bnHex(i.predicateGasUsed),
        data: hex0x(i.data),
        predicate: hex0x(i.predicate),
        predicateData: hex0x(i.predicateData),
      };
    }),
    outputs: tx.outputs.map((o) => {
      switch (o.type) {
        case 0:
          return { type: 0, to: o.to, amount: bnHex(o.amount), assetId: o.assetId };
        case 1:
          return { type: 1, inputIndex: o.inputIndex };
        case 2:
          return { type: 2, to: o.to, assetId: o.assetId };
        case 3:
          return { type: 3 };
        case 4:
          return { type: 4, contractId: o.contractId, stateRoot: o.stateRoot };
      }
    }),
    witnesses: tx.witnesses.map(hex0x),
  };
  const p = tx.policies;
  if (p.tip !== undefined) out.tip = bnHex(p.tip);
  if (p.witnessLimit !== undefined) out.witnessLimit = bnHex(p.witnessLimit);
  if (p.maturity !== undefined) out.maturity = p.maturity;
  if (p.expiration !== undefined) out.expiration = p.expiration;
  if (p.owner !== undefined) out.ownerInputIndex = Number(p.owner);
  return out;
}
