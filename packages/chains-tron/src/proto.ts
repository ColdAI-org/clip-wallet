/**
 * The little protobuf (proto3 wire format) TRON transactions need: varints (int32/int64/bool/enum) and
 * length-delimited fields (bytes, strings, messages). https://protobuf.dev/programming-guides/encoding/
 * int64 fields are two's complement 64-bit varints; negative values never appear in what Clip builds.
 */

export type Field = { no: number; wire: 0; value: bigint } | { no: number; wire: 2; value: Uint8Array };

export class ProtoError extends Error {}

export function readFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = (): bigint => {
    let shift = 0n;
    let v = 0n;
    for (let n = 0; n < 10; n++) {
      if (i >= buf.length) throw new ProtoError("truncated varint");
      const b = buf[i++]!;
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
      shift += 7n;
    }
    throw new ProtoError("varint too long");
  };
  while (i < buf.length) {
    const key = varint();
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (no < 1) throw new ProtoError("bad field number");
    if (wire === 0) out.push({ no, wire, value: varint() });
    else if (wire === 2) {
      const len = Number(varint());
      if (len < 0 || i + len > buf.length) throw new ProtoError("truncated field");
      out.push({ no, wire, value: buf.subarray(i, i + len) });
      i += len;
    } else throw new ProtoError(`unsupported wire type ${wire}`); // no TRON transaction field is fixed32/fixed64
  }
  return out;
}

/** int64 as protobuf stores it (two's complement over 64 bits). */
export const int64 = (v: bigint): bigint => BigInt.asIntN(64, v);

export class Fields {
  constructor(readonly list: Field[]) {}
  static parse(buf: Uint8Array): Fields {
    return new Fields(readFields(buf));
  }
  /** Last occurrence wins, as protobuf parsers do. */
  private last(no: number): Field | undefined {
    for (let k = this.list.length - 1; k >= 0; k--) if (this.list[k]!.no === no) return this.list[k];
    return undefined;
  }
  int(no: number): bigint {
    const f = this.last(no);
    if (!f) return 0n;
    if (f.wire !== 0) throw new ProtoError(`field ${no} is not a varint`);
    return int64(f.value);
  }
  bool(no: number): boolean {
    return this.int(no) !== 0n;
  }
  bytes(no: number): Uint8Array {
    const f = this.last(no);
    if (!f) return new Uint8Array();
    if (f.wire !== 2) throw new ProtoError(`field ${no} is not length-delimited`);
    return f.value;
  }
  string(no: number): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(no));
  }
  repeated(no: number): Uint8Array[] {
    return this.list.filter((f) => f.no === no).map((f) => {
      if (f.wire !== 2) throw new ProtoError(`field ${no} is not length-delimited`);
      return f.value;
    });
  }
  has(no: number): boolean {
    return this.list.some((f) => f.no === no);
  }
  /** Field numbers present that aren't in `known`. */
  unknown(known: readonly number[]): number[] {
    return [...new Set(this.list.map((f) => f.no))].filter((n) => !known.includes(n));
  }
}

/* ------------------------------------------------------------------ writer */

function varintBytes(v: bigint): number[] {
  let x = BigInt.asUintN(64, v);
  const out: number[] = [];
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x > 0n) b |= 0x80;
    out.push(b);
  } while (x > 0n);
  return out;
}

export class Writer {
  private parts: number[] = [];
  /** Varint field; proto3 omits zero values. */
  int(no: number, v: bigint | number | boolean): this {
    const x = typeof v === "boolean" ? (v ? 1n : 0n) : BigInt(v);
    if (x === 0n) return this;
    this.parts.push(...varintBytes(BigInt((no << 3) | 0)), ...varintBytes(x));
    return this;
  }
  /** Length-delimited field; proto3 omits empty values. */
  bytes(no: number, v: Uint8Array | undefined): this {
    if (!v || v.length === 0) return this;
    this.parts.push(...varintBytes(BigInt((no << 3) | 2)), ...varintBytes(BigInt(v.length)));
    for (const b of v) this.parts.push(b);
    return this;
  }
  /** Embedded message: written even when empty (presence matters for messages). */
  message(no: number, v: Uint8Array): this {
    this.parts.push(...varintBytes(BigInt((no << 3) | 2)), ...varintBytes(BigInt(v.length)));
    for (const b of v) this.parts.push(b);
    return this;
  }
  string(no: number, v: string): this {
    return this.bytes(no, new TextEncoder().encode(v));
  }
  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

export function varintLength(n: number): number {
  return varintBytes(BigInt(n)).length;
}
