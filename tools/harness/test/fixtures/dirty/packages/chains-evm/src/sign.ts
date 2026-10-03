import { secp256k1 } from "@noble/curves/secp256k1.js";
import { unlock } from "@clip-wallet/vault";

export const sign = (h: Uint8Array, k: Uint8Array) => secp256k1.sign(h, k);
export { unlock };
