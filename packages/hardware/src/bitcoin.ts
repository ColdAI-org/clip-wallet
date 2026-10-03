/**
 * PSBT plumbing shared by Ledger and Keystone. Public data only: we add BIP-32 derivation records so
 * a device can recognise its own inputs, and read signatures back. Each device signs the whole PSBT
 * once; the per-input SignablePayloads of one approval are then answered from that one signing.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Transaction, p2wpkh, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import type { SignablePayload } from "@clip-wallet/core";
import { equal, fromHex, toHex } from "./bytes.js";
import { HardwareErrors } from "./errors.js";
import { parsePath } from "./paths.js";
import type { HardwareAccount } from "./types.js";

export const PSBT_OPTS = {
  allowUnknownOutputs: true,
  allowUnknownInputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
} as const;

export function readPsbt(bytes: Uint8Array): Transaction {
  try {
    return Transaction.fromPSBT(bytes, PSBT_OPTS);
  } catch (e) {
    throw HardwareErrors.wrongQr("a Bitcoin transaction", e);
  }
}

export function segwitAddress(publicKey: Uint8Array, network: "mainnet" | "testnet"): string {
  return p2wpkh(publicKey, network === "mainnet" ? NETWORK : TEST_NETWORK).address!;
}

/** The payloads of one approval that belong to one PSBT, checked for consistency. */
export function psbtPayloads(payload: SignablePayload): { psbt: Uint8Array; inputIndex: number } {
  const raw = payload.raw;
  if (!raw || raw.format !== "psbt" || raw.inputIndex === undefined) throw HardwareErrors.needsDeviceView("this Bitcoin transaction");
  if (payload.scheme !== "ecdsa-secp256k1") throw HardwareErrors.unsupported("Taproot (bc1p) inputs");
  return { psbt: raw.bytes, inputIndex: raw.inputIndex };
}

/**
 * Adds BIP-32 derivation (master fingerprint + full path) for every input paying to this account's
 * P2WPKH script, so the device knows which inputs are its own. Returns PSBT v0 bytes.
 */
export function withDerivations(psbt: Uint8Array, account: HardwareAccount): { bytes: Uint8Array; inputs: number[] } {
  const tx = readPsbt(psbt);
  const pub = fromHex(account.publicKey);
  const script = p2wpkh(pub).script;
  const fingerprint = parseInt(account.hardware.fingerprint, 16);
  const path = parsePath(account.hardware.path);
  const inputs: number[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const s = inp.witnessUtxo?.script;
    if (!s || !equal(s, script)) continue;
    tx.updateInput(i, { bip32Derivation: [[pub, { fingerprint, path }]] }, true);
    inputs.push(i);
  }
  if (inputs.length === 0) throw HardwareErrors.unsupported("a transaction that spends none of this account's coins");
  return { bytes: tx.toPSBT(0), inputs };
}

/** DER (+ optional sighash byte) to 64-byte compact r||s. */
export function derToCompact(der: Uint8Array): Uint8Array {
  const body = der[0] === 0x30 && der.length === der[1]! + 3 ? der.subarray(0, der.length - 1) : der;
  return secp256k1.Signature.fromBytes(body, "der").toBytes("compact");
}

/** The partial signature a device put on `inputIndex` for `publicKey`, as compact r||s. */
export function partialSigFrom(signed: Uint8Array, inputIndex: number, publicKeyHex: string): Uint8Array {
  const tx = readPsbt(signed);
  const sigs = tx.getInput(inputIndex).partialSig ?? [];
  const mine = sigs.find(([pk]) => toHex(pk) === publicKeyHex.toLowerCase());
  if (!mine) throw HardwareErrors.badSignature(`no signature on input ${inputIndex}`);
  return derToCompact(mine[1]);
}

/** Cache key for "this PSBT under this approval". */
export const psbtKey = (approvalId: string, psbt: Uint8Array): string => `${approvalId}:${toHex(sha256(psbt))}`;
