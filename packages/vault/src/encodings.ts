/**
 * Address encodings for the Phase 2 families. Public-key maths only (no secrets), kept in the vault so
 * `Account.address` can be filled without importing chain modules. Each is cross-checked against the
 * family's official SDK in test/families.test.ts. Sources are listed in the README "Derivation" table.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256, sha512_256 } from "@noble/hashes/sha2.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { base32nopad, base58, base64urlnopad, bech32, createBase58check } from "@scure/base";
import { computeHashOnElements } from "@scure/starknet";
import { concat, toHex, utf8 } from "./bytes.js";

export type Network2 = "mainnet" | "testnet";

/* ------------------------------------------------------------------ ed25519 families */

/** Sui: BLAKE2b-256(flag 0x00 ‖ pubkey), 0x-hex. https://docs.sui.io/concepts/cryptography/transaction-auth/keys-addresses */
export function suiAddress(publicKey: Uint8Array): string {
  need(publicKey, 32, "sui");
  return "0x" + toHex(blake2b(concat(new Uint8Array([0x00]), publicKey), { dkLen: 32 }));
}

/** Aptos single-key Ed25519 account: authentication key = SHA3-256(pubkey ‖ 0x00) = initial address. */
export function aptosAddress(publicKey: Uint8Array): string {
  need(publicKey, 32, "aptos");
  return "0x" + toHex(sha3_256(concat(publicKey, new Uint8Array([0x00]))));
}

/** NEAR implicit account id: lower-case hex of the Ed25519 public key (64 chars). */
export function nearImplicitAccount(publicKey: Uint8Array): string {
  need(publicKey, 32, "near");
  return toHex(publicKey);
}

/** CRC16-XModem (poly 0x1021, init 0). Used by Stellar StrKey and TON user-friendly addresses. */
export function crc16xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Stellar StrKey account id ("G…"): base32(version 6<<3 ‖ pubkey ‖ CRC16-LE). SEP-0023. */
export function stellarAddress(publicKey: Uint8Array): string {
  need(publicKey, 32, "stellar");
  const payload = concat(new Uint8Array([6 << 3]), publicKey);
  const crc = crc16xmodem(payload);
  return base32nopad.encode(concat(payload, new Uint8Array([crc & 0xff, crc >> 8])));
}

/** Algorand: base32(pubkey ‖ last 4 bytes of SHA-512/256(pubkey)), 58 chars, no padding. */
export function algorandAddress(publicKey: Uint8Array): string {
  need(publicKey, 32, "algorand");
  return base32nopad.encode(concat(publicKey, sha512_256(publicKey).subarray(28)));
}

const b58check = createBase58check(sha256);
/** Tezos tz1: base58check(prefix 06a19f ‖ BLAKE2b-160(pubkey)). */
export function tezosTz1Address(publicKey: Uint8Array): string {
  need(publicKey, 32, "tezos");
  return b58check.encode(concat(new Uint8Array([6, 161, 159]), blake2b(publicKey, { dkLen: 20 })));
}

/* ------------------------------------------------------------------ TON wallet v5r1 */

/**
 * Wallet v5r1 ("W5", Tonkeeper's default since 2024) code cell: representation hash and depth, from
 * https://github.com/ton-blockchain/wallet-contract-v5 (build/wallet_v5.compiled.json) and checked in the
 * tests against @ton/ton `WalletContractV5R1`.
 */
export const TON_V5R1_CODE_HASH = "20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f";
const TON_V5R1_CODE_DEPTH = 6;
/** Wallet v4r2 code cell (Trust Wallet / wallet-core's default), checked against @ton/ton `WalletContractV4`. */
export const TON_V4R2_CODE_HASH = "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0";
const TON_V4R2_CODE_DEPTH = 7;
const TON_V4_DEFAULT_WALLET_ID = 698983191; // 0x29a9a317 + workchain

export type TonWalletVersion = "v5r1" | "v4r2";
const TON_GLOBAL_ID: Record<Network2, number> = { mainnet: -239, testnet: -3 };

