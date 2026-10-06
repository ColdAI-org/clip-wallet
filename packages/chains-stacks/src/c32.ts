import { sha256 } from "@noble/hashes/sha2.js";
import { bytesEqual, concat, hash160 } from "./util.js";

/**
 * c32check addresses (https://github.com/stacks-network/c32check, SIP-005 "Address"): "S" + c32(version) +
 * c32(hash160 ‖ SHA-256(SHA-256(version ‖ hash160))[0..4]). Crockford base32 alphabet, big-endian, leading zero
 * bytes kept as "0". Same encoding as the vault's `stacksAddress` (packages/vault/src/encodings87.ts).
 */
const C32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Single-signature (P2PKH) versions: 22 "SP" mainnet, 26 "ST" testnet. Multisig: 20 "SM", 21 "SN". */
export const VERSION = { mainnetSingle: 22, mainnetMulti: 20, testnetSingle: 26, testnetMulti: 21 } as const;
const MAINNET_VERSIONS = new Set<number>([VERSION.mainnetSingle, VERSION.mainnetMulti]);
const TESTNET_VERSIONS = new Set<number>([VERSION.testnetSingle, VERSION.testnetMulti]);

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

/** Inverse of c32encode for a known byte length (Crockford's O/I/L aliases accepted, as c32check does). */
export function c32decode(text: string, length: number): Uint8Array {
  const s = text.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  let n = 0n;
  for (const ch of s) {
    const v = C32.indexOf(ch);
    if (v < 0) throw new Error("not c32");
    n = (n << 5n) | BigInt(v);
  }
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) throw new Error("c32 value too large");
  // leading "0" characters must match leading zero bytes
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "0") zeros++;
  let zb = 0;
  while (zb < out.length && out[zb] === 0) zb++;
  if (zeros > zb) throw new Error("bad c32 padding");
  return out;
}

const checksum = (version: number, h: Uint8Array) => sha256(sha256(concat(new Uint8Array([version]), h))).subarray(0, 4);

export function c32address(version: number, h: Uint8Array): string {
  if (h.length !== 20 || version < 0 || version >= 32) throw new Error("bad c32 address input");
  return "S" + C32[version] + c32encode(concat(h, checksum(version, h)));
}

/** Parses a standard principal ("SP…"/"ST…"/"SM…"/"SN…"), checksum verified; null when it isn't one. */
export function parseAddress(value: string): { version: number; hash160: Uint8Array } | null {
  const v = value.trim();
  if (!/^S[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]{38,41}$/i.test(v)) return null;
  const version = C32.indexOf(v[1]!.toUpperCase());
  try {
    const body = c32decode(v.slice(2), 24);
    const h = body.subarray(0, 20);
    if (!bytesEqual(body.subarray(20), checksum(version, h))) return null;
    if (c32address(version, h) !== v.toUpperCase()) return null; // canonical spelling only
    return { version, hash160: h.slice() };
  } catch {
    return null;
  }
}

export type StacksNet = "mainnet" | "testnet";

export function netOfVersion(version: number): StacksNet | null {
  return MAINNET_VERSIONS.has(version) ? "mainnet" : TESTNET_VERSIONS.has(version) ? "testnet" : null;
}

export function singleSigVersion(net: StacksNet): number {
  return net === "mainnet" ? VERSION.mainnetSingle : VERSION.testnetSingle;
}

/** P2PKH address of a compressed secp256k1 key on `net`. */
export function addressOfKey(compressedKey: Uint8Array, net: StacksNet): string {
  if (compressedKey.length !== 33) throw new Error("Stacks needs a compressed secp256k1 public key");
  return c32address(singleSigVersion(net), hash160(compressedKey));
}

/** Contract names (SIP-005 / clarity `ContractName`): 1–40 chars, letter first, then letters, digits, "-" or "_". */
export const CONTRACT_NAME = /^[a-zA-Z]([a-zA-Z0-9]|[-_])*$/;

/** Clarity names (functions, assets, tuple keys; clarity `ClarityName`), at most 128 characters. */
export const CLARITY_NAME = /^([a-zA-Z]([a-zA-Z0-9]|[-_!?+<>=/*])*|[-+=/*]|[<>]=?)$/;

/** "SP….name" → parts; null unless the address is valid and the name well formed. */
export function parseContractId(value: string): { address: string; version: number; hash160: Uint8Array; name: string } | null {
  const [addr, name, ...rest] = value.trim().split(".");
  if (!addr || !name || rest.length || name.length > 128 || !CONTRACT_NAME.test(name)) return null;
  const a = parseAddress(addr);
  return a ? { address: addr.toUpperCase(), ...a, name } : null;
}

/** "SP….contract::asset-name" (SIP-030 `asset`). */
export function parseAssetId(value: string): { contract: string; address: string; version: number; hash160: Uint8Array; contractName: string; assetName: string } | null {
  const [contract, assetName, ...rest] = value.trim().split("::");
  if (!contract || !assetName || rest.length || assetName.length > 128 || !CLARITY_NAME.test(assetName)) return null;
  const c = parseContractId(contract);
  return c ? { contract: `${c.address}.${c.name}`, address: c.address, version: c.version, hash160: c.hash160, contractName: c.name, assetName } : null;
}
