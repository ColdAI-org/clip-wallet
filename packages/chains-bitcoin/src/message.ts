/**
 * Message signing.
 *  - BIP-322 "simple" (default): virtual to_spend / to_sign transactions; the signature is the
 *    to_sign input's witness, base64.
 *  - BIP-137 "ecdsa" (legacy signmessage), for P2WPKH addresses only, header 39 + recovery.
 */
import { base64 } from "@scure/base";
import { RawWitness, Script, SigHash, Transaction } from "@scure/btc-signer";
import { RawOldTx } from "@scure/btc-signer/script.js";
import { concatBytes, sha256x2, tagSchnorr } from "@scure/btc-signer/utils.js";
import { ClipError } from "@clip-wallet/core";
import { type OwnScripts, TAPROOT_UNAVAILABLE, wpkhScriptCode } from "./keys.js";
import { TX_OPTS } from "./psbt.js";

const enc = new TextEncoder();

export const bip322MessageHash = (message: Uint8Array): Uint8Array => tagSchnorr("BIP0322-signed-message", message);

export function bip322ToSpend(message: Uint8Array, scriptPubKey: Uint8Array): Uint8Array {
  return RawOldTx.encode({
    version: 0,
    inputs: [{ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: Script.encode(["OP_0", bip322MessageHash(message)]), sequence: 0 }],
    outputs: [{ amount: 0n, script: scriptPubKey }],
    lockTime: 0,
  });
}

/** Display-order txid of a serialized (non-witness) tx. */
export const txidOf = (raw: Uint8Array): Uint8Array => sha256x2(raw).reverse();

export function bip322ToSign(message: Uint8Array, scriptPubKey: Uint8Array): Transaction {
  const toSpendId = txidOf(bip322ToSpend(message, scriptPubKey));
  const tx = new Transaction({ ...TX_OPTS, version: 0, allowUnknownVersion: true, lockTime: 0 });
  tx.addInput({ txid: toSpendId, index: 0, sequence: 0, witnessUtxo: { script: scriptPubKey, amount: 0n } });
  tx.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });
  return tx;
}

export function bip322Digest(message: Uint8Array, kind: "wpkh" | "tr", own: OwnScripts): Uint8Array {
  const script = kind === "wpkh" ? own.wpkh : own.tr;
  if (!script) throw new ClipError(TAPROOT_UNAVAILABLE, "taproot-unavailable");
  const tx = bip322ToSign(message, script);
  return kind === "wpkh"
    ? tx.preimageWitnessV0(0, wpkhScriptCode(own.pubkey), SigHash.ALL, 0n)
    : tx.preimageWitnessV1(0, [script], SigHash.DEFAULT, [0n]);
}

export const encodeSimpleSignature = (witness: Uint8Array[]): string => base64.encode(RawWitness.encode(witness));

/* ------------------------------------------------------------------ BIP-137 */

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24);
}

export function bip137Digest(message: Uint8Array): Uint8Array {
  const prefix = enc.encode("\x18Bitcoin Signed Message:\n");
  return sha256x2(concatBytes(prefix, varint(message.length), message));
}
