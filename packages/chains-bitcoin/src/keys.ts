/**
 * Paths, addresses and scripts for an account. Public data only.
 *
 * Paths match @clip-wallet/vault, which derives and signs: BIP-84 (P2WPKH) m/84'/<coin>'/0'/0/<index>
 * and BIP-86 (P2TR) m/86'/<coin>'/0'/0/<index>, coin 1' on test networks (the v1 default) and 0' on
 * mainnet. Mainnet accounts therefore use different keys from testnet accounts.
 *
 * "Ours": an input/output is the user's when its script is P2WPKH(account.publicKey, the BIP-84 key), a
 * P2WPKH change key the vault handed out, or the BIP-86 key-path P2TR output of `account.taprootPublicKey`
 * (the BIP-86 key the vault signs schnorr payloads with). Without `taprootPublicKey` no taproot script is
 * the account's: taproot receive, coins and messages are unavailable (plain "taproot-unavailable" error),
 * because a P2TR script built from the BIP-84 key would not match what the vault signs.
 */
import { type Account, type ChildAddress, ClipError, type Network } from "@clip-wallet/core";
import { hex } from "@scure/base";
import { Address, OutScript, p2pkh, p2tr, p2wpkh } from "@scure/btc-signer";
import { equalBytes, taprootTweakPubkey } from "@scure/btc-signer/utils.js";
import { btcNet } from "./networks.js";

export const BIP84_PURPOSE = 84;
export const BIP86_PURPOSE = 86;

function checkIndex(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error("account index out of range");
}

export function derivationPath(index: number, mainnet = false): string {
  checkIndex(index);
  return `m/84'/${mainnet ? 0 : 1}'/0'/0/${index}`;
}

export function derivationPathTaproot(index: number, mainnet = false): string {
  checkIndex(index);
  return `m/86'/${mainnet ? 0 : 1}'/0'/0/${index}`;
}

export const pubkeyOf = (account: Account): Uint8Array => hex.decode(account.publicKey);
export const xOnly = (pub: Uint8Array): Uint8Array => (pub.length === 33 ? pub.slice(1) : pub);

export function segwitAddress(pub: Uint8Array, network: Network): string {
  return p2wpkh(pub, btcNet(network)).address!;
}

export function taprootAddress(pub: Uint8Array, network: Network): string {
  return p2tr(xOnly(pub), undefined, btcNet(network)).address!;
}

/** The account's BIP-86 internal key (x-only), or undefined when the background didn't supply one. */
export function taprootKeyOf(account: Account): Uint8Array | undefined {
  if (!account.taprootPublicKey) return undefined;
  const k = xOnly(hex.decode(account.taprootPublicKey));
  if (k.length !== 32) throw new Error("taprootPublicKey must be an x-only or compressed secp256k1 key");
  return k;
}

export const TAPROOT_UNAVAILABLE = "Taproot (bc1p…) addresses aren't available for this account yet. Use your bc1q/tb1q address instead.";

/** The account's own taproot (BIP-86) receive address, or a plain-words error when it has none. */
export function ownTaprootAddress(account: Account, network: Network): string {
  const k = taprootKeyOf(account);
  if (!k) throw new ClipError(TAPROOT_UNAVAILABLE, "taproot-unavailable");
  return taprootAddress(k, network);
}

/**
 * BIP-341 output key Q = P + H_TapTweak(P_x ‖ merkleRoot)·G (x-only). Public-key maths only, used to match
 * scripts and verify signatures; the vault computes the same tweak itself from `taprootTweak` = merkleRoot.
 */
export function taprootOutputKey(internalKey: Uint8Array, merkleRoot: Uint8Array = new Uint8Array()): Uint8Array {
  return taprootTweakPubkey(xOnly(internalKey), merkleRoot)[0];
}

/** A P2WPKH change key of the account (m/84'/c'/0'/1/n), signed by the vault via `derivationSubPath`. */
export interface ChangeKey {
  pubkey: Uint8Array;
  wpkh: Uint8Array;
  /** "1/<n>", relative to the BIP-84 account node. */
  subPath: string;
}

