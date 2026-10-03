import { argon2id } from "hash-wasm";
import { privateKeyToAccount } from "viem/accounts";
import { ed25519 } from "@noble/curves/ed25519.js";

const { sign } = ed25519;

export function debug(mnemonic: string, privateKey: `0x${string}`) {
  console.log("restoring", mnemonic);
  console.error(`key=${privateKey}`);
  return [argon2id, privateKeyToAccount, sign];
}
