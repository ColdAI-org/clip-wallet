/**
 * BIP-173 bech32 (not bech32m), dependency-free so the page bundle and the background dispatcher can re-spell a
 * Cosmos account address with another chain's prefix (the 20 address bytes are the same on every chain of a key
 * family). Spec and reference: https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convert(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v < 0 || v >> from) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & max);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || (acc << (to - bits)) & max) return null;
  return out;
}

export function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = convert(data, 8, 5, true)!;
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

/** { prefix, data } for a valid lower-case bech32 string, else null. */
export function bech32Decode(value: string): { prefix: string; data: Uint8Array } | null {
  if (typeof value !== "string" || value.length > 90 || value !== value.toLowerCase()) return null;
  const sep = value.lastIndexOf("1");
  if (sep < 1 || sep + 7 > value.length) return null;
  const hrp = value.slice(0, sep);
  const words: number[] = [];
  for (const ch of value.slice(sep + 1)) {
    const w = CHARSET.indexOf(ch);
    if (w < 0) return null;
    words.push(w);
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) return null;
  const bytes = convert(words.slice(0, -6), 5, 8, false);
  return bytes ? { prefix: hrp, data: Uint8Array.from(bytes) } : null;
}

export const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function bytesOfHex(h: string): Uint8Array {
  const clean = h.replace(/^0x/, "");
  if (clean.length % 2 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error("not hex");
  return Uint8Array.from(clean.match(/../g) ?? [], (x) => parseInt(x, 16));
}
