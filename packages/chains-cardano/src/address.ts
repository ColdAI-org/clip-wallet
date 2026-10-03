/**
 * Cardano addresses (CIP-19) and bech32 prefixes (CIP-5).
 *
 * Header nibble (high 4 bits): 0-3 base, 4-5 pointer, 6-7 enterprise, 8 Byron, 14-15 reward.
 * Low 4 bits: network id (0 testnets, 1 mainnet). Credentials are 28-byte blake2b-224 hashes.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { base58, bech32 } from "@scure/base";
import { fromHex, hex, isHex } from "./util.js";

export type Credential = { kind: "key" | "script"; hash: Uint8Array };

export interface ParsedAddress {
  bytes: Uint8Array;
  type: number;
  kind: "base" | "pointer" | "enterprise" | "reward" | "byron";
  networkId: number;
  payment?: Credential;
  stake?: Credential;
}

export const keyHash = (publicKey: Uint8Array): Uint8Array => blake2b(publicKey, { dkLen: 28 });

export function parseAddressBytes(bytes: Uint8Array): ParsedAddress {
  if (bytes.length === 0) throw new Error("empty address");
  const header = bytes[0]!;
  const type = header >> 4;
  const networkId = header & 0x0f;
  const cred = (script: boolean, from: number): Credential => {
    const hash = bytes.slice(from, from + 28);
    if (hash.length !== 28) throw new Error("short address");
    return { kind: script ? "script" : "key", hash };
  };
  if (type <= 3) {
    if (bytes.length !== 57) throw new Error("bad base address length");
    return { bytes, type, kind: "base", networkId, payment: cred((type & 1) === 1, 1), stake: cred((type & 2) === 2, 29) };
  }
  if (type === 4 || type === 5) return { bytes, type, kind: "pointer", networkId, payment: cred(type === 5, 1) };
  if (type === 6 || type === 7) {
    if (bytes.length !== 29) throw new Error("bad enterprise address length");
    return { bytes, type, kind: "enterprise", networkId, payment: cred(type === 7, 1) };
  }
  if (type === 14 || type === 15) {
    if (bytes.length !== 29) throw new Error("bad reward address length");
    return { bytes, type, kind: "reward", networkId, stake: cred(type === 15, 1) };
  }
  if (type === 8) return { bytes, type, kind: "byron", networkId: -1 };
  throw new Error(`unknown address type ${type}`);
}

/** Accepts bech32 (addr…, stake…), Byron base58, or hex bytes (CIP-30 allows either). */
export function addressToBytes(address: string): Uint8Array {
  const a = address.trim();
  if (/^(addr|addr_test|stake|stake_test)1/.test(a)) return bech32.decodeToBytes(a, false).bytes;
  if (isHex(a) && a.length >= 58) return fromHex(a);
  return base58.decode(a);
}

export function parseAddress(address: string): ParsedAddress {
  return parseAddressBytes(addressToBytes(address));
}

export function addressToBech32(bytes: Uint8Array): string {
  const p = parseAddressBytes(bytes);
  if (p.kind === "byron") return base58.encode(bytes);
  const prefix = p.kind === "reward" ? (p.networkId === 1 ? "stake" : "stake_test") : p.networkId === 1 ? "addr" : "addr_test";
  return bech32.encode(prefix, bech32.toWords(bytes), false);
}

export function baseAddress(networkId: number, paymentKeyHash: Uint8Array, stakeKeyHash: Uint8Array): Uint8Array {
  const out = new Uint8Array(57);
  out[0] = 0x00 | (networkId & 0x0f);
  out.set(paymentKeyHash, 1);
  out.set(stakeKeyHash, 29);
  return out;
}

export function enterpriseAddress(networkId: number, paymentKeyHash: Uint8Array): Uint8Array {
  const out = new Uint8Array(29);
  out[0] = 0x60 | (networkId & 0x0f);
  out.set(paymentKeyHash, 1);
  return out;
}

export function rewardAddress(networkId: number, stake: Credential): Uint8Array {
  const out = new Uint8Array(29);
  out[0] = (stake.kind === "script" ? 0xf0 : 0xe0) | (networkId & 0x0f);
  out.set(stake.hash, 1);
  return out;
}

/** A Shelley payment address in bech32 (what people paste). Reward and Byron addresses are not send targets. */
export function isCardanoAddress(value: string): boolean {
  const v = value.trim();
  if (!/^(addr|addr_test)1[02-9ac-hj-np-z]+$/.test(v)) return false;
  try {
    const p = parseAddress(v);
    return (p.kind === "base" || p.kind === "enterprise" || p.kind === "pointer") && (p.networkId === 1) === v.startsWith("addr1");
  } catch {
    return false;
  }
}

export function poolIdToHex(pool: string): string {
  const p = pool.trim();
  if (/^[0-9a-f]{56}$/i.test(p)) return p.toLowerCase();
  const d = bech32.decodeToBytes(p, false);
  if (d.prefix !== "pool" || d.bytes.length !== 28) throw new Error("not a pool id");
  return hex(d.bytes);
}

export function poolIdToBech32(hash: Uint8Array): string {
  return bech32.encode("pool", bech32.toWords(hash), false);
}

export function shortAddress(bytesOrText: Uint8Array | string): string {
  const s = typeof bytesOrText === "string" ? bytesOrText : addressToBech32(bytesOrText);
  return s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s;
}
