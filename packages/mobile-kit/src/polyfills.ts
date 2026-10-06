/**
 * Must be the first import (index.ts). WalletConnect's React Native compat layer installs
 * crypto.getRandomValues (react-native-get-random-values), TextEncoder/TextDecoder (fast-text-encoding),
 * URL (react-native-url-polyfill), Buffer, atob/btoa. We add crypto.randomUUID (expo-crypto) and a
 * structuredClone fallback for JSON-shaped data where the engine (Hermes) lacks them.
 *
 * @module
 */
import "@walletconnect/react-native-compat";
import { randomUUID } from "expo-crypto";

const g = globalThis as unknown as { crypto: Crypto & { randomUUID?: () => string }; structuredClone?: <T>(v: T) => T };
if (g.crypto && typeof g.crypto.randomUUID !== "function") {
  Object.defineProperty(g.crypto, "randomUUID", { value: () => randomUUID(), configurable: true });
}
if (typeof g.structuredClone !== "function") {
  g.structuredClone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}
