/**
 * The Candid subset this module needs (https://github.com/dfinity/candid/blob/master/spec/Candid.md): nat, nat8,
 * nat64, int, text, bool, null, principal, opt, vec (blob = vec nat8), record and variant. Encoding builds the type
 * table the way @dfinity/candid does (children before parents, structurally equal types once), so the bytes match
 * `IDL.encode` (the tests check). Decoding reads any type table and returns values keyed by field hash; `named()`
 * maps them back to the names an expected type knows. Unknown fields and cases are kept, never guessed at.
 */

export type CType =
  | { k: "nat" }
  | { k: "nat8" }
  | { k: "nat64" }
  | { k: "int" }
  | { k: "text" }
  | { k: "bool" }
  | { k: "null" }
  | { k: "principal" }
  | { k: "opt"; t: CType }
  | { k: "vec"; t: CType }
  | { k: "record"; fields: Record<string, CType> }
  | { k: "variant"; fields: Record<string, CType> };

export const C = {
  nat: { k: "nat" } as CType,
  nat8: { k: "nat8" } as CType,
  nat64: { k: "nat64" } as CType,
  int: { k: "int" } as CType,
  text: { k: "text" } as CType,
  bool: { k: "bool" } as CType,
  null: { k: "null" } as CType,
  principal: { k: "principal" } as CType,
  opt: (t: CType): CType => ({ k: "opt", t }),
  vec: (t: CType): CType => ({ k: "vec", t }),
  blob: { k: "vec", t: { k: "nat8" } } as CType,
  record: (fields: Record<string, CType>): CType => ({ k: "record", fields }),
  variant: (fields: Record<string, CType>): CType => ({ k: "variant", fields }),
};

/** Values: nat/int/nat64 bigint, nat8 number, text string, blob/principal Uint8Array, opt [] | [v], record/variant objects. */
export type CValue = bigint | number | string | boolean | null | Uint8Array | CValue[] | { [k: string]: CValue };

/** idl_hash: h = h·223 + byte, mod 2^32, over the UTF-8 field name. */
export function idlHash(name: string): number {
  let h = 0;
  for (const b of new TextEncoder().encode(name)) h = (h * 223 + b) >>> 0;
  return h;
}

/** Field id: a name's hash, or a "_<n>_" / numeric name's number. */
function fieldId(name: string): number {
  const m = /^_(\d+)_$/.exec(name) ?? /^(\d+)$/.exec(name);
  return m ? Number(m[1]) >>> 0 : idlHash(name);
}

const sortedFields = (fields: Record<string, CType>) => Object.entries(fields).map(([n, t]) => [n, t, fieldId(n)] as const).sort((a, b) => a[2] - b[2]);

export function uleb(n: bigint | number): Uint8Array {
  let v = BigInt(n);
  if (v < 0n) throw new Error("uleb: negative");
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    out.push(b);
  } while (v !== 0n);
  return Uint8Array.from(out);
}

export function sleb(n: bigint | number): Uint8Array {
  let v = BigInt(n);
  const out: number[] = [];
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0);
    out.push(done ? b : b | 0x80);
    if (done) return Uint8Array.from(out);
  }
}

const OP: Record<string, number> = { null: -1, bool: -2, nat: -3, int: -4, nat8: -5, nat64: -8, text: -15, principal: -24 };
const PRIM_BY_OP = new Map<number, CType["k"]>(Object.entries(OP).map(([k, v]) => [v, k as CType["k"]]));
// Primitive types this decoder can also skip/read without being asked for them.
const SIZE_BY_OP = new Map<number, number>([[-6, 2], [-7, 4], [-9, 1], [-10, 2], [-11, 4], [-12, 8], [-13, 4], [-14, 8]]);

function cat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function typeKey(t: CType): string {
  switch (t.k) {
    case "opt":
    case "vec":
      return `${t.k} ${typeKey(t.t)}`;
    case "record":
    case "variant":
      return `${t.k} {${sortedFields(t.fields).map(([, ft, id]) => `${id}:${typeKey(ft)}`).join("; ")}}`;
    default:
      return t.k;
  }
}