/** Bit string builder for the few cells we need. */
class Bits {
  private bits: number[] = [];
  bit(b: 0 | 1) {
    this.bits.push(b);
    return this;
  }
  uint(v: number | bigint, n: number) {
    const x = BigInt(v);
    for (let i = n - 1; i >= 0; i--) this.bits.push(Number((x >> BigInt(i)) & 1n));
    return this;
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.uint(x, 8);
    return this;
  }
  get length() {
    return this.bits.length;
  }
  /** Data bytes with the TVM completion tag (1 then zeros) when not byte-aligned. */
  padded(): Uint8Array {
    const n = this.bits.length;
    const out = new Uint8Array(Math.ceil(n / 8));
    this.bits.forEach((b, i) => (out[i >> 3]! |= b << (7 - (i & 7))));
    if (n % 8) out[n >> 3]! |= 1 << (7 - (n % 8));
    return out;
  }
}

interface CellRef {
  hash: Uint8Array;
  depth: number;
}

/** Representation hash of an ordinary level-0 cell (TVM whitepaper §3.1.4–3.1.5). */
function cellHash(bits: Bits, refs: CellRef[]): CellRef {
  const d1 = refs.length;
  const d2 = Math.floor(bits.length / 8) + Math.ceil(bits.length / 8);
  const depths = refs.flatMap((r) => [r.depth >> 8, r.depth & 0xff]);
  const repr = concat(new Uint8Array([d1, d2]), bits.padded(), new Uint8Array(depths), ...refs.map((r) => r.hash));
  return { hash: sha256(repr), depth: refs.length ? Math.max(...refs.map((r) => r.depth)) + 1 : 0 };
}

/** v5r1 wallet_id for the default client context (workchain 0, version 0, subwallet 0). */
export function tonV5R1WalletId(network: Network2, subwallet = 0, workchain = 0): number {
  const context = ((1 << 31) | ((workchain & 0xff) << 23) | (0 << 15) | (subwallet & 0x7fff)) >>> 0;
  return (TON_GLOBAL_ID[network] ^ context) >>> 0;
}

/** Raw account hash (32 bytes) of a wallet v5r1 for this key: hash(StateInit{code, data}). */
export function tonV5R1AccountHash(publicKey: Uint8Array, network: Network2): Uint8Array {
  need(publicKey, 32, "ton");
  // data: is_signature_allowed:1 seqno:32 wallet_id:32 public_key:256 extensions_dict:(HashmapE 256 int1) = empty
  const data = new Bits().bit(1).uint(0, 32).uint(tonV5R1WalletId(network), 32).bytes(publicKey).bit(0);
  return stateInitHash({ hash: hexBytes(TON_V5R1_CODE_HASH), depth: TON_V5R1_CODE_DEPTH }, cellHash(data, []));
}

/** Raw account hash of a wallet v4r2 (same on every network): data = seqno:32 subwallet_id:32 public_key:256 plugins:(HashmapE) empty. */
export function tonV4R2AccountHash(publicKey: Uint8Array, workchain = 0): Uint8Array {
  need(publicKey, 32, "ton");
  const data = new Bits().uint(0, 32).uint(TON_V4_DEFAULT_WALLET_ID + workchain, 32).bytes(publicKey).bit(0);
  return stateInitHash({ hash: hexBytes(TON_V4R2_CODE_HASH), depth: TON_V4R2_CODE_DEPTH }, cellHash(data, []));
}

function stateInitHash(code: CellRef, dataCell: CellRef): Uint8Array {
  // StateInit: split_depth:(Maybe) 0, special:(Maybe) 0, code:(Maybe ^Cell) 1, data:(Maybe ^Cell) 1, library:(HashmapE) 0
  const stateInit = new Bits().bit(0).bit(0).bit(1).bit(1).bit(0);
  return cellHash(stateInit, [code, dataCell]).hash;
}

/**
 * TEP-2 user-friendly address. Wallets are shown non-bounceable ("UQ…", or "0Q…" on testnet), as Tonkeeper
 * and the TON docs recommend for wallet addresses. https://github.com/ton-blockchain/TEPs/blob/master/text/0002-address.md
 */
