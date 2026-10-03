/**
 * CIP-8 message signing as CIP-30 signData requires it (RFC 8152 COSE_Sign1, EdDSA, payload not hashed, no
 * external_aad):
 *
 *   protected  = { 1 (alg): -8 (EdDSA), "address": <raw address bytes> }
 *   Sig_structure = ["Signature1", bstr(protected), h'', payload]      ← what the key signs
 *   COSE_Sign1 = [bstr(protected), { "hashed": false }, payload, signature]
 *   COSE_Key   = { 1 (kty): 1 (OKP), 3 (alg): -8, -1 (crv): 6 (Ed25519), -2 (x): public key }
 */
import { CborMap, encode } from "./cbor.js";

export function protectedHeader(address: Uint8Array): Uint8Array {
  return encode(new CborMap([[1, -8], ["address", address]]));
}

export function sigStructure(address: Uint8Array, payload: Uint8Array): Uint8Array {
  return encode(["Signature1", protectedHeader(address), new Uint8Array(0), payload]);
}

export function coseSign1(address: Uint8Array, payload: Uint8Array, signature: Uint8Array): Uint8Array {
  return encode([protectedHeader(address), new CborMap([["hashed", false]]), payload, signature]);
}

export function coseKey(publicKey: Uint8Array): Uint8Array {
  return encode(new CborMap([[1, 1], [3, -8], [-1, 6], [-2, publicKey]]));
}