/** Encodes `IDL.encode(types, values)`. */
export function encode(types: CType[], values: CValue[]): Uint8Array {
  if (types.length !== values.length) throw new Error("candid: arity");
  const table: Uint8Array[] = [];
  const index = new Map<string, number>();
  const ref = (t: CType): Uint8Array => {
    if (t.k in OP) return sleb(OP[t.k]!);
    const key = typeKey(t);
    let i = index.get(key);
    if (i === undefined) {
      let body: Uint8Array;
      if (t.k === "opt" || t.k === "vec") {
        const inner = ref(t.t);
        body = cat([sleb(t.k === "opt" ? -18 : -19), inner]);
      } else if (t.k === "record" || t.k === "variant") {
        const fs = sortedFields(t.fields).map(([, ft, id]) => cat([uleb(id), ref(ft)]));
        body = cat([sleb(t.k === "record" ? -20 : -21), uleb(fs.length), ...fs]);
      } else throw new Error(`candid: ${t.k}`);
      i = table.length;
      index.set(key, i);
      table.push(body);
    }
    return sleb(i);
  };
  const argRefs = types.map(ref);
  const vals = types.map((t, i) => encValue(t, values[i]!));
  return cat([new TextEncoder().encode("DIDL"), uleb(table.length), ...table, uleb(types.length), ...argRefs, ...vals]);
}

function encValue(t: CType, v: CValue): Uint8Array {
  switch (t.k) {
    case "nat":
      return uleb(v as bigint);
    case "int":
      return sleb(v as bigint);
    case "nat8":
      return Uint8Array.of(Number(v) & 0xff);
    case "nat64": {
      const out = new Uint8Array(8);
      new DataView(out.buffer).setBigUint64(0, BigInt(v as bigint), true);
      return out;
    }
    case "text": {
      const b = new TextEncoder().encode(v as string);
      return cat([uleb(b.length), b]);
    }
    case "bool":
      return Uint8Array.of(v ? 1 : 0);
    case "null":
      return new Uint8Array();
    case "principal": {
      const b = v as Uint8Array;
      return cat([Uint8Array.of(1), uleb(b.length), b]);
    }
    case "opt": {
      const a = v as CValue[];
      return a.length ? cat([Uint8Array.of(1), encValue(t.t, a[0]!)]) : Uint8Array.of(0);
    }
    case "vec": {
      if (t.t.k === "nat8") {
        const b = v as Uint8Array;
        return cat([uleb(b.length), b]);
      }
      const a = v as CValue[];
      return cat([uleb(a.length), ...a.map((x) => encValue(t.t, x))]);
    }
    case "record": {
      const o = v as Record<string, CValue>;
      return cat(sortedFields(t.fields).map(([n, ft]) => encValue(ft, o[n]!)));
    }
    case "variant": {
      const o = v as Record<string, CValue>;
      const name = Object.keys(o)[0]!;
      const fs = sortedFields(t.fields);
      const i = fs.findIndex(([n]) => n === name);
      if (i < 0) throw new Error(`candid: no case ${name}`);
      return cat([uleb(i), encValue(fs[i]![1], o[name]!)]);
    }
  }
}

/* ------------------------------------------------------------------ decoding */

type Wire = number | { op: number; t?: Wire; fields?: [number, Wire][] };

/** A decoded value: records/variants are keyed by field id ("#<id>"), so `named()` can map them. */
export type Decoded = bigint | number | string | boolean | null | Uint8Array | Decoded[] | { [k: string]: Decoded };

class Reader {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw new Error("candid: truncated");
    return this.b[this.i++]!;
  }
  bytes(n: number): Uint8Array {
    if (n < 0 || this.i + n > this.b.length) throw new Error("candid: truncated");
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  uleb(): bigint {
    let n = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.byte();
      n |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return n;
      shift += 7n;
      if (shift > 700n) throw new Error("candid: number too long");
    }
  }
  sleb(): bigint {
    let n = 0n;
    let shift = 0n;
    let b: number;
    do {
      b = this.byte();
      n |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if (shift > 700n) throw new Error("candid: number too long");
    } while (b & 0x80);
    if (b & 0x40) n -= 1n << shift;
    return n;
  }
  len(): number {
    const n = this.uleb();
    if (n > BigInt(this.b.length)) throw new Error("candid: bad length");
    return Number(n);
  }
}

