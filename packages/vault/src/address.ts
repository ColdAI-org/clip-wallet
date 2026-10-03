/**
 * Tiny, pure address helpers so the vault can fill `Account.address` without importing chain modules.
 * Chain modules stay the source of truth for validation; an `AddressOf` can be injected to override these.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { base58, bech32, bech32m } from "@scure/base";
import type { Family } from "@clip-wallet/core";
import { concat, toHex } from "./bytes.js";
import {
  algorandAddress,
  aptosAddress,
  cardanoBaseAddress,
  nearImplicitAccount,
  ss58Address,
  starknetOzAccountAddress,
  stellarAddress,
  suiAddress,
  tezosTz1Address,
  tonAddress,
  type Network2,
  type TonWalletVersion,
} from "./encodings.js";

export type BitcoinNetwork = "mainnet" | "testnet";
export type BitcoinAddressType = "p2wpkh" | "p2tr";

export interface AddressContext {
  bitcoinNetwork: BitcoinNetwork;
  bitcoinAddressType: BitcoinAddressType;
  /** Cardano base addresses carry a network id (addr_test / addr). Default "testnet". */
  cardanoNetwork?: Network2;
  /** Cardano: the account's stake key (m/1852'/1815'/i'/2/0); the base address needs both keys. */
  cardanoStakePublicKey?: Uint8Array;
  /** TON wallet v5r1 ids differ per network (global id -239 / -3). Default "testnet". */
  tonNetwork?: Network2;
  /** TON wallet contract. Default "v5r1". */
  tonWalletVersion?: TonWalletVersion;
  /** Starknet: account class whose counterfactual address to compute (OpenZeppelin-style constructor(public_key)). */
  starknetAccountClassHash?: string;
}

/** Injectable address function. Receives the public key exactly as stored in Account.publicKey (bytes). */
export type AddressOf = (family: Family, publicKey: Uint8Array, ctx: AddressContext) => string;

/** EIP-55 checksummed address from a compressed or uncompressed secp256k1 key. */
export function evmAddress(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  const lower = toHex(keccak_256(uncompressed.subarray(1)).subarray(12));
  const hash = toHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

export const solanaAddress = (publicKey: Uint8Array): string => {
  if (publicKey.length !== 32) throw new Error("solana public key must be 32 bytes");
  return base58.encode(publicKey);
};

const hrp = (n: BitcoinNetwork) => (n === "mainnet" ? "bc" : "tb");

/** BIP-84 / BIP-173 P2WPKH from a 33-byte compressed key. */
export function p2wpkhAddress(publicKey: Uint8Array, network: BitcoinNetwork): string {
  if (publicKey.length !== 33) throw new Error("p2wpkh needs a compressed key");
  const prog = ripemd160(sha256(publicKey));
  return bech32.encode(hrp(network), [0, ...bech32.toWords(prog)]);
}

/** BIP-341 key-path tweak with no script tree (BIP-86): Q = P + H_TapTweak(P_x [|| merkleRoot])·G. Returns x-only Q. */
export function taprootOutputKey(publicKey: Uint8Array, merkleRoot: Uint8Array = new Uint8Array()): Uint8Array {
  const P = secp256k1.Point.fromBytes(publicKey.length === 32 ? concat(new Uint8Array([2]), publicKey) : publicKey);
  const Peven = P.y % 2n === 0n ? P : P.negate();
  const px = Peven.toBytes(true).subarray(1);
  const t = bytesToBigInt(schnorr.utils.taggedHash("TapTweak", px, merkleRoot));
  const n = secp256k1.Point.Fn.ORDER;
  if (t >= n) throw new Error("taproot tweak out of range");
  const Q = Peven.add(secp256k1.Point.BASE.multiply(t));
  return Q.toBytes(true).subarray(1);
}

/** BIP-86 / BIP-350 P2TR address from the internal key (33-byte compressed or 32-byte x-only). */
export function p2trAddress(publicKey: Uint8Array, network: BitcoinNetwork): string {
  return bech32m.encode(hrp(network), [1, ...bech32m.toWords(taprootOutputKey(publicKey))]);
}

export const defaultAddressOf: AddressOf = (family, publicKey, ctx) => {
  switch (family) {
    case "evm":
    case "hedera": // Hedera: the EVM alias of the ECDSA key until a 0.0.x account id exists.
      return evmAddress(publicKey);
    case "solana":
      return solanaAddress(publicKey);
    case "bitcoin":
      return ctx.bitcoinAddressType === "p2tr"
        ? p2trAddress(publicKey, ctx.bitcoinNetwork)
        : p2wpkhAddress(publicKey, ctx.bitcoinNetwork);
    case "sui":
      return suiAddress(publicKey);
    case "aptos":
      return aptosAddress(publicKey);
    case "near":
      return nearImplicitAccount(publicKey);
    case "stellar":
      return stellarAddress(publicKey);
    case "algorand":
      return algorandAddress(publicKey);
    case "tezos":
      return tezosTz1Address(publicKey);
    case "ton":
      return tonAddress(publicKey, ctx.tonNetwork ?? "testnet", ctx.tonWalletVersion ?? "v5r1");
    case "cardano":
      if (!ctx.cardanoStakePublicKey) throw new Error("cardano base address needs the stake key");
      return cardanoBaseAddress(publicKey, ctx.cardanoStakePublicKey, ctx.cardanoNetwork ?? "testnet");
    case "substrate":
      // Generic Substrate prefix 42; chain modules re-encode for their network (Polkadot 0, Kusama 2, ...).
      return ss58Address(publicKey, 42);
    case "starknet":
      if (!ctx.starknetAccountClassHash) throw new Error("starknet addresses need an account class hash");
      return starknetOzAccountAddress(publicKey, ctx.starknetAccountClassHash);
    default:
      throw new Error(`addresses for ${String(family)} are not supported`);
  }
};

export function bytesToBigInt(b: Uint8Array): bigint {
  return b.length === 0 ? 0n : BigInt("0x" + toHex(b));
}