export function tonFriendlyAddress(hash: Uint8Array, network: Network2, bounceable = false, workchain = 0): string {
  const tag = (bounceable ? 0x11 : 0x51) | (network === "testnet" ? 0x80 : 0);
  const body = concat(new Uint8Array([tag, workchain & 0xff]), hash);
  const crc = crc16xmodem(body);
  return base64urlnopad.encode(concat(body, new Uint8Array([crc >> 8, crc & 0xff])));
}

export const tonAddress = (publicKey: Uint8Array, network: Network2, version: TonWalletVersion = "v5r1"): string =>
  tonFriendlyAddress(version === "v4r2" ? tonV4R2AccountHash(publicKey) : tonV5R1AccountHash(publicKey, network), network);

/* ------------------------------------------------------------------ Cardano */

/** CIP-19 base address (header type 0: key hash payment + key hash stake). Bech32 "addr" / "addr_test". */
export function cardanoBaseAddress(paymentKey: Uint8Array, stakeKey: Uint8Array, network: Network2): string {
  need(paymentKey, 32, "cardano");
  need(stakeKey, 32, "cardano");
  const header = (0b0000 << 4) | (network === "mainnet" ? 1 : 0);
  const bytes = concat(new Uint8Array([header]), blake2b(paymentKey, { dkLen: 28 }), blake2b(stakeKey, { dkLen: 28 }));
  return bech32.encode(network === "mainnet" ? "addr" : "addr_test", bech32.toWords(bytes), false);
}

/** CIP-19 reward (stake) address, header type 14 (0b1110). */
export function cardanoRewardAddress(stakeKey: Uint8Array, network: Network2): string {
  need(stakeKey, 32, "cardano");
  const bytes = concat(new Uint8Array([(0b1110 << 4) | (network === "mainnet" ? 1 : 0)]), blake2b(stakeKey, { dkLen: 28 }));
  return bech32.encode(network === "mainnet" ? "stake" : "stake_test", bech32.toWords(bytes), false);
}

/* ------------------------------------------------------------------ Substrate */

/** SS58 (https://docs.substrate.io/reference/address-formats/). Simple prefixes 0..63 only; 42 = generic Substrate. */
export function ss58Address(publicKey: Uint8Array, prefix = 42): string {
  need(publicKey, 32, "substrate");
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 63) throw new Error("only simple SS58 prefixes (0..63) are supported here");
  const body = concat(new Uint8Array([prefix]), publicKey);
  const checksum = blake2b(concat(utf8("SS58PRE"), body), { dkLen: 64 }).subarray(0, 2);
  return base58.encode(concat(body, checksum));
}

/* ------------------------------------------------------------------ Starknet */

const STARKNET_ADDR_BOUND = (1n << 251n) - 256n;
const CONTRACT_ADDRESS_PREFIX = BigInt("0x" + toHex(utf8("STARKNET_CONTRACT_ADDRESS")));

/**
 * Counterfactual address of an account deployed with deploy_account (deployer 0), salt = public key and
 * constructor calldata, per https://docs.starknet.io/architecture-and-concepts/smart-contracts/contract-address/.
 */
export function starknetContractAddress(classHash: string | bigint, salt: bigint, calldata: bigint[], deployer = 0n): string {
  const felt = (x: unknown): bigint => (x instanceof Uint8Array ? BigInt("0x" + toHex(x)) : BigInt(x as string | bigint));
  const h = felt(
    computeHashOnElements([CONTRACT_ADDRESS_PREFIX, deployer, salt, BigInt(classHash), felt(computeHashOnElements(calldata))]),
  );
  return "0x" + (h % STARKNET_ADDR_BOUND).toString(16).padStart(64, "0");
}

/** OpenZeppelin account (constructor(public_key)) address for a Stark public key. */
export function starknetOzAccountAddress(starkPublicKey: Uint8Array, classHash: string): string {
  need(starkPublicKey, 32, "starknet");
  const pk = BigInt("0x" + toHex(starkPublicKey));
  return starknetContractAddress(classHash, pk, [pk]);
}

/* ------------------------------------------------------------------ helpers */

function need(b: Uint8Array, len: number, family: string): void {
  if (!(b instanceof Uint8Array) || b.length !== len) throw new Error(`${family} public key must be ${len} bytes`);
}

function hexBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
