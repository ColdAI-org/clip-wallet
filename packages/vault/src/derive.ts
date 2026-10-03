/**
 * Derivation paths and key derivation per family. See README "Derivation" for the reasoning and sources.
 */
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Curve, Family } from "@clip-wallet/core";
import { wipe } from "./bytes.js";
import { slip10Derive } from "./slip10.js";
import type { BitcoinAddressType, BitcoinNetwork } from "./address.js";

export const CURVE_OF: Record<Family, Curve> = {
  evm: "secp256k1",
  hedera: "secp256k1",
  solana: "ed25519",
  bitcoin: "secp256k1",
};

export interface PathOptions {
  bitcoinNetwork?: BitcoinNetwork;
  bitcoinAddressType?: BitcoinAddressType;
}

const MAX_INDEX = 0x7fffffff;

export function derivationPath(family: Family, index: number, opts: PathOptions = {}): string {
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) throw new RangeError(`bad account index ${index}`);
  switch (family) {
    case "evm":
      return `m/44'/60'/0'/0/${index}`; // BIP-44, MetaMask
    case "hedera":
      return `m/44'/3030'/0'/0/${index}`; // Hiero SDK toStandardECDSAsecp256k1PrivateKey
    case "solana":
      return `m/44'/501'/${index}'/0'`; // Phantom / Solflare / Solana CLI default
    case "bitcoin": {
      const coin = (opts.bitcoinNetwork ?? "testnet") === "mainnet" ? 0 : 1;
      const purpose = opts.bitcoinAddressType === "p2tr" ? 86 : 84; // BIP-86 taproot / BIP-84 native segwit
      return `m/${purpose}'/${coin}'/0'/0/${index}`;
    }
  }
}

export interface DerivedKey {
  curve: Curve;
  path: string;
  /** Caller must wipe() this as soon as it is done. */
  privateKey: Uint8Array;
  /** secp256k1: 33-byte compressed. ed25519: 32 bytes. */
  publicKey: Uint8Array;
}

export function deriveKey(seed: Uint8Array, curve: Curve, path: string): DerivedKey {
  if (curve === "ed25519") {
    const node = slip10Derive(seed, path);
    wipe(node.chainCode);
    return { curve, path, privateKey: node.privateKey, publicKey: ed25519.getPublicKey(node.privateKey) };
  }
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(path);
  const sk = child.privateKey;
  if (!sk) throw new Error("derivation produced no private key");
  const privateKey = sk.slice();
  root.wipePrivateData();
  child.wipePrivateData();
  return { curve, path, privateKey, publicKey: secp256k1.getPublicKey(privateKey, true) };
}
