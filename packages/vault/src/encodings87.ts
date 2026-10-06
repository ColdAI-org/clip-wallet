/**
 * Address encodings for the networks87 families (Cosmos SDK chains, TRON, XRP Ledger, Antelope, MultiversX, ICP,
 * Stacks, Fuel, Bitcoin Cash). Public-key maths only (no secrets), so `Account.address` can be filled without
 * importing chain modules. Each is cross-checked against the family's official SDK in test/families87.test.ts.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha224, sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base32nopad, base58, base58xrp, bech32, createBase58check } from "@scure/base";
import { concat, toHex, utf8 } from "./bytes.js";

const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));

function compressed(publicKey: Uint8Array, what: string): Uint8Array {
  if (publicKey.length !== 33 && publicKey.length !== 65) throw new Error(`${what} needs a secp256k1 public key`);
  return secp256k1.Point.fromBytes(publicKey).toBytes(true);
}

function uncompressed(publicKey: Uint8Array, what: string): Uint8Array {
  if (publicKey.length !== 33 && publicKey.length !== 65) throw new Error(`${what} needs a secp256k1 public key`);
  return secp256k1.Point.fromBytes(publicKey).toBytes(false);
}

/** The 20 bytes an Ethereum-style key hashes to: keccak256(uncompressed x ‖ y)[12..]. */
export function ethAddressBytes(publicKey: Uint8Array): Uint8Array {
  return keccak_256(uncompressed(publicKey, "ethsecp256k1").subarray(1)).subarray(12);
}

/* ------------------------------------------------------------------ Cosmos SDK */

/**
 * Cosmos SDK secp256k1 account: bech32(prefix, RIPEMD-160(SHA-256(compressed key))) (ADR-028 legacy accounts,
 * cosmjs `pubkeyToAddress`). Prefixes: cosmos, osmo, dydx, zig, pb / tp (Provenance), thor.
 */
export function cosmosAddress(publicKey: Uint8Array, prefix: string): string {
  return bech32.encode(prefix, bech32.toWords(hash160(compressed(publicKey, "cosmos"))));
}

/** Initia (ethsecp256k1, coin type 60): bech32("init", keccak256(uncompressed)[12..]), the EVM address's bytes. */
export function initiaAddress(publicKey: Uint8Array, prefix = "init"): string {
  return bech32.encode(prefix, bech32.toWords(ethAddressBytes(publicKey)));
}

/* ------------------------------------------------------------------ TRON */

const b58check = createBase58check(sha256);

/** TRON: base58check(0x41 ‖ keccak256(uncompressed)[12..]), "T…" (https://developers.tron.network/docs/account). */
export function tronAddress(publicKey: Uint8Array): string {
  return b58check.encode(concat(new Uint8Array([0x41]), ethAddressBytes(publicKey)));
}

/* ------------------------------------------------------------------ XRP Ledger */

/**
 * XRPL classic address: base58 (Ripple alphabet) check of 0x00 ‖ RIPEMD-160(SHA-256(compressed key)), checksum the
 * first 4 bytes of double SHA-256 (https://xrpl.org/docs/concepts/accounts/addresses).
 */
export function xrplAddress(publicKey: Uint8Array): string {
  const payload = concat(new Uint8Array([0x00]), hash160(compressed(publicKey, "xrpl")));
  return base58xrp.encode(concat(payload, sha256(sha256(payload)).subarray(0, 4)));
}

/* ------------------------------------------------------------------ Antelope */

/**
 * Antelope (Vaulta, Telos, XPR Network) K1 public key in the current format: "PUB_K1_" + base58(key ‖
 * RIPEMD-160(key ‖ "K1")[0..4]) (Spring/Leap fc `public_key_type`, WharfKit `PublicKey.toString()`).
 */
export function antelopePublicKey(publicKey: Uint8Array): string {
  const key = compressed(publicKey, "antelope");
  return "PUB_K1_" + base58.encode(concat(key, ripemd160(concat(key, utf8("K1"))).subarray(0, 4)));
}

/** The legacy "EOS…" spelling of the same key (base58(key ‖ RIPEMD-160(key)[0..4])). */
export function antelopeLegacyPublicKey(publicKey: Uint8Array, prefix = "EOS"): string {
  const key = compressed(publicKey, "antelope");
  return prefix + base58.encode(concat(key, ripemd160(key).subarray(0, 4)));
}

/* ------------------------------------------------------------------ MultiversX */

/** MultiversX: bech32("erd", Ed25519 public key) (https://docs.multiversx.com/developers/data/addresses). */
export function multiversxAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("multiversx needs a 32-byte Ed25519 key");
  return bech32.encode("erd", bech32.toWords(publicKey));
}

/* ------------------------------------------------------------------ Internet Computer */

/** DER SubjectPublicKeyInfo of an uncompressed secp256k1 key (id-ecPublicKey, secp256k1), as @dfinity/identity-secp256k1. */
export function icpDerPublicKey(publicKey: Uint8Array): Uint8Array {
  const prefix = Uint8Array.from([
    0x30, 0x56, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x42, 0x00,
  ]);
  return concat(prefix, uncompressed(publicKey, "icp"));
}

/** Self-authenticating principal bytes: SHA-224(DER key) ‖ 0x02 (IC interface spec, "Principals"). */
export function icpPrincipalBytes(publicKey: Uint8Array): Uint8Array {
  return concat(sha224(icpDerPublicKey(publicKey)), new Uint8Array([0x02]));
}

