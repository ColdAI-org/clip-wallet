/**
 * Minimal CBOR (RFC 8949) codec for Cardano transactions.
 *
 * Why hand-written: the transaction body hash must be computed over the body's ORIGINAL bytes, and signed
 * transactions must be reassembled without re-encoding the body or auxiliary data. Generic decoders lose that.
 * `readItem` returns the value AND the byte span it came from; `splitArray` / `splitMap` expose raw element
 * slices. Supports every major type, indefinite lengths, tags and bignums (tags 2/3).
 */

export class CborTag {
  constructor(
    public readonly tag: number,
    public readonly value: CborValue,
  ) {}
}

/** Map with arbitrary (non-string) keys, insertion ordered. */
export class CborMap {
  constructor(public readonly entries: [CborValue, CborValue][] = []) {}
  get(key: number | string): CborValue | undefined {
    for (const [k, v] of this.entries) if (k === key || (typeof k === "bigint" && typeof key === "number" && k === BigInt(key))) return v;
    return undefined;
  }
  has(key: number | string): boolean {
    return this.get(key) !== undefined;
  }
}

export class CborSimple {
  constructor(public readonly value: number) {}
}

/** Pre-encoded CBOR, written as-is by `encode`. */
export class CborRaw {
  constructor(public readonly bytes: Uint8Array) {}
}

export type CborValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | CborValue[]
  | CborMap
  | CborTag
  | CborSimple
  | CborRaw;

export class CborError extends Error {}

const td = new TextDecoder("utf-8", { fatal: true });
const te = new TextEncoder();
const MAX_DEPTH = 64;

function readArg(b: Uint8Array, pos: number, info: number): { arg: bigint | null; pos: number } {
  if (info < 24) return { arg: BigInt(info), pos };
  const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : info === 31 ? -1 : -2;
  if (n === -1) return { arg: null, pos };
  if (n === -2) throw new CborError(`reserved additional info ${info}`);
  if (pos + n > b.length) throw new CborError("truncated");
  let v = 0n;
  for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(b[pos + i]!);
  return { arg: v, pos: pos + n };
}

const small = (v: bigint): number | bigint => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);

function count(v: bigint, remaining: number): number {
  if (v > BigInt(remaining)) throw new CborError("length exceeds input");
  return Number(v);
}

