import {
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { VaultErrors } from "./errors.js";

export type PhraseLength = 12 | 24;

/** NFKD, lower-case, single spaces. Users paste phrases with odd whitespace and capitals. */
export function normalizePhrase(phrase: string): string {
  return phrase.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
}

export function newPhrase(words: PhraseLength = 12): string {
  return generateMnemonic(wordlist, words === 24 ? 256 : 128);
}

/** Throws ClipError("vault/invalid-phrase") unless the phrase is 12 or 24 English words with a valid checksum. */
export function assertValidPhrase(phrase: string): string {
  const n = normalizePhrase(phrase);
  const count = n.split(" ").length;
  if (count !== 12 && count !== 24) throw VaultErrors.invalidPhrase(`expected 12 or 24 words, got ${count}`);
  if (!validateMnemonic(n, wordlist)) throw VaultErrors.invalidPhrase("unknown word or bad checksum");
  return n;
}

export function isValidPhrase(phrase: string): boolean {
  try {
    assertValidPhrase(phrase);
    return true;
  } catch {
    return false;
  }
}

export const phraseToEntropy = (phrase: string): Uint8Array => mnemonicToEntropy(assertValidPhrase(phrase), wordlist);
export const entropyToPhrase = (entropy: Uint8Array): string => entropyToMnemonic(entropy, wordlist);

/**
 * BIP-39 seed. The BIP-39 passphrase ("25th word") is NOT supported in v1; the vault always passes "".
 * The `passphrase` parameter exists only so the official vectors (passphrase "TREZOR") can be tested.
 * @internal
 */
export function phraseToSeed(phrase: string, passphrase = ""): Promise<Uint8Array> {
  return mnemonicToSeed(assertValidPhrase(phrase), passphrase);
}
