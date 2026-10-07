import type { BchTx, TokenData, TxOutput } from "./tx.js";
import { decodeTx } from "./tx.js";
import { fromHex, hex, isHex } from "./util.js";

/**
 * The BCH WalletConnect request format (wc2-bch-bcr, https://github.com/mainnet-pat/wc2-bch-bcr#signtransaction), used
 * by Cashonize, Paytaca and the apps listed there: `bch_signTransaction { transaction, sourceOutputs, broadcast?,
 * userPrompt? }` where `transaction` is raw hex, a libauth `Transaction`, or that object passed through libauth's
 * `stringify` (Uint8Array → "<Uint8Array: 0x…>", bigint → "<bigint: 123n>"), and `sourceOutputs` are libauth
 * Input & Output (& optional CashScript contract info) objects, stringified the same way. An input to be signed by
 * the wallet has an empty `unlockingBytecode`.
 */

const U8 = /^<Uint8Array: 0x(?<hex>[0-9a-f]*)>$/u;
const BIG = /^<bigint: (?<n>[0-9]+)n>$/u;

/** libauth `stringify`-compatible reviver (the spec's parseExtendedJson). */
export function revive(value: unknown): unknown {
  if (typeof value === "string") {
    const b = BIG.exec(value);
    if (b) return BigInt(b.groups!.n!);
    const u = U8.exec(value);
    if (u) return fromHex(u.groups!.hex!.length ? u.groups!.hex! : "");
    return value;
  }
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}

/** libauth `stringify` (what the spec's apps send; used for wallet-built requests too). */
export function stringifyExtended(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? `<bigint: ${v}n>` : v instanceof Uint8Array ? `<Uint8Array: 0x${hex(v)}>` : v));
}

function parseMaybe(v: unknown): unknown {
  if (typeof v === "string" && !isHex(v)) {
    try {
      return revive(JSON.parse(v));
    } catch {
      throw new Error("bad JSON");
    }
  }
  return revive(v);
}

const bytes = (v: unknown, what: string): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string" && (v === "" || isHex(v))) return v === "" ? new Uint8Array() : fromHex(v);
  if (v && typeof v === "object" && Object.keys(v).every((k) => /^\d+$/.test(k))) return Uint8Array.from(Object.values(v as Record<string, number>));
  throw new Error(`bad ${what}`);
};

const big = (v: unknown, what: string): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw new Error(`bad ${what}`);
};

const int = (v: unknown, what: string): number => {
  const n = Number(big(v, what));
  if (n < 0 || n > 0xffffffff) throw new Error(`bad ${what}`);
  return n;
};

function token(v: unknown): TokenData | undefined {
  if (v === undefined || v === null) return undefined;
  const t = v as { category?: unknown; amount?: unknown; nft?: { capability?: unknown; commitment?: unknown } };
  const category = bytes(t.category, "token category");
  if (category.length !== 32) throw new Error("bad token category");
  const out: TokenData = { category, amount: t.amount === undefined ? 0n : big(t.amount, "token amount") };
  if (t.nft) {
    const cap = t.nft.capability;
    if (cap !== "none" && cap !== "mutable" && cap !== "minting") throw new Error("bad nft capability");
    out.nft = { capability: cap, commitment: t.nft.commitment === undefined ? new Uint8Array() : bytes(t.nft.commitment, "nft commitment") };
  }
  return out;
}

function output(v: unknown): TxOutput {
  const o = v as { lockingBytecode?: unknown; valueSatoshis?: unknown; token?: unknown };
  const t = token(o.token);
  return { locking: bytes(o.lockingBytecode, "locking bytecode"), value: big(o.valueSatoshis, "value"), ...(t ? { token: t } : {}) };
}

export interface SourceOutput extends TxOutput {
  /** Outpoint this source output is (display-order txid hex + index), to match it to an input. */
  outpoint: string;
  /** CashScript contract name, if the app described one (data, shown as the app's claim only). */
  contractName?: string;
}

/** The transaction from `transaction` (hex, libauth object, or stringified). */
export function parseTransaction(v: unknown): BchTx {
  if (typeof v === "string" && isHex(v)) return decodeTx(fromHex(v));
  const t = parseMaybe(v) as { version?: unknown; inputs?: unknown; outputs?: unknown; locktime?: unknown };
  if (!t || typeof t !== "object" || !Array.isArray(t.inputs) || !Array.isArray(t.outputs) || !t.inputs.length || !t.outputs.length) throw new Error("bad transaction");
  return {
    version: int(t.version, "version"),
    locktime: int(t.locktime, "locktime"),
    inputs: t.inputs.map((x) => {
      const i = x as { outpointTransactionHash?: unknown; outpointIndex?: unknown; unlockingBytecode?: unknown; sequenceNumber?: unknown };
      const txid = bytes(i.outpointTransactionHash, "outpoint");
      if (txid.length !== 32) throw new Error("bad outpoint");
      return { txid, vout: int(i.outpointIndex, "outpoint index"), unlocking: bytes(i.unlockingBytecode ?? "", "unlocking bytecode"), sequence: int(i.sequenceNumber, "sequence") };
    }),
    outputs: t.outputs.map(output),
  };
}

export function parseSourceOutputs(v: unknown): SourceOutput[] {
  const list = parseMaybe(v);
  if (!Array.isArray(list)) throw new Error("bad source outputs");
  return list.map((x) => {
    const s = x as { outpointTransactionHash?: unknown; outpointIndex?: unknown; contract?: { artifact?: { contractName?: unknown } } };
    const txid = bytes(s.outpointTransactionHash, "outpoint");
    const name = s.contract?.artifact?.contractName;
    return { ...output(x), outpoint: `${hex(txid)}:${int(s.outpointIndex, "outpoint index")}`, ...(typeof name === "string" ? { contractName: name.slice(0, 64) } : {}) };
  });
}

/** libauth-shaped source output (for stringifyExtended) of one of our coins. */
export function sourceOutputJson(txid: Uint8Array, vout: number, sequence: number, locking: Uint8Array, value: bigint) {
  return { outpointIndex: vout, outpointTransactionHash: txid, sequenceNumber: sequence, unlockingBytecode: new Uint8Array(), lockingBytecode: locking, valueSatoshis: value };
}
