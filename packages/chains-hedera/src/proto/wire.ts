/**
 * Protobuf wire format (https://protobuf.dev/programming-guides/encoding/), just what HAPI needs:
 * varints (int32/int64/uint32/uint64/bool/enum), zigzag sint64, length-delimited bytes/strings/messages and
 * packed repeated int64. int64 values are bigints.
 *
 * Writers follow protobufjs' generated encoders (what the Hiero SDK uses): fields go out in ascending field
 * number, and a field is written whenever its value is not undefined/null, even when it equals the proto3
 * default (0, false, ""). That is what makes our bytes identical to the SDK's.
 */

export const WIRE_VARINT = 0;
export const WIRE_I64 = 1;
export const WIRE_LEN = 2;
export const WIRE_I32 = 5;

const U64 = (1n << 64n) - 1n;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class Writer {
  private buf = new Uint8Array(64);
  private len = 0;

  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  private byte(b: number) {
    this.ensure(1);
    this.buf[this.len++] = b;
  }

  /** Unsigned varint of a value already in 0..2^64-1 (negative int64 must be masked first). */
  varint(v: bigint | number): this {
    let x = typeof v === "bigint" ? v : BigInt(v);
    if (x < 0n) x &= U64;
    while (x > 0x7fn) {
      this.byte(Number(x & 0x7fn) | 0x80);
      x >>= 7n;
    }
    this.byte(Number(x));
    return this;
  }

  tag(field: number, wire: number): this {
    return this.varint((field << 3) | wire);
  }

  raw(bytes: Uint8Array): this {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
    return this;
  }

  /** int64 / uint64 / enum / int32 (a negative int32 becomes a 10-byte varint, as protobufjs writes it). */
  int(field: number, v: bigint | number | null | undefined): this {
    if (v == null) return this;
    return this.tag(field, WIRE_VARINT).varint(v);
  }

  sint64(field: number, v: bigint | null | undefined): this {
    if (v == null) return this;
    return this.tag(field, WIRE_VARINT).varint(((v << 1n) ^ (v >> 63n)) & U64);
  }

  bool(field: number, v: boolean | null | undefined): this {
    if (v == null) return this;
    return this.tag(field, WIRE_VARINT).varint(v ? 1 : 0);
  }

  bytes(field: number, v: Uint8Array | null | undefined): this {
    if (v == null) return this;
    return this.tag(field, WIRE_LEN).varint(v.length).raw(v);
  }

  string(field: number, v: string | null | undefined): this {
    if (v == null) return this;
    return this.bytes(field, enc.encode(v));
  }

  /** Embedded message, already encoded. */
  message(field: number, v: Uint8Array | null | undefined): this {
    return this.bytes(field, v);
  }

  /** Packed repeated int64; nothing when empty (protobufjs skips empty repeated fields). */
  packed(field: number, values: readonly bigint[] | null | undefined): this {
    if (!values?.length) return this;
    const inner = new Writer();
    for (const v of values) inner.varint(v);
    return this.bytes(field, inner.finish());
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export class Reader {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    pos = 0,
    readonly end = buf.length,
  ) {
    this.pos = pos;
  }

  done(): boolean {
    return this.pos >= this.end;
  }

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.pos >= this.end) throw new Error("protobuf: truncated varint");
      const b = this.buf[this.pos++]!;
      result |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) break;
      shift += 7n;
      if (shift > 63n) throw new Error("protobuf: varint too long");
    }
    return result & U64;
  }

  tag(): [field: number, wire: number] {
    const t = Number(this.varint());
    const field = t >>> 3;
    if (field === 0) throw new Error("protobuf: field 0");
    return [field, t & 7];
  }

  bytes(): Uint8Array {
    const n = Number(this.varint());
    if (this.pos + n > this.end) throw new Error("protobuf: truncated bytes");
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  skip(wire: number) {
    switch (wire) {
      case WIRE_VARINT:
        this.varint();
        return;
      case WIRE_I64:
        this.pos += 8;
        break;
      case WIRE_LEN:
        this.bytes();
        return;
      case WIRE_I32:
        this.pos += 4;
        break;
      default:
        throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
    if (this.pos > this.end) throw new Error("protobuf: truncated field");
  }
}

/** Calls `f` for every field. Fields `f` doesn't consume are skipped. */
export function eachField(bytes: Uint8Array, f: (field: number, wire: number, r: Reader) => void): void {
  const r = new Reader(bytes);
  while (!r.done()) {
    const [field, wire] = r.tag();
    const at = r.pos;
    f(field, wire, r);
    if (r.pos === at) r.skip(wire);
  }
}

/** Raw (tag included) byte ranges of each top-level field, in order. */
export function rawFields(bytes: Uint8Array): { field: number; wire: number; raw: Uint8Array; value: Uint8Array | null }[] {
  const r = new Reader(bytes);
  const out: { field: number; wire: number; raw: Uint8Array; value: Uint8Array | null }[] = [];
  while (!r.done()) {
    const start = r.pos;
    const [field, wire] = r.tag();
    let value: Uint8Array | null = null;
    if (wire === WIRE_LEN) value = r.bytes();
    else r.skip(wire);
    out.push({ field, wire, raw: bytes.subarray(start, r.pos), value });
  }
  return out;
}

export const asInt64 = (v: bigint): bigint => BigInt.asIntN(64, v);
export const asInt32 = (v: bigint): number => Number(BigInt.asIntN(32, v));
export const unzigzag = (v: bigint): bigint => (v >> 1n) ^ -(v & 1n);
export const utf8 = (b: Uint8Array): string => dec.decode(b);

/** A scalar field read as varint, or each value of a packed run. */
export function readRepeatedVarint(wire: number, r: Reader, into: bigint[]) {
  if (wire === WIRE_LEN) {
    const b = r.bytes();
    const inner = new Reader(b);
    while (!inner.done()) into.push(asInt64(inner.varint()));
  } else into.push(asInt64(r.varint()));
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
