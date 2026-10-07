/**
 * Derivation paths and key derivation per family. See README "Derivation" for the reasoning and sources.
 */
import { HDKey } from "@scure/bip32";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as sr25519 from "@scure/sr25519";
import * as stark from "@scure/starknet";
import type { Curve, Family } from "@clip-wallet/core";
import { fromHex, utf8, wipe } from "./bytes.js";
import { slip10Derive } from "./slip10.js";
import { deriveArc52, deriveXPrv, xprvPublicKey } from "./bip32ed25519.js";
import type { BitcoinAddressType, BitcoinNetwork } from "./address.js";

export const CURVE_OF: Record<Family, Curve> = {
  evm: "secp256k1",
  hedera: "secp256k1",
  solana: "ed25519",
  bitcoin: "secp256k1",
  sui: "ed25519",
  aptos: "ed25519",
  cardano: "bip32-ed25519",
  substrate: "sr25519",
  starknet: "stark",
  ton: "ed25519",
  near: "ed25519",
  stellar: "ed25519",
  tezos: "ed25519",
  algorand: "bip32-ed25519", // ARC-52 default; "ed25519" with algorandScheme "slip10" (see curveOf)
  cosmos: "secp256k1",
  provenance: "secp256k1",
  thorchain: "secp256k1",
  initia: "secp256k1", // ethsecp256k1: same curve, keccak address and digest
  tron: "secp256k1",
  xrpl: "secp256k1",
  antelope: "secp256k1",
  multiversx: "ed25519",
  icp: "secp256k1",
  stacks: "secp256k1",
  fuel: "secp256k1",
  bitcoincash: "secp256k1",
};

/** Which Algorand derivation to follow. See README "Algorand". */
export type AlgorandScheme = "arc52" | "slip10";

/** Which wallet's Stark key derivation to follow. See README "Starknet". */
export type StarknetScheme = "argent-x" | "braavos" | "ledger";

export interface PathOptions {
  bitcoinNetwork?: BitcoinNetwork;
  bitcoinAddressType?: BitcoinAddressType;
  /** Default "argent-x". */
  starknetScheme?: StarknetScheme;
  /** Default "arc52" (Pera Universal Wallet). */
  algorandScheme?: AlgorandScheme;
}

/** The curve a family's key lives on, given the options (only Algorand depends on them). */
export function curveOf(family: Family, opts: PathOptions = {}): Curve {
  if (family === "algorand") return (opts.algorandScheme ?? "arc52") === "slip10" ? "ed25519" : "bip32-ed25519";
  const c = CURVE_OF[family];
  if (!c) throw new RangeError(`unknown family ${String(family)}`);
  return c;
}

const MAX_INDEX = 0x7fffffff;

export function checkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) throw new RangeError(`bad account index ${index}`);
}

/**
 * Starknet EIP-2645 constants (Ledger Starknet app, Argent on Ledger): layer = int31(sha256("starknet")),
 * application = int31(sha256("argentx")), eth-address levels 0'/0'.
 */
export const STARKNET_LAYER = 1195502025;
export const STARKNET_APPLICATION = 1148870696;
/** Argent X: the BIP-32 seed of the Stark tree is the Ethereum private key at this path (ethers' default). */
export const ARGENT_X_ETH_PATH = "m/44'/60'/0'/0/0";

/** Account node (everything above the per-address/role levels) for families that have one. */
export function accountNodePath(family: Family, index: number, opts: PathOptions = {}): string {
  checkIndex(index);
  switch (family) {
    case "bitcoin": {
      const coin = (opts.bitcoinNetwork ?? "testnet") === "mainnet" ? 0 : 1;
      const purpose = opts.bitcoinAddressType === "p2tr" ? 86 : 84;
      // Vault Bitcoin "accounts" are address indexes of BIP-84/86 account 0' (Phase 1 layout), so every
      // vault Bitcoin account shares this node; change addresses hang off its internal chain (…/1/n).
      return `m/${purpose}'/${coin}'/0'`;
    }
    case "cardano":
      return `m/1852'/1815'/${index}'`; // CIP-1852 account
    default:
      throw new Error(`${family} has no sub-paths`);
  }
}