export interface OwnScripts {
  /** BIP-84 key (account.publicKey). */
  pubkey: Uint8Array;
  wpkh: Uint8Array;
  /** BIP-86 internal key (x-only, account.taprootPublicKey). Absent → no taproot script is ours. */
  trInternalKey?: Uint8Array;
  /** BIP-86 key-path P2TR script of trInternalKey. */
  tr?: Uint8Array;
  /** BIP-86 output key (tweaked with an empty merkle root, x-only). */
  trOutputKey?: Uint8Array;
  /** Change keys the vault handed out to this account (ChainContext.changeAddresses). */
  change: ChangeKey[];
}

const CHANGE_SUBPATH = /^1\/\d{1,10}$/;

/** Validates a vault-supplied change address: sub-path "1/<n>", 33-byte key, and the address matches the key. */
export function changeKey(c: ChildAddress, network?: Network): ChangeKey {
  if (!CHANGE_SUBPATH.test(c.derivationSubPath)) throw new Error(`bad change sub-path ${c.derivationSubPath}`);
  const pubkey = hex.decode(c.publicKey);
  if (pubkey.length !== 33) throw new Error("change key must be a compressed public key");
  if (network && segwitAddress(pubkey, network) !== c.address) throw new Error("change address doesn't match its key");
  return { pubkey, wpkh: p2wpkh(pubkey).script, subPath: c.derivationSubPath };
}

export function ownScripts(account: Account, change: ChildAddress[] = [], network?: Network): OwnScripts {
  const pubkey = pubkeyOf(account);
  const own: OwnScripts = { pubkey, wpkh: p2wpkh(pubkey).script, change: change.map((c) => changeKey(c, network)) };
  const trKey = taprootKeyOf(account);
  if (trKey) {
    const tr = p2tr(trKey);
    own.trInternalKey = trKey;
    own.tr = tr.script;
    own.trOutputKey = tr.tweakedPubkey;
  }
  return own;
}

export type OwnKind = "wpkh" | "tr" | null;

export function ownKind(script: Uint8Array, own: OwnScripts): OwnKind {
  if (equalBytes(script, own.wpkh)) return "wpkh";
  if (own.tr && equalBytes(script, own.tr)) return "tr";
  if (own.change.some((c) => equalBytes(script, c.wpkh))) return "wpkh";
  return null;
}

/** The change key that owns this script, if it is a change output/input. */
export function changeKeyOf(script: Uint8Array, own: OwnScripts): ChangeKey | undefined {
  return own.change.find((c) => equalBytes(script, c.wpkh));
}

/** P2WPKH scriptCode for BIP-143: the P2PKH script of the key hash. */
export const wpkhScriptCode = (pubkey: Uint8Array): Uint8Array => p2pkh(pubkey).script;

export function addressOfScript(script: Uint8Array, network: Network): string | undefined {
  try {
    const decoded = OutScript.decode(script);
    if (decoded.type === "unknown") return undefined;
    return Address(btcNet(network)).encode(decoded);
  } catch {
    return undefined;
  }
}

export function isOpReturn(script: Uint8Array): boolean {
  return script.length > 0 && script[0] === 0x6a;
}

/** Script type for size estimates. */
export function scriptType(script: Uint8Array): "wpkh" | "tr" | "pkh" | "sh" | "wsh" | "other" {
  try {
    const t = OutScript.decode(script).type;
    if (t === "wpkh" || t === "tr" || t === "pkh" || t === "sh" || t === "wsh") return t;
  } catch {
    /* fallthrough */
  }
  return "other";
}

/* ------------------------------------------------------------------ change addresses */

/**
 * Change goes to a fresh P2WPKH address on the internal chain, m/84'/<coin>'/0'/1/<n>, when the background
 * supplies `ChainContext.freshChangeAddress` (the vault's `freshChange`). Coins on change addresses the
 * vault handed out (`ChainContext.changeAddresses`) count as the account's and are signed with
 * `SignablePayload.derivationSubPath = "1/<n>"`. Without these, change returns to the primary address (v1).
 */
