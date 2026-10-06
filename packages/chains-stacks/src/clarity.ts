import { CLARITY_NAME, CONTRACT_NAME, c32address, parseAddress, parseContractId } from "./c32.js";
import { Reader, concat, fromHex, hex, isHex, readUintBE, textOf, uintBE, utf8 } from "./util.js";

/**
 * Clarity values: SIP-005 wire format ("Clarity value representation") and the SIP-030 JSON form
 * (https://github.com/stacksgov/sips/blob/main/sips/sip-030/sip-030-wallet-interface.md#clarity-values). The type
 * tags match @stacks/transactions `ClarityType` names, so a dapp's `Cl.*` objects (stringified) parse too.
 */
export type CV =
  | { type: "int"; value: bigint }
  | { type: "uint"; value: bigint }
  | { type: "buffer"; value: Uint8Array }
  | { type: "true" }
  | { type: "false" }
  | { type: "address"; value: string }
  | { type: "contract"; value: string }
  | { type: "ok"; value: CV }
  | { type: "err"; value: CV }
  | { type: "none" }
  | { type: "some"; value: CV }
  | { type: "list"; value: CV[] }
  | { type: "tuple"; value: Record<string, CV> }
  | { type: "ascii"; value: string }
  | { type: "utf8"; value: string };

const TAG = {
  int: 0x00,
  uint: 0x01,
  buffer: 0x02,
  true: 0x03,
  false: 0x04,
  address: 0x05,
  contract: 0x06,
  ok: 0x07,
  err: 0x08,
  none: 0x09,
  some: 0x0a,
  list: 0x0b,
  tuple: 0x0c,
  ascii: 0x0d,
  utf8: 0x0e,
} as const;

/** Clarity's own nesting limit (MAX_TYPE_DEPTH 32); deeper is refused instead of recursing without bound. */
const MAX_DEPTH = 32;
const MAX_VALUE_SIZE = 1024 * 1024;

const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

/** Standard principal bytes: version ‖ hash160. */
export function principalBytes(address: string): Uint8Array {
  const a = parseAddress(address);
  if (!a) throw new Error("bad principal");
  return concat(new Uint8Array([a.version]), a.hash160);
}

function lp1(s: string): Uint8Array {
  const b = utf8(s);
  if (b.length > 128) throw new Error("name too long");
  return concat(new Uint8Array([b.length]), b);
}

function u32(n: number): Uint8Array {
  return uintBE(BigInt(n), 4);
}

export function serializeCV(v: CV): Uint8Array {
  switch (v.type) {
    case "int": {
      if (v.value < I128_MIN || v.value > I128_MAX) throw new Error("int out of range");
      return concat(new Uint8Array([TAG.int]), uintBE(BigInt.asUintN(128, v.value), 16));
    }
    case "uint":
      if (v.value < 0n || v.value > U128_MAX) throw new Error("uint out of range");
      return concat(new Uint8Array([TAG.uint]), uintBE(v.value, 16));
    case "buffer":
      return concat(new Uint8Array([TAG.buffer]), u32(v.value.length), v.value);
    case "true":
    case "false":
    case "none":
      return new Uint8Array([TAG[v.type]]);
    case "address":
      return concat(new Uint8Array([TAG.address]), principalBytes(v.value));
    case "contract": {
      const c = parseContractId(v.value);
      if (!c) throw new Error("bad contract principal");
      return concat(new Uint8Array([TAG.contract, c.version]), c.hash160, lp1(c.name));
    }
    case "ok":
    case "err":
    case "some":
      return concat(new Uint8Array([TAG[v.type]]), serializeCV(v.value));
    case "list":
      return concat(new Uint8Array([TAG.list]), u32(v.value.length), ...v.value.map(serializeCV));
    case "tuple": {
      // Keys sorted (lexicographic byte order), as the Clarity VM does.
      const keys = Object.keys(v.value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return concat(new Uint8Array([TAG.tuple]), u32(keys.length), ...keys.flatMap((k) => [lp1(k), serializeCV(v.value[k]!)]));
    }
    case "ascii": {
      const b = utf8(v.value);
      if ([...b].some((c) => c > 0x7e || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d))) throw new Error("not ascii");
      return concat(new Uint8Array([TAG.ascii]), u32(b.length), b);
    }
    case "utf8": {
      const b = utf8(v.value);
      return concat(new Uint8Array([TAG.utf8]), u32(b.length), b);
    }
  }
}

