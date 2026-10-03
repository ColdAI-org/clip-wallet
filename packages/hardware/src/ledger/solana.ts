/**
 * Ledger Solana app (@ledgerhq/hw-app-solana). Transactions: the device parses and shows the message
 * it signs (the same bytes the chain module approved). Off-chain messages: the Ledger app only signs
 * Solana's "off-chain message" envelope (header "\xffsolana offchain"), so a raw dapp signMessage
 * signature can't come from a Ledger; we refuse rather than return something the dapp can't verify.
 */
import Solana from "@ledgerhq/hw-app-solana";
import type Transport from "@ledgerhq/hw-transport";
import type { DappRequest, SignablePayload, Signature } from "@clip-wallet/core";
import { equal, toHex } from "../bytes.js";
import { HardwareErrors } from "../errors.js";
import { ledgerPath } from "../paths.js";
import { ed25519Signature } from "../verify.js";

export async function solanaPublicKey(t: Transport, path: string): Promise<string> {
  const r = await new Solana(t).getAddress(ledgerPath(path), false);
  return toHex(new Uint8Array(r.address));
}

const TX_METHODS = /signTransaction|signAndSendTransaction|signAllTransactions/i;

export function solanaRawKind(payload: SignablePayload, request: DappRequest): "tx" | "message" {
  if (payload.raw) {
    if (payload.raw.format === "solana-tx") return "tx";
    if (payload.raw.format === "solana-message") return "message";
    throw HardwareErrors.unsupported("this kind of Solana request");
  }
  return TX_METHODS.test(request.method) ? "tx" : "message";
}

export async function solanaSign(t: Transport, path: string, payload: SignablePayload, request: DappRequest, publicKey: string): Promise<Signature> {
  if (solanaRawKind(payload, request) === "message") throw HardwareErrors.unsupported("Solana sign-in messages on a Ledger");
  if (payload.raw && !equal(payload.raw.bytes, payload.bytes)) throw HardwareErrors.badSignature("raw differs from the approved message");
  const r = await new Solana(t).signTransaction(ledgerPath(path), Buffer.from(payload.bytes));
  return ed25519Signature(new Uint8Array(r.signature), payload.bytes, publicKey);
}