export function derivationPath(family: Family, index: number, opts: PathOptions = {}): string {
  checkIndex(index);
  switch (family) {
    case "evm":
      return `m/44'/60'/0'/0/${index}`; // BIP-44, MetaMask
    case "hedera":
      return `m/44'/3030'/0'/0/${index}`; // Hiero SDK toStandardECDSAsecp256k1PrivateKey
    case "solana":
      return `m/44'/501'/${index}'/0'`; // Phantom / Solflare / Solana CLI default
    case "bitcoin":
      return `${accountNodePath("bitcoin", index, opts)}/0/${index}`; // BIP-84 / BIP-86 receive chain
    case "sui":
      return `m/44'/784'/${index}'/0'/0'`; // Sui Wallet / Slush, @mysten/sui DEFAULT_ED25519_DERIVATION_PATH
    case "aptos":
      return `m/44'/637'/${index}'/0'/0'`; // Petra, aptos-ts-sdk
    case "near":
      return `m/44'/397'/${index}'`; // near-seed-phrase, MyNearWallet, Meteor
    case "stellar":
      return `m/44'/148'/${index}'`; // SEP-0005
    case "algorand":
      return (opts.algorandScheme ?? "arc52") === "slip10"
        ? `m/44'/283'/${index}'/0'/0'` // SLIP-10, Trust Wallet / wallet-core
        : `m/44'/283'/${index}'/0/0`; // ARC-52 BIP32-Ed25519 (Peikert), Pera Universal Wallet
    case "tezos":
      return `m/44'/1729'/${index}'/0'`; // Temple, Kukai, Taquito default
    case "ton":
      return `m/44'/607'/${index}'`; // SLIP-0044 coin 607, Trust Wallet / wallet-core, Tonkeeper "BIP-39" import
    case "cardano":
      return `${accountNodePath("cardano", index)}/0/0`; // CIP-1852 first external (payment) address
    case "substrate":
      return substrateJunction(index);
    /* networks87: each ecosystem's most used BIP-39 wallet (README "Derivation"). */
    case "cosmos":
      return `m/44'/118'/0'/0/${index}`; // Keplr, Leap, Cosmostation: Osmosis, dYdX, ZIGChain (chain-registry slip44 118)
    case "provenance":
      return `m/44'/505'/0'/0/${index}`; // chain-registry slip44 505 (Keplr, Leap, Provenance Blockchain Wallet)
    case "thorchain":
      return `m/44'/931'/0'/0/${index}`; // SLIP-44 931 (Keplr, Ctrl/XDEFI, Vultisig)
    case "initia":
      return `m/44'/60'/0'/0/${index}`; // chain-registry slip44 60, ethsecp256k1 (Initia Wallet, Keplr): the EVM key
    case "tron":
      return `m/44'/195'/0'/0/${index}`; // TronLink (account i = address index i), TronWeb fromMnemonic
    case "xrpl":
      return `m/44'/144'/${index}'/0/0`; // xrpl.js Wallet.fromMnemonic (i = 0), Ledger Live, GemWallet
    case "antelope":
      return `m/44'/194'/0'/0/${index}`; // SLIP-44 194 (EOS/Vaulta), TokenPocket; one key for Vaulta, Telos and XPR
    case "multiversx":
      return `m/44'/508'/0'/0'/${index}'`; // xPortal, MultiversX DeFi Wallet, sdk-wallet Mnemonic.deriveKey(i)
    case "icp":
      return `m/44'/223'/0'/0/${index}`; // Plug, dfx identity import, @dfinity/identity-secp256k1 fromSeedPhrase
    case "stacks":
      return `m/44'/5757'/0'/0/${index}`; // Leather, Xverse (@stacks/wallet-sdk account i)
    case "fuel":
      return `m/44'/1179993420'/${index}'/0/0`; // Fuel Wallet, fuels-ts WalletManager
    case "bitcoincash":
      return `m/44'/145'/0'/0/${index}`; // Electron Cash, Paytaca, Bitcoin.com Wallet (P2PKH receive chain)
    case "starknet":
      switch (opts.starknetScheme ?? "argent-x") {
        case "argent-x":
          return `argent-x:m/44'/9004'/0'/0/${index}`;
        case "braavos":
          return `braavos:m/44'/9004'/0'/0/${index}`;
        case "ledger":
          return `m/2645'/${STARKNET_LAYER}'/${STARKNET_APPLICATION}'/0'/0'/${index}`;
        default:
          throw new RangeError(`unknown starknet scheme ${String(opts.starknetScheme)}`);
      }
    default:
      throw new RangeError(`unknown family ${String(family)}`);
  }
}

