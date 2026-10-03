/**
 * Paths, addresses and scripts for an account. Public data only.
 *
 * Paths: BIP-84 (P2WPKH) is the account's primary key, m/84'/0'/<index>'/0/0. BIP-86 (P2TR) is
 * m/86'/0'/<index>'/0/0. The contract's derivationPath(index) has no network, so testnets use the
 * same coin type (0') as mainnet: the same key, encoded as tb1… addresses.
 *
 * "Ours": an input/output is the user's when its script is P2WPKH(account key) or P2TR key-path with
 * internal key = account key (x-only). A vault account derived at the BIP-86 path is handled the same
 * way (its key's P2TR script matches).
 */
import type { Account, Network } from "@clip-wallet/core";
import { hex } from "@scure/base";
import { Address, OutScript, p2pkh, p2tr, p2wpkh } from "@scure/btc-signer";
import { equalBytes } from "@scure/btc-signer/utils.js";
import { btcNet } from "./networks.js";

export const BIP84_PURPOSE = 84;
export const BIP86_PURPOSE = 86;

function checkIndex(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error("account index out of range");
}

export function derivationPath(index: number): string {
  checkIndex(index);
  return `m/84'/0'/${index}'/0/0`;
}

export function derivationPathTaproot(index: number): string {
  checkIndex(index);
  return `m/86'/0'/${index}'/0/0`;
}

export const pubkeyOf = (account: Account): Uint8Array => hex.decode(account.publicKey);
export const xOnly = (pub: Uint8Array): Uint8Array => (pub.length === 33 ? pub.slice(1) : pub);

export function segwitAddress(pub: Uint8Array, network: Network): string {
  return p2wpkh(pub, btcNet(network)).address!;
}

export function taprootAddress(pub: Uint8Array, network: Network): string {
  return p2tr(xOnly(pub), undefined, btcNet(network)).address!;
}

export interface OwnScripts {
  pubkey: Uint8Array;
  wpkh: Uint8Array;
  tr: Uint8Array;
  /** BIP-86 output key (tweaked, x-only). */
  trOutputKey: Uint8Array;
}

export function ownScripts(account: Account): OwnScripts {
  const pubkey = pubkeyOf(account);
  const tr = p2tr(xOnly(pubkey));
  return { pubkey, wpkh: p2wpkh(pubkey).script, tr: tr.script, trOutputKey: tr.tweakedPubkey };
}

export type OwnKind = "wpkh" | "tr" | null;

export function ownKind(script: Uint8Array, own: OwnScripts): OwnKind {
  if (equalBytes(script, own.wpkh)) return "wpkh";
  if (equalBytes(script, own.tr)) return "tr";
  return null;
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
 * v1 sends change back to the account's primary P2WPKH address. Fresh change addresses (<account>/1/n)
 * need key derivation, which only the vault may do (harness rule), and a way for the vault to sign
 * with that child key. The contract can't express either today; see the report for the proposed
 * additive fields (`Account.changeAddresses` / `Vault.deriveChange`, `SignablePayload.derivationSubPath`).
 */
