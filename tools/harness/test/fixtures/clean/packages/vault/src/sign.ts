import { secp256k1 } from "@noble/curves/secp256k1.js";
import { mnemonicToSeedSync } from "@scure/bip39";
import { argon2id } from "hash-wasm";

export const sign = (h: Uint8Array, k: Uint8Array) => secp256k1.sign(h, k);
export { mnemonicToSeedSync, argon2id };
