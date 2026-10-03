import { mnemonicToSeedSync } from "@scure/bip39";
import * as curves from "@noble/curves/ed25519.js";
import type { ChainModule } from "@clip-wallet/core";

export const solana = {} as unknown as ChainModule;
export const seedOf = (p: string) => mnemonicToSeedSync(p);
export const pub = (k: Uint8Array) => curves.ed25519.getPublicKey(k);
