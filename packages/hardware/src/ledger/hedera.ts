/**
 * Ledger Hedera app, spoken to directly. Verified against the app source
 * (github.com/LedgerHQ/app-hedera, v1.9.2: src/hedera.c, src/get_public_key.c, src/sign_transaction.c):
 *  - keys are Ed25519 at m/44'/3030'/0'/0'/index' (the app builds the path; we send only `index`)
 *  - GET_PUBLIC_KEY  CLA 0xE0 INS 0x02 P1 0x01 (silent) / 0x00 (show)  data: index u32 LE  -> 32-byte key
 *  - SIGN_TRANSACTION CLA 0xE0 INS 0x04 P1 0x00 P2 0x00  data: index u32 LE || TransactionBody bytes -> 64-byte sig
 * We don't use @ledgerhq/hw-app-hedera 1.7.0: its signTransaction always sends index 0 and its
 * getPublicKey sends a BIP-32 path the app reads as a little-endian index.
 * The device decodes the TransactionBody protobuf itself and shows it; the body must fit one APDU.
 */
import type Transport from "@ledgerhq/hw-transport";
import type { SignablePayload, Signature } from "@clip-wallet/core";
import { concat, equal, toHex } from "../bytes.js";
import { HardwareErrors } from "../errors.js";
import { ed25519Signature } from "../verify.js";

const CLA = 0xe0;
const INS_GET_PUBLIC_KEY = 0x02;
const INS_SIGN_TRANSACTION = 0x04;
/** APDU data is at most 255 bytes: 4 for the index leaves 251 for the body. */
export const HEDERA_MAX_BODY = 251;

const le32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};

export async function hederaPublicKey(t: Transport, index: number, show = false): Promise<string> {
  const r = await t.send(CLA, INS_GET_PUBLIC_KEY, show ? 0x00 : 0x01, 0x00, Buffer.from(le32(index)));
  return toHex(new Uint8Array(r.subarray(0, 32)));
}

export async function hederaSign(t: Transport, index: number, payload: SignablePayload, publicKey: string): Promise<Signature> {
  if (payload.scheme !== "ed25519") {
    // The vault's Hedera accounts are ECDSA; the Ledger app only has Ed25519 keys.
    throw HardwareErrors.unsupported("this kind of Hedera signature");
  }
  const body = payload.raw?.format === "hedera-body" ? payload.raw.bytes : payload.bytes;
  if (!equal(body, payload.bytes)) throw HardwareErrors.badSignature("raw body differs from the approved bytes");
  if (body.length > HEDERA_MAX_BODY) throw HardwareErrors.tooBig();
  const r = await t.send(CLA, INS_SIGN_TRANSACTION, 0x00, 0x00, Buffer.from(concat(le32(index), body)));
  return ed25519Signature(new Uint8Array(r.subarray(0, 64)), payload.bytes, publicKey);
}
