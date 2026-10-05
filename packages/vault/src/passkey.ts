/**
 * Passkey (WebAuthn PRF) support. The vault does the crypto and storage; the app does the WebAuthn calls
 * by implementing PasskeyPrf. If the authenticator/browser has no PRF, the app must not offer passkey
 * unlock and the user keeps using the password (see README "Passkey unlock").
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { concat, equalBytes, randomBytes, utf8, wipe } from "./bytes.js";
import { hkdf32 } from "./crypto.js";
import { entropyToPhrase, phraseToEntropy } from "./phrase.js";

/**
 * Implemented by the app with navigator.credentials:
 *  - enroll: credentials.create({ publicKey: { ..., extensions: { prf: { eval: { first: prfInput } } } } }).
 *    If the authenticator returns `prf.enabled` but no `results` at creation time, follow up with one
 *    credentials.get() using the same prfInput and return that output. If PRF is unsupported, throw.
 *  - evaluate: credentials.get({ publicKey: { allowCredentials: [{ id: credentialId, type: "public-key" }],
 *    extensions: { prf: { eval: { first: prfInput } } } } }) -> clientExtensionResults.prf.results.first.
 * `prfInput` is chosen by the vault and stored next to the wrapped key; implementations that ignore it
 * (e.g. a fixed app-wide salt) still work as long as enroll and evaluate use the same value.
 */
export interface PasskeyPrf {
  enroll(prfInput: Uint8Array): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }>;
  evaluate(credentialId: Uint8Array, prfInput: Uint8Array): Promise<Uint8Array>;
}

export const PASSKEY_WRAP_INFO = "clip-wallet/vault/passkey-wrap/v1";
const BACKUP_INFO = "clip-wallet/passkey-backup/v1";

/** Recommended PRF input (eval.first) for Phase-2 backups, distinct from any unlock input. */
export const BACKUP_PRF_INPUT: Uint8Array = sha256(utf8("clip-wallet/passkey-backup/prf-input/v1"));

/** Key that wraps the VEK, from a PRF output. */
export function passkeyWrapKey(prfOutput: Uint8Array, salt: Uint8Array): Uint8Array {
  if (prfOutput.length < 32) throw new Error("PRF output must be at least 32 bytes");
  return hkdf32(prfOutput, salt, PASSKEY_WRAP_INFO);
}

/* ------------------------------------------------------------ Phase 2: passkey-encrypted phrase backup */

const MAGIC = utf8("CLPB");
const VERSION = 1;
const HEADER_LEN = MAGIC.length + 1 + 32; // magic | version | salt
const NONCE_LEN = 24;

/**
 * Encrypts a recovery phrase under a PRF-derived key, producing an opaque blob the app can store anywhere
 * (no network calls here). Layout: "CLPB" | 0x01 | salt(32) | nonce(24) | XChaCha20-Poly1305(entropy).
 * Header is authenticated as AAD. Only the BIP-39 entropy is stored; decrypt() rebuilds the phrase.
 */
export const passkeyBackup = {
  encrypt(phrase: string, prfOutput: Uint8Array): Uint8Array {
    if (prfOutput.length < 32) throw new Error("PRF output must be at least 32 bytes");
    const entropy = phraseToEntropy(phrase);
    const salt = randomBytes(32);
    const header = concat(MAGIC, new Uint8Array([VERSION]), salt);
    const key = hkdf32(prfOutput, salt, BACKUP_INFO);
    const nonce = randomBytes(NONCE_LEN);
    try {
      return concat(header, nonce, xchacha20poly1305(key, nonce, header).encrypt(entropy));
    } finally {
      wipe(key, entropy);
    }
  },
  decrypt(blob: Uint8Array, prfOutput: Uint8Array): string {
    if (prfOutput.length < 32) throw new Error("PRF output must be at least 32 bytes");
    if (blob.length < HEADER_LEN + NONCE_LEN + 16 || !equalBytes(blob.subarray(0, 4), MAGIC) || blob[4] !== VERSION)
      throw new Error("not a Clip passkey backup");
    const header = blob.subarray(0, HEADER_LEN);
    const salt = blob.subarray(5, HEADER_LEN);
    const nonce = blob.subarray(HEADER_LEN, HEADER_LEN + NONCE_LEN);
    const key = hkdf32(prfOutput, salt, BACKUP_INFO);
    let entropy: Uint8Array | undefined;
    try {
      entropy = xchacha20poly1305(key, nonce, header).decrypt(blob.subarray(HEADER_LEN + NONCE_LEN));
      return entropyToPhrase(entropy);
    } finally {
      wipe(key, entropy);
    }
  },
};