/** Decode one item at `pos`. Returns the value and the offset just past it. */
export function readItem(b: Uint8Array, pos = 0, depth = 0): { value: CborValue; end: number } {
  if (depth > MAX_DEPTH) throw new CborError("nesting too deep");
  if (pos >= b.length) throw new CborError("truncated");
  const ib = b[pos]!;
  const major = ib >> 5;
  const info = ib & 31;
  let { arg, pos: p } = readArg(b, pos + 1, info);
  switch (major) {
    case 0:
      if (arg === null) throw new CborError("indefinite uint");
      return { value: small(arg), end: p };
    case 1:
      if (arg === null) throw new CborError("indefinite nint");
      return { value: small(-1n - arg) as number | bigint, end: p };
    case 2:
    case 3: {
      let bytes: Uint8Array;
      if (arg === null) {
        const parts: Uint8Array[] = [];
        while (b[p] !== 0xff) {
          if (p >= b.length) throw new CborError("truncated");
          const c = readItem(b, p, depth + 1);
          if (major === 2 && !(c.value instanceof Uint8Array)) throw new CborError("bad chunk");
          if (major === 3 && typeof c.value !== "string") throw new CborError("bad chunk");
          parts.push(major === 2 ? (c.value as Uint8Array) : te.encode(c.value as string));
          p = c.end;
        }
        p++;
        bytes = concat(parts);
      } else {
        const n = count(arg, b.length - p);
        bytes = b.slice(p, p + n);
        p += n;
      }
      if (major === 2) return { value: bytes, end: p };
      try {
        return { value: td.decode(bytes), end: p };
      } catch {
        throw new CborError("invalid utf-8 text");
      }
    }
    case 4: {
      const out: CborValue[] = [];
      if (arg === null) {
        while (b[p] !== 0xff) {
          const c = readItem(b, p, depth + 1);
          out.push(c.value);
          p = c.end;
        }
        return { value: out, end: p + 1 };
      }
      const n = count(arg, b.length - p);
      for (let i = 0; i < n; i++) {
        const c = readItem(b, p, depth + 1);
        out.push(c.value);
        p = c.end;
      }
      return { value: out, end: p };
    }
    case 5: {
      const m = new CborMap();
      const one = () => {
        const k = readItem(b, p, depth + 1);
        const v = readItem(b, k.end, depth + 1);
        m.entries.push([k.value, v.value]);
        p = v.end;
      };
      if (arg === null) {
        while (b[p] !== 0xff) one();
        return { value: m, end: p + 1 };
      }
      const n = count(arg, b.length - p);
      for (let i = 0; i < n; i++) one();
      return { value: m, end: p };
    }
    case 6: {
      if (arg === null) throw new CborError("indefinite tag");
      const c = readItem(b, p, depth + 1);
      if ((arg === 2n || arg === 3n) && c.value instanceof Uint8Array) {
        let v = 0n;
        for (const x of c.value) v = (v << 8n) | BigInt(x);
        return { value: arg === 2n ? v : -1n - v, end: c.end };
      }
      return { value: new CborTag(Number(arg), c.value), end: c.end };
    }
    default: {
      if (info === 20) return { value: false, end: p };
      if (info === 21) return { value: true, end: p };
      if (info === 22) return { value: null, end: p };
      if (info === 23) return { value: undefined, end: p };
      if (info === 25 || info === 26 || info === 27) {
        const n = info === 25 ? 2 : info === 26 ? 4 : 8;
        const dv = new DataView(b.buffer, b.byteOffset + pos + 1, n);
        const f = n === 2 ? halfToFloat(dv.getUint16(0)) : n === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
        return { value: f, end: p };
      }
      if (arg === null) throw new CborError("unexpected break");
      return { value: new CborSimple(Number(arg)), end: p };
    }
  }
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Decode a complete item; trailing bytes are an error. */
export function decode(b: Uint8Array): CborValue {
  const { value, end } = readItem(b, 0);
  if (end !== b.length) throw new CborError("trailing bytes");
  return value;
}

/** Raw byte slices of the elements of a top-level array (definite or indefinite). */
export function splitArray(b: Uint8Array, pos = 0): { items: Uint8Array[]; end: number } {
  const ib = b[pos];
  if (ib === undefined || ib >> 5 !== 4) throw new CborError("not an array");
  let { arg, pos: p } = readArg(b, pos + 1, ib & 31);
  const items: Uint8Array[] = [];
  if (arg === null) {
    while (b[p] !== 0xff) {
      if (p >= b.length) throw new CborError("truncated");
      const c = readItem(b, p, 1);
      items.push(b.subarray(p, c.end));
      p = c.end;
    }
    return { items, end: p + 1 };
  }
  const n = count(arg, b.length - p);
  for (let i = 0; i < n; i++) {
    const c = readItem(b, p, 1);
    items.push(b.subarray(p, c.end));
    p = c.end;
  }
  return { items, end: p };
}

/** Raw [key, value] slices of a top-level map. */
export function splitMap(b: Uint8Array, pos = 0): { entries: [Uint8Array, Uint8Array][]; end: number } {
  const ib = b[pos];
  if (ib === undefined || ib >> 5 !== 5) throw new CborError("not a map");
  let { arg, pos: p } = readArg(b, pos + 1, ib & 31);
  const entries: [Uint8Array, Uint8Array][] = [];
  const one = () => {
    const k = readItem(b, p, 1);
    const v = readItem(b, k.end, 1);
    entries.push([b.subarray(p, k.end), b.subarray(k.end, v.end)]);
    p = v.end;
  };
  if (arg === null) {
    while (b[p] !== 0xff) {
      if (p >= b.length) throw new CborError("truncated");
      one();
    }
    return { entries, end: p + 1 };
  }
  const n = count(arg, b.length - p);
  for (let i = 0; i < n; i++) one();
  return { entries, end: p };
}

/* ------------------------------------------------------------------ encoding */

function head(major: number, v: bigint | number): Uint8Array {
  const n = BigInt(v);
  const m = major << 5;
  if (n < 24n) return Uint8Array.of(m | Number(n));
  if (n < 0x100n) return Uint8Array.of(m | 24, Number(n));
  if (n < 0x10000n) return Uint8Array.of(m | 25, Number(n >> 8n), Number(n & 0xffn));
  if (n < 0x100000000n) {
    const o = new Uint8Array(5);
    o[0] = m | 26;
    new DataView(o.buffer).setUint32(1, Number(n));
    return o;
  }
  if (n < 0x10000000000000000n) {
    const o = new Uint8Array(9);
    o[0] = m | 27;
    new DataView(o.buffer).setBigUint64(1, n);
    return o;
  }
  throw new CborError("integer too large");
}

function bigBytes(v: bigint): Uint8Array {
  const out: number[] = [];
  while (v > 0n) {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Uint8Array.from(out);
}

export function encode(v: CborValue): Uint8Array {
  const parts: Uint8Array[] = [];
  const w = (x: CborValue): void => {
    if (x instanceof CborRaw) parts.push(x.bytes);
    else if (typeof x === "number") {
      if (!Number.isInteger(x)) throw new CborError("floats are not encoded");
      w(BigInt(x));
    } else if (typeof x === "bigint") {
      if (x >= 0n) {
        if (x < 0x10000000000000000n) parts.push(head(0, x));
        else parts.push(head(6, 2), head(2, bigBytes(x).length), bigBytes(x));
      } else {
        const n = -1n - x;
        if (n < 0x10000000000000000n) parts.push(head(1, n));
        else parts.push(head(6, 3), head(2, bigBytes(n).length), bigBytes(n));
      }
    } else if (typeof x === "string") {
      const b = te.encode(x);
      parts.push(head(3, b.length), b);
    } else if (x instanceof Uint8Array) parts.push(head(2, x.length), x);
    else if (Array.isArray(x)) {
      parts.push(head(4, x.length));
      x.forEach(w);
    } else if (x instanceof CborMap) {
      parts.push(head(5, x.entries.length));
      for (const [k, val] of x.entries) {
        w(k);
        w(val);
      }
    } else if (x instanceof CborTag) {
      parts.push(head(6, x.tag));
      w(x.value);
    } else if (x instanceof CborSimple) parts.push(head(7, x.value));
    else if (x === false) parts.push(Uint8Array.of(0xf4));
    else if (x === true) parts.push(Uint8Array.of(0xf5));
    else if (x === null) parts.push(Uint8Array.of(0xf6));
    else if (x === undefined) parts.push(Uint8Array.of(0xf7));
    else throw new CborError("unsupported value");
  };
  w(v);
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ small typed accessors */

export const asInt = (v: CborValue): bigint | null => (typeof v === "number" && Number.isInteger(v) ? BigInt(v) : typeof v === "bigint" ? v : null);
export const asBytes = (v: CborValue): Uint8Array | null => (v instanceof Uint8Array ? v : null);
/** Cardano sets: `#6.258([* a])` or a plain array. */
export const asList = (v: CborValue): CborValue[] | null =>
  Array.isArray(v) ? v : v instanceof CborTag && v.tag === 258 && Array.isArray(v.value) ? v.value : null;
