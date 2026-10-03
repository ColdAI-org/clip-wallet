import { PublicKey } from "@hiero-ledger/sdk";
import { fromHex } from "./util.js";

/** 0.0.1234, optionally with a HIP-15 checksum (0.0.1234-abcde). */
export const ACCOUNT_ID_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]{5}))?$/;
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value.trim());
}

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_RE.test(value.trim());
}

/** Strips a HIP-15 checksum: "0.0.1234-abcde" → "0.0.1234". */
export function stripChecksum(value: string): string {
  return value.trim().replace(/-[a-z]{5}$/, "");
}

/**
 * The account's EVM alias address for an ECDSA secp256k1 public key (compressed or uncompressed, bytes or hex):
 * the last 20 bytes of keccak256 of the uncompressed key. Sending HBAR to this address auto-creates the account
 * (HIP-583); after that the mirror node resolves it to 0.0.x.
 */
export function aliasAddress(publicKey: Uint8Array | string): string {
  const bytes = typeof publicKey === "string" ? fromHex(publicKey) : publicKey;
  return `0x${PublicKey.fromBytesECDSA(bytes).toEvmAddress().toLowerCase()}`;
}

/** If an EVM address is a "long-zero" address (0x000…0000<num>), the 0.0.num it stands for. */
export function longZeroToAccountId(evm: string): string | null {
  const h = evm.toLowerCase().replace(/^0x/, "");
  if (h.length !== 40 || !/^0{24}/.test(h)) return null;
  return `0.0.${BigInt(`0x${h.slice(24)}`).toString()}`;
}
