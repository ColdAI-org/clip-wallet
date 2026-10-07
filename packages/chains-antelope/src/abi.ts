import {
  Reader,
  Writer,
  formatAsset,
  fromHex,
  hex,
  nameFromBigInt,
  nameToBigInt,
  packPublicKey,
  packSignature,
  parseAsset,
  publicKeyString,
  symbolFromBigInt,
  symbolToBigInt,
} from "./bytes.js";

/**
 * ABI-driven (de)serialisation for action data (eosio::abi/1.x JSON as `/v1/chain/get_abi` returns it): type aliases,
 * structs with bases, `T[]`, `T?`, `T$` (binary extensions), variants, and the built-in types Clip Wallet meets in
 * token, system and dapp contracts. Anything else (float types, 128-bit integers, fixed-size arrays, WebAuthn keys)
 * throws AbiError, so the request becomes blind instead of being guessed. JSON follows abieos / WharfKit: 64-bit
 * integers as decimal strings, `bytes` and checksums as hex, variants as [type, value].
 */

export interface Abi {
  version?: string;
  types?: { new_type_name: string; type: string }[];
  structs?: { name: string; base?: string; fields: { name: string; type: string }[] }[];
  actions?: { name: string; type: string; ricardian_contract?: string }[];
  variants?: { name: string; types: string[] }[];
}

export class AbiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbiError";
  }
}

/** eosio.token's transfer, so token sends never need an ABI round trip. */
export const TOKEN_ABI: Abi = {
  version: "eosio::abi/1.2",
  structs: [{ name: "transfer", base: "", fields: [{ name: "from", type: "name" }, { name: "to", type: "name" }, { name: "quantity", type: "asset" }, { name: "memo", type: "string" }] }],
  actions: [{ name: "transfer", type: "transfer" }],
};

