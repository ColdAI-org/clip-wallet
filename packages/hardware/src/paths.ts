/**
 * Derivation paths for hardware accounts. "standard" is byte-for-byte the vault's scheme
 * (packages/vault/src/derive.ts), so the same recovery phrase on a device shows the same accounts.
 * See README "Derivation paths" for where Ledger Live and other wallets differ.
 */
import type { Curve } from "@clip-wallet/core";
import type { HardwareFamily, PathStyle } from "./types.js";

export interface PathOptions {
  /** Bitcoin only. Default "testnet" (coin type 1'), like the vault. */
  bitcoinNetwork?: "mainnet" | "testnet";
}

const MAX_INDEX = 0x7fffffff;

function checkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) throw new RangeError(`bad account index ${index}`);
}

export const HARDWARE_CURVE: Record<HardwareFamily, Curve> = {
  evm: "secp256k1",
  bitcoin: "secp256k1",
  solana: "ed25519",
  // The Ledger Hedera app only has Ed25519 keys (m/44'/3030'/0'/0'/i'). The vault's Hedera accounts are ECDSA.
  hedera: "ed25519",
};

export function pathStyles(family: HardwareFamily): PathStyle[] {
  switch (family) {
    case "evm":
      return ["standard", "ledger-live", "ledger-legacy"];
    case "solana":
    case "bitcoin":
      return ["standard", "ledger-live"];
    case "hedera":
      return ["standard"];
  }
}

export function hardwarePath(family: HardwareFamily, index: number, style: PathStyle = "standard", opts: PathOptions = {}): string {
  checkIndex(index);
  if (!pathStyles(family).includes(style)) throw new RangeError(`${family} has no ${style} path`);
  switch (family) {
    case "evm":
      if (style === "ledger-live") return `m/44'/60'/${index}'/0/0`;
      if (style === "ledger-legacy") return `m/44'/60'/0'/${index}`;
      return `m/44'/60'/0'/0/${index}`; // vault + MetaMask
    case "solana":
      if (style === "ledger-live") return `m/44'/501'/${index}'`;
      return `m/44'/501'/${index}'/0'`; // vault + Phantom/Solflare
    case "bitcoin": {
      const coin = (opts.bitcoinNetwork ?? "testnet") === "mainnet" ? 0 : 1;
      if (style === "ledger-live") return `m/84'/${coin}'/${index}'/0/0`;
      return `m/84'/${coin}'/0'/0/${index}`; // vault BIP-84
    }
    case "hedera":
      return `m/44'/3030'/0'/0'/${index}'`; // Ledger Hedera app; Hiero SDK standard Ed25519 path
  }
}

/** Bitcoin: split a path into the account part (for the wallet policy) and change/index. */
export function bitcoinAccountPath(path: string): { accountPath: string; change: number; addressIndex: number } {
  const m = /^(m\/84'\/[01]'\/\d+')\/([01])\/(\d+)$/.exec(path);
  if (!m) throw new RangeError(`not a BIP-84 address path: ${path}`);
  return { accountPath: m[1]!, change: Number(m[2]), addressIndex: Number(m[3]) };
}

/** "m/44'/60'/0'/0/1" -> "44'/60'/0'/0/1" (Ledger libraries take paths without the m/). */
export const ledgerPath = (path: string): string => path.replace(/^m\//, "");

const HARDENED = 0x80000000;

export function parsePath(path: string): number[] {
  const parts = path.replace(/^[mM]\/?/, "").split("/").filter(Boolean);
  return parts.map((p) => {
    const hard = /['hH]$/.test(p);
    const n = Number(hard ? p.slice(0, -1) : p);
    if (!Number.isInteger(n) || n < 0 || n >= HARDENED) throw new RangeError(`bad path segment ${p}`);
    return hard ? n + HARDENED : n;
  });
}

export function formatPath(indexes: number[]): string {
  return ["m", ...indexes.map((i) => (i >= HARDENED ? `${i - HARDENED}'` : String(i)))].join("/");
}
