/**
 * The CBOR subset the IC HTTPS interface uses (RFC 8949; IC interface spec "CBOR"): unsigned integers, byte and text
 * strings, arrays, maps with text keys, and the self-describing tag 55799 the IC puts in front of every message.
 * Requests are encoded with the tag and definite lengths; replies are decoded with or without the tag, and with
 * definite or indefinite-length arrays and maps (boundary nodes answer queries with an indefinite map). No floats.
 */
export type CborValue = bigint | number | string | Uint8Array | CborValue[] | CborMap | null | boolean;
export interface CborMap {
  [key: string]: CborValue;
}

const SELF_DESCRIBE = Uint8Array.of(0xd9, 0xd9, 0xf7);

function head(major: number, n: bigint): Uint8Array {
  const m = major << 5;
  if (n < 24n) return Uint8Array.of(m | Number(n));
  if (n < 0x100n) return Uint8Array.of(m | 24, Number(n));
  if (n < 0x10000n) return Uint8Array.of(m | 25, Number(n >> 8n), Number(n & 0xffn));
  if (n < 0x100000000n) {
    const out = new Uint8Array(5);
    out[0] = m | 26;
    new DataView(out.buffer).setUint32(1, Number(n));
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = m | 27;
  new DataView(out.buffer).setBigUint64(1, n);
  return out;
}

function enc(v: CborValue, parts: Uint8Array[]): void {
  if (typeof v === "bigint" || typeof v === "number") {
    const n = BigInt(v);
    if (n < 0n) throw new Error("cbor: negative numbers aren't used");
    parts.push(head(0, n));
  } else if (v instanceof Uint8Array) {
    parts.push(head(2, BigInt(v.length)), v);
  } else if (typeof v === "string") {
    const b = new TextEncoder().encode(v);
    parts.push(head(3, BigInt(b.length)), b);
  } else if (Array.isArray(v)) {
    parts.push(head(4, BigInt(v.length)));
    for (const x of v) enc(x, parts);
  } else if (v === null) {
    parts.push(Uint8Array.of(0xf6));
  } else if (typeof v === "boolean") {
    parts.push(Uint8Array.of(v ? 0xf5 : 0xf4));
  } else {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    parts.push(head(5, BigInt(keys.length)));
    for (const k of keys) {
      enc(k, parts);
      enc(v[k]!, parts);
    }
  }
}

/** Encodes with the self-describing tag 55799 in front, as the IC (and @dfinity/agent) send it. */
export function cborEncode(v: CborValue): Uint8Array {
  const parts: Uint8Array[] = [SELF_DESCRIBE];
  enc(v, parts);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function cborDecode(bytes: Uint8Array): CborValue {
  let i = 0;
  const need = (n: number) => {
    if (i + n > bytes.length) throw new Error("cbor: truncated");
  };
  const arg = (info: number): bigint => {
    if (info < 24) return BigInt(info);
    const len = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (len < 0) throw new Error("cbor: unsupported length");
    need(len);
    let n = 0n;
    for (let k = 0; k < len; k++) n = (n << 8n) | BigInt(bytes[i++]!);
    return n;
  };
  const item = (depth: number): CborValue => {
    if (depth > 64) throw new Error("cbor: too deep");
    need(1);
    const b = bytes[i++]!;
    const major = b >> 5;
    const info = b & 31;
    switch (major) {
      case 0:
        return arg(info);
      case 2:
      case 3: {
        const len = Number(arg(info));
        need(len);
        const s = bytes.slice(i, i + len);
        i += len;
        return major === 2 ? s : new TextDecoder("utf-8", { fatal: true }).decode(s);
      }
      case 4: {
        if (info === 31) {
          const out: CborValue[] = [];
          while ((need(1), bytes[i] !== 0xff)) out.push(item(depth + 1));
          i++;
          return out;
        }
        const len = Number(arg(info));
        if (len > bytes.length) throw new Error("cbor: bad array");
        const out: CborValue[] = [];
        for (let k = 0; k < len; k++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        if (info === 31) {
          const out: CborMap = {};
          while ((need(1), bytes[i] !== 0xff)) {
            const key = item(depth + 1);
            if (typeof key !== "string") throw new Error("cbor: map keys must be text");
            out[key] = item(depth + 1);
          }
          i++;
          return out;
        }
        const len = Number(arg(info));
        if (len > bytes.length) throw new Error("cbor: bad map");
        const out: CborMap = {};
        for (let k = 0; k < len; k++) {
          const key = item(depth + 1);
          if (typeof key !== "string") throw new Error("cbor: map keys must be text");
          out[key] = item(depth + 1);
        }
        return out;
      }
      case 6:
        arg(info); // tag (55799 self-describe, or others): the tagged item follows
        return item(depth + 1);
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        throw new Error("cbor: unsupported simple value");
      default:
        throw new Error("cbor: negative integers aren't used");
    }
  };
  const v = item(0);
  if (i !== bytes.length) throw new Error("cbor: trailing bytes");
  return v;
}