const INT_SIZES: Record<string, [number, boolean]> = {
  int8: [1, true],
  uint8: [1, false],
  int16: [2, true],
  uint16: [2, false],
  int32: [4, true],
  uint32: [4, false],
  int64: [8, true],
  uint64: [8, false],
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function resolve(abi: Abi, type: string, depth = 0): string {
  if (depth > 32) throw new AbiError(`type alias loop at ${type}`);
  const alias = abi.types?.find((t) => t.new_type_name === type);
  return alias ? resolve(abi, alias.type, depth + 1) : type;
}

function bigOf(v: unknown, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  throw new AbiError(`${what} isn't an integer`);
}

function hexOf(v: unknown, bytes: number | null, what: string): Uint8Array {
  if (typeof v !== "string" || !/^([0-9a-fA-F]{2})*$/.test(v) || (bytes !== null && v.length !== bytes * 2)) throw new AbiError(`${what} isn't valid hex`);
  return fromHex(v);
}

/** Microseconds since epoch ↔ "2024-01-01T00:00:00.000" (UTC, no zone, as Spring prints it). */
function parseTime(v: unknown, what: string): number {
  if (typeof v !== "string") throw new AbiError(`${what} isn't a time`);
  const ms = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`);
  if (Number.isNaN(ms)) throw new AbiError(`${what} isn't a time`);
  return ms;
}
const timeText = (ms: number) => new Date(ms).toISOString().replace(/Z$/, "");

const SLOT_EPOCH_MS = 946684800000; // block_timestamp_type: half-seconds since 2000-01-01

export function serialize(abi: Abi, type: string, value: unknown, w: Writer = new Writer(), depth = 0): Writer {
  if (depth > 32) throw new AbiError("value nests too deep");
  if (type.endsWith("$")) {
    if (value !== undefined) serialize(abi, type.slice(0, -1), value, w, depth + 1);
    return w;
  }
  if (type.endsWith("?")) {
    if (value === undefined || value === null) return w.byte(0);
    w.byte(1);
    return serialize(abi, type.slice(0, -1), value, w, depth + 1);
  }
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) throw new AbiError(`${type} needs an array`);
    w.varuint32(value.length);
    for (const v of value) serialize(abi, type.slice(0, -2), v, w, depth + 1);
    return w;
  }
  const t = resolve(abi, type);
  if (t !== type) return serialize(abi, t, value, w, depth + 1);
  const int = INT_SIZES[t];
  if (int) return int[1] ? w.int(bigOf(value, t), int[0]) : w.uint(bigOf(value, t), int[0]);
  switch (t) {
    case "bool":
      if (typeof value !== "boolean") throw new AbiError("bool needs true or false");
      return w.byte(value ? 1 : 0);
    case "varuint32":
      return w.varuint32(Number(bigOf(value, t)));
    case "varint32":
      return w.varint32(Number(bigOf(value, t)));
    case "name":
      if (typeof value !== "string") throw new AbiError("name needs a string");
      try {
        return w.uint(nameToBigInt(value), 8);
      } catch {
        throw new AbiError(`invalid name ${value}`);
      }
    case "string":
      if (typeof value !== "string") throw new AbiError("string needs a string");
      return w.blob(new TextEncoder().encode(value));
    case "bytes":
      return w.blob(hexOf(value, null, t));
    case "checksum160":
      return w.bytes(hexOf(value, 20, t));
    case "checksum256":
      return w.bytes(hexOf(value, 32, t));
    case "checksum512":
      return w.bytes(hexOf(value, 64, t));
    case "public_key":
      try {
        return w.bytes(packPublicKey(String(value)));
      } catch {
        throw new AbiError("unsupported public key");
      }
    case "signature":
      try {
        return w.bytes(packSignature(String(value)));
      } catch {
        throw new AbiError("unsupported signature");
      }
    case "time_point":
      return w.int(BigInt(parseTime(value, t)) * 1000n, 8);
    case "time_point_sec":
      return w.uint(Math.floor(parseTime(value, t) / 1000), 4);
    case "block_timestamp_type":
      return w.uint(Math.round((parseTime(value, t) - SLOT_EPOCH_MS) / 500), 4);
    case "symbol": {
      const m = typeof value === "string" ? /^(\d{1,2}),([A-Z]{1,7})$/.exec(value) : null;
      if (!m) throw new AbiError("symbol needs \"4,EOS\"");
      return w.uint(symbolToBigInt({ precision: Number(m[1]), code: m[2]! }), 8);
    }
    case "symbol_code":
      if (typeof value !== "string" || !/^[A-Z]{1,7}$/.test(value)) throw new AbiError("symbol_code needs \"EOS\"");
      return w.uint(symbolToBigInt({ precision: 0, code: value }) >> 8n, 8);
    case "asset": {
      let a;
      try {
        a = parseAsset(String(value));
      } catch {
        throw new AbiError(`invalid asset ${String(value)}`);
      }
      return w.int(a.amount, 8).uint(symbolToBigInt(a.symbol), 8);
    }
    case "extended_asset":
      if (!isObj(value)) throw new AbiError("extended_asset needs { quantity, contract }");
      serialize(abi, "asset", value.quantity, w, depth + 1);
      return serialize(abi, "name", value.contract, w, depth + 1);
  }
  const variant = abi.variants?.find((v) => v.name === t);
  if (variant) {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") throw new AbiError(`${t} needs [type, value]`);
    const i = variant.types.indexOf(value[0]);
    if (i < 0) throw new AbiError(`${t} has no ${value[0]}`);
    w.varuint32(i);
    return serialize(abi, value[0], value[1], w, depth + 1);
  }
  const struct = abi.structs?.find((s) => s.name === t);
  if (struct) {
    if (!isObj(value)) throw new AbiError(`${t} needs an object`);
    if (struct.base) serialize(abi, struct.base, value, w, depth + 1);
    for (const f of struct.fields) {
      if (value[f.name] === undefined && !f.type.endsWith("$") && !f.type.endsWith("?")) throw new AbiError(`${t}.${f.name} is missing`);
      serialize(abi, f.type, value[f.name], w, depth + 1);
    }
    return w;
  }
  throw new AbiError(`unknown type ${t}`);
}

