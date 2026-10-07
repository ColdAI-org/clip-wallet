import { Reader, compactSize, concat, reversed, sha256d, uintLE } from "./util.js";

/**
 * Bitcoin Cash transactions: the Bitcoin wire format with CashTokens (CHIP-2022-02) token prefixes in outputs, and the
 * BCH signing serialization (BIP-143 layout with SIGHASH_FORKID, replay-protected: fork id 0, plus the spent output's
 * token prefix), hand-written and cross-checked against @bitauth/libauth (encodeTransaction,
 * generateSigningSerializationBCH) in the tests. https://reference.cash/protocol/blockchain/transaction/transaction-signing
 */

export const SIGHASH_ALL_FORKID = 0x41;
export const DUST = 546n;

export interface TokenData {
  /** Category id in display (txid) order. */
  category: Uint8Array;
  amount: bigint;
  nft?: { capability: "none" | "mutable" | "minting"; commitment: Uint8Array };
}

export interface TxInput {
  /** Previous transaction id in display order (as explorers and Electrum show it). */
  txid: Uint8Array;
  vout: number;
  unlocking: Uint8Array;
  sequence: number;
}

export interface TxOutput {
  value: bigint;
  locking: Uint8Array;
  token?: TokenData;
}

export interface BchTx {
  version: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  locktime: number;
}

const PREFIX_TOKEN = 0xef;
const HAS_AMOUNT = 0x10;
const HAS_NFT = 0x20;
const HAS_COMMITMENT = 0x40;
const RESERVED = 0x80;
const CAPABILITY = ["none", "mutable", "minting"] as const;

export function encodeTokenPrefix(t: TokenData | undefined): Uint8Array {
  if (!t || (!t.nft && t.amount < 1n)) return new Uint8Array();
  const hasCommitment = !!t.nft && t.nft.commitment.length > 0;
  const bitfield = (t.nft ? HAS_NFT | CAPABILITY.indexOf(t.nft.capability) : 0) | (hasCommitment ? HAS_COMMITMENT : 0) | (t.amount > 0n ? HAS_AMOUNT : 0);
  return concat(
    new Uint8Array([PREFIX_TOKEN]),
    reversed(t.category),
    new Uint8Array([bitfield]),
    ...(hasCommitment ? [compactSize(t.nft!.commitment.length), t.nft!.commitment] : []),
    ...(t.amount > 0n ? [compactSize(t.amount)] : []),
  );
}

/** Splits an output's locking bytecode field into token data and the locking bytecode. */
export function readOutputField(field: Uint8Array): { locking: Uint8Array; token?: TokenData } {
  if (field[0] !== PREFIX_TOKEN) return { locking: field };
  const r = new Reader(field);
  r.u8();
  const category = reversed(r.read(32));
  const bits = r.u8();
  if (bits & RESERVED) throw new Error("bad token prefix");
  const hasNft = (bits & HAS_NFT) !== 0;
  const capability = bits & 0x0f;
  if (capability > 2 || (!hasNft && capability) || (!hasNft && bits & HAS_COMMITMENT)) throw new Error("bad token prefix");
  let commitment = new Uint8Array();
  if (bits & HAS_COMMITMENT) {
    const n = Number(r.compact());
    if (n < 1 || n > 128) throw new Error("bad commitment length");
    commitment = r.read(n).slice();
  }
  const amount = bits & HAS_AMOUNT ? r.compact() : 0n;
  if (bits & HAS_AMOUNT && (amount < 1n || amount > 0x7fffffffffffffffn)) throw new Error("bad token amount");
  if (!hasNft && amount === 0n) throw new Error("empty token prefix");
  const token: TokenData = { category, amount, ...(hasNft ? { nft: { capability: CAPABILITY[capability]!, commitment } } : {}) };
  return { locking: field.subarray(r.at).slice(), token };
}

export function encodeOutput(o: TxOutput): Uint8Array {
  const field = concat(encodeTokenPrefix(o.token), o.locking);
  return concat(uintLE(o.value, 8), compactSize(field.length), field);
}

export function encodeTx(tx: BchTx): Uint8Array {
  return concat(
    uintLE(tx.version, 4),
    compactSize(tx.inputs.length),
    ...tx.inputs.map((i) => concat(reversed(i.txid), uintLE(i.vout, 4), compactSize(i.unlocking.length), i.unlocking, uintLE(i.sequence, 4))),
    compactSize(tx.outputs.length),
    ...tx.outputs.map(encodeOutput),
    uintLE(tx.locktime, 4),
  );
}