export function readCV(r: Reader, depth = 0): CV {
  if (depth > MAX_DEPTH) throw new Error("value nested too deeply");
  const tag = r.u8();
  switch (tag) {
    case TAG.int:
      return { type: "int", value: BigInt.asIntN(128, readUintBE(r.read(16))) };
    case TAG.uint:
      return { type: "uint", value: readUintBE(r.read(16)) };
    case TAG.buffer: {
      const n = r.u32();
      if (n > MAX_VALUE_SIZE) throw new Error("buffer too large");
      return { type: "buffer", value: r.read(n).slice() };
    }
    case TAG.true:
      return { type: "true" };
    case TAG.false:
      return { type: "false" };
    case TAG.address: {
      const version = r.u8();
      return { type: "address", value: c32address(version, r.read(20)) };
    }
    case TAG.contract: {
      const version = r.u8();
      const h = r.read(20);
      const name = new TextDecoder().decode(r.read(r.u8()));
      if (!CONTRACT_NAME.test(name)) throw new Error("bad contract name");
      return { type: "contract", value: `${c32address(version, h)}.${name}` };
    }
    case TAG.ok:
    case TAG.err:
    case TAG.some:
      return { type: tag === TAG.ok ? "ok" : tag === TAG.err ? "err" : "some", value: readCV(r, depth + 1) };
    case TAG.none:
      return { type: "none" };
    case TAG.list: {
      const n = r.u32();
      if (n > MAX_VALUE_SIZE) throw new Error("list too long");
      const value: CV[] = [];
      for (let i = 0; i < n; i++) value.push(readCV(r, depth + 1));
      return { type: "list", value };
    }
    case TAG.tuple: {
      const n = r.u32();
      if (n > MAX_VALUE_SIZE) throw new Error("tuple too large");
      const value: Record<string, CV> = Object.create(null);
      for (let i = 0; i < n; i++) {
        const key = new TextDecoder().decode(r.read(r.u8()));
        if (!CLARITY_NAME.test(key)) throw new Error("bad tuple key");
        value[key] = readCV(r, depth + 1);
      }
      return { type: "tuple", value };
    }
    case TAG.ascii:
    case TAG.utf8: {
      const n = r.u32();
      if (n > MAX_VALUE_SIZE) throw new Error("string too large");
      const b = r.read(n);
      const s = textOf(b);
      if (s === null && n > 0) throw new Error("bad string");
      return { type: tag === TAG.ascii ? "ascii" : "utf8", value: s ?? "" };
    }
    default:
      throw new Error(`unknown clarity type ${tag}`);
  }
}

export function deserializeCV(bytes: Uint8Array): CV {
  const r = new Reader(bytes);
  const v = readCV(r);
  if (!r.done) throw new Error("trailing bytes");
  return v;
}

/* ------------------------------------------------------------------ SIP-030 JSON → CV */

/** stacks.js v7 `ClarityType` names and older numeric tags, mapped onto SIP-030 names. */
const ALIASES: Record<string, CV["type"]> = {
  int: "int",
  uint: "uint",
  buffer: "buffer",
  true: "true",
  false: "false",
  address: "address",
  contract: "contract",
  ok: "ok",
  err: "err",
  none: "none",
  some: "some",
  list: "list",
  tuple: "tuple",
  ascii: "ascii",
  utf8: "utf8",
  "0": "int",
  "1": "uint",
  "2": "buffer",
  "3": "true",
  "4": "false",
  "5": "address",
  "6": "contract",
  "7": "ok",
  "8": "err",
  "9": "none",
  "10": "some",
  "11": "list",
  "12": "tuple",
  "13": "ascii",
  "14": "utf8",
};

function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new Error("bad integer");
}