/** Decodes a whole Candid message into its argument values (records/variants keyed "#<field id>"). */
export function decode(bytes: Uint8Array): Decoded[] {
  const r = new Reader(bytes);
  if (new TextDecoder().decode(r.bytes(4)) !== "DIDL") throw new Error("candid: no magic");
  const n = r.len();
  const raw: { op: number; t?: number; fields?: [number, number][] }[] = [];
  for (let k = 0; k < n; k++) {
    const op = Number(r.sleb());
    if (op === -18 || op === -19) raw.push({ op, t: Number(r.sleb()) });
    else if (op === -20 || op === -21) {
      const count = r.len();
      const fields: [number, number][] = [];
      for (let f = 0; f < count; f++) fields.push([Number(r.uleb()), Number(r.sleb())]);
      raw.push({ op, fields });
    } else throw new Error(`candid: unsupported type ${op}`);
  }
  const argc = r.len();
  const args: number[] = [];
  for (let k = 0; k < argc; k++) args.push(Number(r.sleb()));
  const check = (t: number) => {
    if (t >= 0 && t >= raw.length) throw new Error("candid: bad type index");
  };
  raw.forEach((e) => (e.t !== undefined ? check(e.t) : e.fields?.forEach(([, t]) => check(t))));
  args.forEach(check);

  const value = (t: number, depth: number): Decoded => {
    if (depth > 100) throw new Error("candid: too deep");
    if (t < 0) {
      const k = PRIM_BY_OP.get(t);
      switch (k) {
        case "null":
          return null;
        case "bool":
          return r.byte() === 1;
        case "nat":
          return r.uleb();
        case "int":
          return r.sleb();
        case "nat8":
          return r.byte();
        case "nat64":
          return new DataView(r.bytes(8).buffer).getBigUint64(0, true);
        case "text":
          return new TextDecoder("utf-8", { fatal: true }).decode(r.bytes(r.len()));
        case "principal": {
          if (r.byte() !== 1) throw new Error("candid: opaque principal");
          return r.bytes(r.len());
        }
      }
      const size = SIZE_BY_OP.get(t);
      if (size !== undefined) {
        const b = r.bytes(size);
        let v = 0n;
        for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
        return v;
      }
      if (t === -16) return null; // reserved
      throw new Error(`candid: unsupported type ${t}`);
    }
    const e = raw[t]!;
    if (e.op === -18) return r.byte() === 1 ? [value(e.t!, depth + 1)] : [];
    if (e.op === -19) {
      const len = r.len();
      if (e.t === -5) return r.bytes(len);
      const out: Decoded[] = [];
      for (let k = 0; k < len; k++) out.push(value(e.t!, depth + 1));
      return out;
    }
    if (e.op === -20) {
      const out: Record<string, Decoded> = {};
      for (const [id, ft] of e.fields!) out[`#${id}`] = value(ft, depth + 1);
      return out;
    }
    const i = r.len();
    const f = e.fields![i];
    if (!f) throw new Error("candid: bad variant index");
    return { [`#${f[0]}`]: value(f[1], depth + 1) };
  };
  const out = args.map((t) => value(t, 0));
  if (r.i !== bytes.length) throw new Error("candid: trailing bytes");
  return out;
}

/** Maps "#<id>" keys of a decoded value back to the names `t` knows (unknown ones stay "#<id>"). Throws on a kind mismatch. */
export function named(t: CType, v: Decoded): CValue {
  switch (t.k) {
    case "nat":
    case "int":
    case "nat64":
      if (typeof v !== "bigint") throw new Error(`candid: expected ${t.k}`);
      return v;
    case "nat8":
      if (typeof v !== "number") throw new Error("candid: expected nat8");
      return v;
    case "text":
      if (typeof v !== "string") throw new Error("candid: expected text");
      return v;
    case "bool":
      if (typeof v !== "boolean") throw new Error("candid: expected bool");
      return v;
    case "null":
      return null;
    case "principal":
      if (!(v instanceof Uint8Array)) throw new Error("candid: expected principal");
      return v;
    case "opt":
      if (!Array.isArray(v)) throw new Error("candid: expected opt");
      return v.length ? [named(t.t, v[0]!)] : [];
    case "vec":
      if (t.t.k === "nat8") {
        if (!(v instanceof Uint8Array)) throw new Error("candid: expected blob");
        return v;
      }
      if (!Array.isArray(v)) throw new Error("candid: expected vec");
      return v.map((x) => named(t.t, x));
    case "record":
    case "variant": {
      if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof Uint8Array) throw new Error(`candid: expected ${t.k}`);
      const byId = new Map(Object.entries(t.fields).map(([n, ft]) => [`#${fieldId(n)}`, [n, ft] as const]));
      const out: Record<string, CValue> = {};
      for (const [k, x] of Object.entries(v)) {
        const f = byId.get(k);
        out[f ? f[0] : k] = f ? named(f[1], x) : (x as CValue);
      }
      if (t.k === "record") {
        for (const [n, ft] of Object.entries(t.fields)) {
          if (n in out) continue;
          if (ft.k === "opt") out[n] = [];
          else if (ft.k === "null") out[n] = null;
          else throw new Error(`candid: missing ${n}`);
        }
      }
      return out;
    }
  }
}