export function decodeTx(bytes: Uint8Array): BchTx {
  const r = new Reader(bytes);
  const version = r.u32();
  const nIn = Number(r.compact());
  if (nIn < 1 || nIn > 10_000) throw new Error("bad input count");
  const inputs: TxInput[] = [];
  for (let i = 0; i < nIn; i++) {
    const txid = reversed(r.read(32));
    const vout = r.u32();
    const unlocking = r.read(Number(r.compact())).slice();
    inputs.push({ txid, vout, unlocking, sequence: r.u32() });
  }
  const nOut = Number(r.compact());
  if (nOut < 1 || nOut > 10_000) throw new Error("bad output count");
  const outputs: TxOutput[] = [];
  for (let i = 0; i < nOut; i++) {
    const value = r.u64();
    outputs.push({ value, ...readOutputField(r.read(Number(r.compact())).slice()) });
  }
  const locktime = r.u32();
  if (!r.done) throw new Error("trailing bytes");
  return { version, inputs, outputs, locktime };
}

/** Transaction id (display order). */
export function txidOf(tx: BchTx | Uint8Array): Uint8Array {
  return reversed(sha256d(tx instanceof Uint8Array ? tx : encodeTx(tx)));
}

/**
 * The 32-byte digest an input's key signs with SIGHASH_ALL | SIGHASH_FORKID (0x41, fork id 0): double SHA-256 of
 *   version ‖ hashPrevouts ‖ hashSequence ‖ outpoint ‖ spent token prefix ‖ scriptCode ‖ value ‖ sequence ‖
 *   hashOutputs ‖ locktime ‖ 0x41000000.
 */
export function sighash(tx: BchTx, index: number, spent: { value: bigint; token?: TokenData }, scriptCode: Uint8Array): Uint8Array {
  const input = tx.inputs[index];
  if (!input) throw new Error("no such input");
  const prevouts = concat(...tx.inputs.map((i) => concat(reversed(i.txid), uintLE(i.vout, 4))));
  const sequences = concat(...tx.inputs.map((i) => uintLE(i.sequence, 4)));
  const outputs = concat(...tx.outputs.map(encodeOutput));
  const preimage = concat(
    uintLE(tx.version, 4),
    sha256d(prevouts),
    sha256d(sequences),
    reversed(input.txid),
    uintLE(input.vout, 4),
    encodeTokenPrefix(spent.token),
    compactSize(scriptCode.length),
    scriptCode,
    uintLE(spent.value, 8),
    uintLE(input.sequence, 4),
    sha256d(outputs),
    uintLE(tx.locktime, 4),
    uintLE(SIGHASH_ALL_FORKID, 4),
  );
  return sha256d(preimage);
}

/* ------------------------------------------------------------------ signatures */

function derInt(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0 && !(b[i + 1]! & 0x80)) i++;
  const v = b.subarray(i);
  return v[0]! & 0x80 ? concat(new Uint8Array([0]), v) : v;
}

/** Strict DER of a 64-byte r ‖ s (low-S already applied by the caller). */
export function derSignature(rs: Uint8Array): Uint8Array {
  if (rs.length !== 64) throw new Error("bad signature length");
  const r = derInt(rs.subarray(0, 32));
  const s = derInt(rs.subarray(32));
  return concat(new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s);
}

const push = (data: Uint8Array) => {
  if (data.length > 75) throw new Error("push too large");
  return concat(new Uint8Array([data.length]), data);
};

/**
 * P2PKH unlocking bytecode: <DER signature ‖ 0x41> <compressed key>. BCH reads a 65-byte signature (with its sighash
 * byte) as Schnorr, so a DER signature of exactly 64 bytes (vanishingly rare) is refused instead of misread.
 */
export function p2pkhUnlocking(rs: Uint8Array, compressedKey: Uint8Array): Uint8Array {
  const sig = concat(derSignature(rs), new Uint8Array([SIGHASH_ALL_FORKID]));
  if (sig.length === 65) throw new Error("ambiguous 65-byte ECDSA signature");
  return concat(push(sig), push(compressedKey));
}

/** Byte size of a P2PKH-only transaction (signatures at their usual 72 bytes + sighash byte). */
export function estimateSize(inputs: number, outputs: { locking: Uint8Array; token?: TokenData }[]): number {
  const outBytes = outputs.reduce((n, o) => {
    const field = encodeTokenPrefix(o.token).length + o.locking.length;
    return n + 8 + compactSize(field).length + field;
  }, 0);
  return 4 + compactSize(inputs).length + inputs * 148 + compactSize(outputs.length).length + outBytes + 4;
}