/**
 * A Clarity value from a dapp: hex (SIP-005 bytes) or the SIP-030 JSON object. Throws on anything else, so the
 * request becomes unreadable instead of being guessed at.
 */
export function cvFrom(input: unknown, depth = 0): CV {
  if (depth > MAX_DEPTH) throw new Error("value nested too deeply");
  if (typeof input === "string") {
    if (!isHex(input)) throw new Error("not a clarity value");
    return deserializeCV(fromHex(input));
  }
  if (!input || typeof input !== "object") throw new Error("not a clarity value");
  const o = input as { type?: unknown; value?: unknown; data?: unknown; list?: unknown; address?: unknown; contractName?: unknown };
  const type = ALIASES[String(o.type)];
  if (!type) throw new Error("unknown clarity type");
  switch (type) {
    case "int":
    case "uint":
      return { type, value: big(o.value) };
    case "buffer": {
      const v = o.value;
      if (typeof v === "string") return { type, value: v === "" || v === "0x" ? new Uint8Array() : fromHex(v) };
      if (v instanceof Uint8Array) return { type, value: v };
      throw new Error("bad buffer");
    }
    case "true":
    case "false":
    case "none":
      return { type };
    case "address":
    case "contract": {
      const v = typeof o.value === "string" ? o.value : typeof o.address === "string" ? (typeof o.contractName === "string" ? `${o.address}.${o.contractName}` : o.address) : "";
      if (v.includes(".")) {
        const c = parseContractId(v);
        if (!c) throw new Error("bad contract principal");
        return { type: "contract", value: `${c.address}.${c.name}` };
      }
      if (!parseAddress(v)) throw new Error("bad principal");
      return { type: "address", value: v.toUpperCase() };
    }
    case "ok":
    case "err":
    case "some":
      return { type, value: cvFrom(o.value, depth + 1) };
    case "list": {
      const arr = Array.isArray(o.value) ? o.value : Array.isArray(o.list) ? o.list : null;
      if (!arr) throw new Error("bad list");
      return { type, value: arr.map((x) => cvFrom(x, depth + 1)) };
    }
    case "tuple": {
      const rec = (o.value ?? o.data) as Record<string, unknown> | undefined;
      if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new Error("bad tuple");
      const value: Record<string, CV> = Object.create(null);
      for (const [k, x] of Object.entries(rec)) {
        if (!CLARITY_NAME.test(k)) throw new Error("bad tuple key");
        value[k] = cvFrom(x, depth + 1);
      }
      return { type, value };
    }
    case "ascii":
    case "utf8":
      if (typeof o.value !== "string") throw new Error("bad string");
      return { type, value: o.value };
  }
}

/* ------------------------------------------------------------------ display */

/** Readable Clarity-like text ("u100", "'SP…", "(some u5)", "{ amount: u1 }"), cut at `max` characters. */
export function cvText(v: CV, max = 160): string {
  const s = render(v, 0);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function render(v: CV, depth: number): string {
  if (depth > 6) return "…";
  switch (v.type) {
    case "int":
      return v.value.toString();
    case "uint":
      return `u${v.value}`;
    case "buffer": {
      const t = v.value.length && textOf(v.value);
      return t ? `0x${hex(v.value)} ("${t}")` : `0x${hex(v.value)}`;
    }
    case "true":
    case "false":
    case "none":
      return v.type;
    case "address":
    case "contract":
      return `'${v.value}`;
    case "ok":
    case "err":
    case "some":
      return `(${v.type} ${render(v.value, depth + 1)})`;
    case "list":
      return `(list ${v.value.map((x) => render(x, depth + 1)).join(" ")})`;
    case "tuple":
      return `{ ${Object.entries(v.value)
        .map(([k, x]) => `${k}: ${render(x, depth + 1)}`)
        .join(", ")} }`;
    case "ascii":
    case "utf8":
      return JSON.stringify(v.value);
  }
}

/** The principal text of an address/contract value, else null. */
export function principalOf(v: CV | undefined): string | null {
  return v && (v.type === "address" || v.type === "contract") ? v.value : null;
}