/**
 * Substrate: account 0 is the phrase's root key (no junction), which is what polkadot.js, Talisman,
 * SubWallet and Nova show when a phrase is imported. Account i ≥ 1 is the hard junction "//<i-1>"
 * (//0, //1, …), as Talisman and polkadot.js "derive" number children. Returned in SURI form ("" = root).
 */
export function substrateJunction(index: number): string {
  checkIndex(index);
  return index === 0 ? "" : `//${index - 1}`;
}

/** What the vault keeps in memory while unlocked. Cardano and Substrate need the entropy, not the seed. */
export interface KeySource {
  /** 64-byte BIP-39 seed. */
  seed: Uint8Array;
  /** BIP-39 entropy (16 or 32 bytes). */
  entropy: Uint8Array;
}

export interface DerivedKey {
  curve: Curve;
  path: string;
  /**
   * Caller must wipe() this as soon as it is done.
   * secp256k1/ed25519/stark: 32 bytes; bip32-ed25519: 64-byte extended key kL‖kR; sr25519: 64-byte schnorrkel secret.
   */
  privateKey: Uint8Array;
  /** secp256k1: 33-byte compressed. ed25519/bip32-ed25519/sr25519: 32 bytes. stark: 32-byte x-coordinate. */
  publicKey: Uint8Array;
}

/** Derives a family's key at `path` (from derivationPath/accountNodePath), choosing the right root. */
export function deriveFamilyKey(src: KeySource, family: Family, path: string, opts: PathOptions = {}): DerivedKey {
  const curve = curveOf(family, opts);
  if (family === "algorand" && curve === "bip32-ed25519") {
    const node = deriveArc52(src.seed, path);
    wipe(node.chainCode);
    return { curve, path, privateKey: node.key, publicKey: xprvPublicKey(node.key) };
  }
  return deriveKey(src, curve, path);
}

/**
 * Derives the key at `path` on `curve`. For sr25519 `path` is a junction string ("", "//1", "//1//2");
 * bip32-ed25519 here is Cardano's Icarus tree (Algorand ARC-52 goes through deriveFamilyKey).
 */
export function deriveKey(src: KeySource | Uint8Array, curve: Curve, path: string): DerivedKey {
  const { seed, entropy } = src instanceof Uint8Array ? { seed: src, entropy: undefined } : src;
  switch (curve) {
    case "ed25519": {
      const node = slip10Derive(seed, path);
      wipe(node.chainCode);
      return { curve, path, privateKey: node.privateKey, publicKey: ed25519.getPublicKey(node.privateKey) };
    }
    case "secp256k1": {
      const privateKey = bip32PrivateKey(seed, path);
      return { curve, path, privateKey, publicKey: secp256k1.getPublicKey(privateKey, true) };
    }
    case "bip32-ed25519": {
      if (!entropy) throw new Error("cardano keys need the BIP-39 entropy");
      const node = deriveXPrv(entropy, path);
      wipe(node.chainCode);
      return { curve, path, privateKey: node.key, publicKey: xprvPublicKey(node.key) };
    }
    case "sr25519": {
      if (!entropy) throw new Error("substrate keys need the BIP-39 entropy");
      const privateKey = substrateSecret(entropy, path);
      return { curve, path, privateKey, publicKey: sr25519.getPublicKey(privateKey) };
    }
    case "stark": {
      const privateKey = starkPrivateKey(seed, path);
      return { curve, path, privateKey, publicKey: starkPublicKey(privateKey) };
    }
    default:
      throw new Error(`unknown curve ${String(curve)}`);
  }
}

function bip32PrivateKey(seed: Uint8Array, path: string): Uint8Array {
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(path);
  const sk = child.privateKey;
  if (!sk) throw new Error("derivation produced no private key");
  const out = sk.slice();
  root.wipePrivateData();
  child.wipePrivateData();
  return out;
}

/* ------------------------------------------------------------------ substrate */

