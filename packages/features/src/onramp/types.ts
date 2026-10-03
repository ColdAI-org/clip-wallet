import type { Network } from "@clip-wallet/core";
import type { Unavailable } from "../views.js";

/** Where a coin can be delivered, in the providers' own vocabulary. */
export type ChainKey = "ethereum" | "base" | "solana" | "hedera";

export interface OnRampRequest {
  assetKey: string;
  chain: ChainKey;
  /** The wallet's receiving address on that network (Hedera: 0.0.x). */
  address: string;
  fiatAmount: number;
  /** ISO 4217, upper case. */
  fiatCurrency: string;
  /** Test networks → the provider's sandbox. */
  sandbox: boolean;
}

export interface OnRampProvider {
  id: string;
  name: string;
  methods: string;
  /** Null when configured; otherwise a plain reason. */
  configured(): Unavailable | null;
  supports(assetKey: string, chain: ChainKey, sandbox: boolean): boolean;
  /** Hosted-widget URL. Never contains a secret (MoonPay's signature comes from your signing endpoint). */
  buildUrl(r: OnRampRequest, fetchImpl: typeof fetch): Promise<string>;
}

const BY_CHAIN_ID: Record<number, ChainKey> = { 1: "ethereum", 11155111: "ethereum", 8453: "base", 84532: "base" };

export function chainKeyOf(n: Network): ChainKey | null {
  if (n.family === "solana") return "solana";
  if (n.family === "hedera") return "hedera";
  if (n.family === "evm" && n.chainId !== undefined) return BY_CHAIN_ID[n.chainId] ?? null;
  return null;
}

/** Cheapest place to receive first (fees to move it later are lowest there). */
export const CHAIN_PREFERENCE: readonly ChainKey[] = ["hedera", "solana", "base", "ethereum"];
