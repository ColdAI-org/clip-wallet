import { sha224 } from "@noble/hashes/sha2.js";
import { base32nopad } from "@scure/base";
import { concat, fromHex, hex, utf8 } from "./util.js";

/**
 * Principals, ledger account identifiers and ICRC-1 account text (IC interface spec "Principals" / "Textual
 * representation of principals"; ICP ledger "Account identifiers"; ICRC-1 "Textual encoding of accounts":
 * https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/TextualEncoding.md).
 */

/** CRC-32 (IEEE, as zlib). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

/** Principal text: base32(CRC-32 ‖ bytes), lower case, groups of 5 joined by "-". */
export function principalToText(bytes: Uint8Array): string {
  const s = base32nopad.encode(concat(be32(crc32(bytes)), bytes)).toLowerCase();
  return s.match(/.{1,5}/g)!.join("-");
}

/** Principal bytes from text (checksum and grouping checked), or null. */
export function principalFromText(text: string): Uint8Array | null {
  const t = text.trim();
  if (!/^[a-z2-7]{1,5}(-[a-z2-7]{1,5})*$/.test(t)) return null;
  let raw: Uint8Array;
  try {
    raw = base32nopad.decode(t.replace(/-/g, "").toUpperCase());
  } catch {
    return null;
  }
  if (raw.length < 4 || raw.length > 33) return null;
  const bytes = raw.slice(4);
  if (principalToText(bytes) !== t) return null;
  return bytes;
}

/** The anonymous principal (0x04). */
export const ANONYMOUS = Uint8Array.of(4);

/** Self-authenticating principals end with 0x02 (29 bytes): what a key-backed account is. */
export function isSelfAuthenticating(bytes: Uint8Array): boolean {
  return bytes.length === 29 && bytes[28] === 0x02;
}

/** ICP ledger account identifier: CRC-32 ‖ SHA-224("\x0Aaccount-id" ‖ principal ‖ subaccount). */
export function accountIdentifier(principal: Uint8Array, subaccount: Uint8Array = new Uint8Array(32)): Uint8Array {
  if (subaccount.length !== 32) throw new Error("subaccount must be 32 bytes");
  const h = sha224(concat(Uint8Array.of(0x0a), utf8("account-id"), principal, subaccount));
  return concat(be32(crc32(h)), h);
}

/** A 64-hex account identifier with a valid checksum, as bytes, or null. */
export function accountIdFromHex(text: string): Uint8Array | null {
  const t = text.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const b = fromHex(t);
  const crc = (b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!;
  return crc >>> 0 === crc32(b.slice(4)) ? b : null;
}

export interface IcrcAccount {
  owner: Uint8Array;
  /** 32 bytes, or undefined for the default (all-zero) subaccount. */
  subaccount?: Uint8Array;
}

/** ICRC-1 account text: "<principal>" or "<principal>-<checksum>.<subaccount hex without leading zeros>". */
export function icrcAccountToText(a: IcrcAccount): string {
  const owner = principalToText(a.owner);
  if (!a.subaccount || a.subaccount.every((b) => b === 0)) return owner;
  const check = base32nopad.encode(be32(crc32(concat(a.owner, a.subaccount)))).toLowerCase();
  return `${owner}-${check}.${hex(a.subaccount).replace(/^0+/, "")}`;
}

export function icrcAccountFromText(text: string): IcrcAccount | null {
  const t = text.trim();
  const dot = t.lastIndexOf(".");
  if (dot < 0) {
    const owner = principalFromText(t);
    return owner ? { owner } : null;
  }
  const head = t.slice(0, dot);
  const subHex = t.slice(dot + 1);
  if (!/^[0-9a-f]{1,64}$/.test(subHex) || subHex.startsWith("0")) return null;
  const dash = head.lastIndexOf("-");
  if (dash < 0) return null;
  const owner = principalFromText(head.slice(0, dash));
  if (!owner) return null;
  const subaccount = fromHex(subHex.padStart(64, "0"));
  const a = { owner, subaccount };
  return icrcAccountToText(a) === t ? a : null;
}