/**
 * substrate-bip39 mini-secret: PBKDF2-HMAC-SHA512(password = entropy, salt = "mnemonic" ‖ passphrase,
 * 2048 rounds), first 32 bytes. (Not the BIP-39 seed, which hashes the phrase words.)
 * https://github.com/paritytech/substrate-bip39/blob/master/src/lib.rs
 */
export function substrateMiniSecret(entropy: Uint8Array, passphrase = ""): Uint8Array {
  const out = pbkdf2(sha512, entropy, utf8(`mnemonic${passphrase}`), { c: 2048, dkLen: 64 });
  const mini = out.slice(0, 32);
  wipe(out);
  return mini;
}

/**
 * Hard-junction chain codes as polkadot.js / sp-core encode them: a decimal number is its little-endian
 * integer bytes zero-padded to 32; anything else is the SCALE string (compact length ‖ UTF-8), padded to
 * 32 or BLAKE2b-256 if longer. Only hard numeric junctions are produced by the vault; strings are accepted
 * so the well-known dev vectors (//Alice) can be tested.
 */
export function junctionChainCode(code: string): Uint8Array {
  const cc = new Uint8Array(32);
  if (/^\d+$/.test(code)) {
    let n = BigInt(code);
    for (let i = 0; i < 32 && n > 0n; i++, n >>= 8n) cc[i] = Number(n & 0xffn);
    if (n > 0n) throw new Error("junction number too large");
    return cc;
  }
  const bytes = utf8(code);
  if (bytes.length >= 64) throw new Error("junction too long");
  const scale = new Uint8Array([bytes.length << 2, ...bytes]); // SCALE compact length (single-byte mode)
  if (scale.length > 32) throw new Error("junction too long");
  cc.set(scale);
  return cc;
}

export function parseHardJunctions(suri: string): string[] {
  if (suri === "") return [];
  if (!suri.startsWith("//")) throw new Error("only hard junctions (//) are supported");
  const parts = suri.slice(2).split("//");
  if (parts.some((p) => p === "" || p.includes("/"))) throw new Error(`bad junction path ${suri}`);
  return parts;
}

/** 64-byte schnorrkel secret (scalar ‖ nonce) at a hard-junction path, Ed25519 expansion mode as sp-core. */
export function substrateSecret(entropy: Uint8Array, suri: string): Uint8Array {
  const mini = substrateMiniSecret(entropy);
  let secret: Uint8Array = sr25519.secretFromSeed(mini);
  wipe(mini);
  for (const j of parseHardJunctions(suri)) {
    const next = sr25519.HDKD.secretHard(secret, junctionChainCode(j));
    wipe(secret);
    secret = next;
  }
  return secret;
}

/* ------------------------------------------------------------------ starknet */

/**
 * Stark private key: a BIP-32 secp256k1 node, then the StarkWare "grind" (rejection sampling
 * SHA-256(key ‖ i) into the Stark curve order), as Argent X, Braavos and starknet.js do.
 *   "argent-x:m/44'/9004'/0'/0/i"  BIP-32 seed = ETH private key at m/44'/60'/0'/0/0 (Argent X)
 *   "braavos:m/44'/9004'/0'/0/i"   BIP-32 seed = BIP-39 seed (Braavos)
 *   "m/2645'/…"                    BIP-32 seed = BIP-39 seed, EIP-2645 path (Ledger)
 */
export function starkPrivateKey(seed: Uint8Array, path: string): Uint8Array {
  let node: Uint8Array;
  if (path.startsWith("argent-x:")) {
    const eth = bip32PrivateKey(seed, ARGENT_X_ETH_PATH);
    try {
      node = bip32PrivateKey(eth, path.slice("argent-x:".length));
    } finally {
      wipe(eth);
    }
  } else if (path.startsWith("braavos:")) {
    node = bip32PrivateKey(seed, path.slice("braavos:".length));
  } else if (path.startsWith("m/2645'/")) {
    node = bip32PrivateKey(seed, path);
  } else {
    throw new Error(`bad starknet path ${path}`);
  }
  try {
    return fromHex(stark.grindKey(node).padStart(64, "0"));
  } finally {
    wipe(node);
  }
}

export function starkPublicKey(privateKey: Uint8Array): Uint8Array {
  return fromHex(stark.getStarkKey(privateKey).slice(2).padStart(64, "0"));
}