/** CRC-32 (IEEE, as zlib). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);

/** Principal text: base32(CRC-32 ‖ bytes), lower case, groups of 5 joined by "-". */
export function icpPrincipalText(bytes: Uint8Array): string {
  const s = base32nopad.encode(concat(be32(crc32(bytes)), bytes)).toLowerCase();
  return s.match(/.{1,5}/g)!.join("-");
}

/** The account's principal as text (what Plug, NNS and the ICRC-1 ledgers show). */
export function icpPrincipal(publicKey: Uint8Array): string {
  return icpPrincipalText(icpPrincipalBytes(publicKey));
}

/** ICP ledger account identifier (hex): CRC-32 ‖ SHA-224("\x0Aaccount-id" ‖ principal ‖ subaccount). */
export function icpAccountIdentifier(principal: Uint8Array, subaccount: Uint8Array = new Uint8Array(32)): string {
  if (subaccount.length !== 32) throw new Error("subaccount must be 32 bytes");
  const h = sha224(concat(new Uint8Array([0x0a]), utf8("account-id"), principal, subaccount));
  return toHex(concat(be32(crc32(h)), h));
}

/* ------------------------------------------------------------------ Stacks */

const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Crockford base32 as c32check uses it (big-endian, leading zero bytes kept as leading "0"s). */
export function c32encode(data: Uint8Array): string {
  let n = 0n;
  for (const b of data) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = C32[Number(n & 31n)]! + out;
    n >>= 5n;
  }
  let zeros = 0;
  while (zeros < data.length && data[zeros] === 0) zeros++;
  return "0".repeat(zeros) + out;
}

/** Stacks address versions: 22 "SP" mainnet single-sig, 26 "ST" testnet single-sig. */
export const STACKS_VERSION = { mainnet: 22, testnet: 26 } as const;

/** c32check address: "S" + c32(version) + c32(hash160 ‖ SHA-256²(version ‖ hash160)[0..4]) (SIP-005, c32check). */
export function c32address(version: number, hash: Uint8Array): string {
  if (hash.length !== 20 || version < 0 || version >= 32) throw new Error("bad c32 address input");
  const check = sha256(sha256(concat(new Uint8Array([version]), hash))).subarray(0, 4);
  return "S" + C32[version] + c32encode(concat(hash, check));
}

/** Stacks single-signature (P2PKH) address of a compressed key. */
export function stacksAddress(publicKey: Uint8Array, network: "mainnet" | "testnet" = "mainnet"): string {
  return c32address(STACKS_VERSION[network], hash160(compressed(publicKey, "stacks")));
}

/* ------------------------------------------------------------------ Fuel */

/**
 * Fuel: the address is SHA-256 of the uncompressed key without its 0x04 prefix (64 bytes), shown as 0x-hex with
 * the checksum fuels-ts applies (`Address.toChecksum`: a hex digit is upper case where the matching nibble of
 * SHA-256 of the lower-case hex TEXT without "0x" (its UTF-8 bytes) is ≥ 8).
 */
export function fuelAddressBytes(publicKey: Uint8Array): Uint8Array {
  return sha256(uncompressed(publicKey, "fuel").subarray(1));
}

export function fuelChecksum(hex: string): string {
  const lower = hex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(lower)) throw new Error("fuel addresses are 32 bytes");
  const h = sha256(utf8(lower));
  let out = "0x";
  for (let i = 0; i < 32; i++) {
    const byte = h[i]!;
    const hi = lower[i * 2]!;
    const lo = lower[i * 2 + 1]!;
    out += byte >> 4 >= 8 ? hi.toUpperCase() : hi;
    out += (byte & 0x0f) >= 8 ? lo.toUpperCase() : lo;
  }
  return out;
}

export function fuelAddress(publicKey: Uint8Array): string {
  return fuelChecksum(toHex(fuelAddressBytes(publicKey)));
}

/* ------------------------------------------------------------------ Bitcoin Cash */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function cashPolymod(values: number[]): bigint {
  const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= GEN[i]!;
  }
  return c ^ 1n;
}

function toWords5(data: Uint8Array): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of data) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

/**
 * CashAddr (https://reference.cash/protocol/blockchain/encoding/cashaddr): prefix ":" + base32(version byte ‖ hash
 * ‖ 40-bit BCH checksum). type 0 = P2PKH, 1 = P2SH; 20-byte hashes only.
 */
export function cashAddress(prefix: string, type: 0 | 1, hash: Uint8Array): string {
  if (hash.length !== 20) throw new Error("cashaddr hashes are 20 bytes here");
  const payload = toWords5(concat(new Uint8Array([type << 3]), hash));
  const prefixWords = [...prefix].map((ch) => ch.charCodeAt(0) & 31);
  const mod = cashPolymod([...prefixWords, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const check: number[] = [];
  for (let i = 0; i < 8; i++) check.push(Number((mod >> BigInt(5 * (7 - i))) & 31n));
  return `${prefix}:${[...payload, ...check].map((w) => CHARSET[w]).join("")}`;
}

/** Bitcoin Cash P2PKH of a compressed key: "bitcoincash:q…" (mainnet) or "bchtest:q…" (testnet / chipnet). */
export function bitcoincashAddress(publicKey: Uint8Array, network: "mainnet" | "testnet" = "mainnet"): string {
  return cashAddress(network === "mainnet" ? "bitcoincash" : "bchtest", 0, hash160(compressed(publicKey, "bitcoincash")));
}