export function deserialize(abi: Abi, type: string, r: Reader, depth = 0): unknown {
  if (depth > 32) throw new AbiError("value nests too deep");
  if (type.endsWith("$")) return r.remaining > 0 ? deserialize(abi, type.slice(0, -1), r, depth + 1) : undefined;
  if (type.endsWith("?")) return r.byte() ? deserialize(abi, type.slice(0, -1), r, depth + 1) : null;
  if (type.endsWith("[]")) {
    const n = r.varuint32();
    if (n > r.remaining) throw new AbiError("array longer than the data");
    return Array.from({ length: n }, () => deserialize(abi, type.slice(0, -2), r, depth + 1));
  }
  const t = resolve(abi, type);
  if (t !== type) return deserialize(abi, t, r, depth + 1);
  const int = INT_SIZES[t];
  if (int) {
    const v = int[1] ? r.int(int[0]) : r.uint(int[0]);
    return int[0] > 4 ? v.toString() : Number(v);
  }
  switch (t) {
    case "bool": {
      const b = r.byte();
      if (b > 1) throw new AbiError("bad bool");
      return b === 1;
    }
    case "varuint32":
      return r.varuint32();
    case "varint32":
      return r.varint32();
    case "name":
      return nameFromBigInt(r.uint(8));
    case "string":
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(r.blob());
      } catch {
        throw new AbiError("string isn't UTF-8");
      }
    case "bytes":
      return hex(r.blob());
    case "checksum160":
      return hex(r.bytes(20));
    case "checksum256":
      return hex(r.bytes(32));
    case "checksum512":
      return hex(r.bytes(64));
    case "public_key": {
      if (r.byte() !== 0) throw new AbiError("only K1 public keys");
      return publicKeyString(r.bytes(33));
    }
    case "time_point":
      return timeText(Number(r.int(8) / 1000n));
    case "time_point_sec":
      return timeText(Number(r.uint(4)) * 1000).replace(/\.000$/, "");
    case "block_timestamp_type":
      return timeText(Number(r.uint(4)) * 500 + SLOT_EPOCH_MS);
    case "symbol": {
      const s = symbolFromBigInt(r.uint(8));
      return `${s.precision},${s.code}`;
    }
    case "symbol_code":
      return symbolFromBigInt(r.uint(8) << 8n).code;
    case "asset": {
      const amount = r.int(8);
      return formatAsset({ amount, symbol: symbolFromBigInt(r.uint(8)) });
    }
    case "extended_asset":
      return { quantity: deserialize(abi, "asset", r, depth + 1), contract: deserialize(abi, "name", r, depth + 1) };
  }
  const variant = abi.variants?.find((v) => v.name === t);
  if (variant) {
    const i = r.varuint32();
    const vt = variant.types[i];
    if (!vt) throw new AbiError(`${t} index ${i} out of range`);
    return [vt, deserialize(abi, vt, r, depth + 1)];
  }
  const struct = abi.structs?.find((s) => s.name === t);
  if (struct) {
    const out: Record<string, unknown> = struct.base ? (deserialize(abi, struct.base, r, depth + 1) as Record<string, unknown>) : {};
    for (const f of struct.fields) {
      const v = deserialize(abi, f.type, r, depth + 1);
      if (v !== undefined) out[f.name] = v;
    }
    return out;
  }
  throw new AbiError(`unknown type ${t}`);
}

/** The struct type an action's data uses, per the contract's ABI. */
export function actionType(abi: Abi, action: string): string | undefined {
  return abi.actions?.find((a) => a.name === action)?.type;
}

/** Action data bytes → JSON (all bytes must be consumed). */
export function decodeActionData(abi: Abi, action: string, data: Uint8Array): Record<string, unknown> {
  const type = actionType(abi, action);
  if (!type) throw new AbiError(`the contract's ABI has no action ${action}`);
  const r = new Reader(data);
  const out = deserialize(abi, type, r);
  if (r.remaining) throw new AbiError(`${r.remaining} bytes left over`);
  if (!isObj(out)) throw new AbiError("action data isn't a struct");
  return out;
}

export function encodeActionData(abi: Abi, action: string, value: unknown): Uint8Array {
  const type = actionType(abi, action);
  if (!type) throw new AbiError(`the contract's ABI has no action ${action}`);
  return serialize(abi, type, value).done();
}

/** True when the action's struct is the eosio.token transfer shape (from, to, quantity: asset, memo). */
export function isTokenTransfer(abi: Abi, action: string): boolean {
  const type = actionType(abi, action);
  const s = type ? abi.structs?.find((x) => x.name === resolve(abi, type)) : undefined;
  if (!s || s.base) return false;
  const want = [
    ["from", "name"],
    ["to", "name"],
    ["quantity", "asset"],
    ["memo", "string"],
  ];
  return s.fields.length === 4 && s.fields.every((f, i) => f.name === want[i]![0] && resolve(abi, f.type) === want[i]![1]);
}
