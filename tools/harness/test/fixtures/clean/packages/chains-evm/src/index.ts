// Verification and public-key maths are fine in a chain module: secp256k1.sign is only mentioned in this comment.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { ChainModule } from "@clip-wallet/core";
import type { Vault } from "@clip-wallet/vault";

export const verify = (sig: Uint8Array, h: Uint8Array, pub: Uint8Array) => secp256k1.verify(sig, h, pub);
export const point = (pub: Uint8Array) => secp256k1.Point.fromBytes(pub).toBytes(false);
export const evm = {} as unknown as ChainModule;
export type V = Vault;
console.log("Write your seed phrase down on paper", point.length);
