import type { Family } from "@clip-wallet/core";
import { z } from "zod";

/**
 * Wire protocol between the three hops:
 *
 *   page (inpage, MAIN world) --window.postMessage--> content script --runtime port--> background
 *
 * Everything that crosses a hop is plain JSON (chrome.runtime ports JSON-serialise), so bytes travel
 * as base64 strings. The page never supplies an origin: the content script adds it.
 */

export const DEFAULT_CHANNEL = "clip-wallet-1mask";

export const FAMILIES = [
  "evm", "hedera", "solana", "bitcoin",
  "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand",
  "cosmos", "provenance", "thorchain", "initia", "tron", "xrpl", "antelope", "multiversx", "icp", "stacks", "fuel", "bitcoincash",
] as const satisfies readonly Family[];
export const familySchema = z.enum(FAMILIES);

export const EVENTS = ["accountsChanged", "chainChanged", "disconnect", "connect"] as const;
export type OneMaskEvent = (typeof EVENTS)[number];
export const eventSchema = z.enum(EVENTS);

const idSchema = z.string().min(1).max(64);
const methodSchema = z.string().min(1).max(128);
/** CAIP-2 or Wallet Standard chain id hint. The background validates it against the registry. */
const chainSchema = z.string().min(3).max(128).optional();

export const rpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string().max(2000),
  data: z.unknown().optional(),
});

/* ---------------------------------------------------------------- page <-> content */

export const SOURCE_INPAGE = "1mask-inpage";
export const SOURCE_CONTENT = "1mask-content";

export const pageRequestSchema = z.strictObject({
  channel: z.string(),
  source: z.literal(SOURCE_INPAGE),
  type: z.literal("request"),
  id: idSchema,
  family: familySchema,
  method: methodSchema,
  params: z.unknown().optional(),
  chain: chainSchema,
});
export type PageRequest = z.infer<typeof pageRequestSchema>;

export const contentResponseSchema = z.object({
  channel: z.string(),
  source: z.literal(SOURCE_CONTENT),
  type: z.literal("response"),
  id: idSchema,
  result: z.unknown().optional(),
  error: rpcErrorSchema.optional(),
});
export type ContentResponse = z.infer<typeof contentResponseSchema>;

export const contentEventSchema = z.object({
  channel: z.string(),
  source: z.literal(SOURCE_CONTENT),
  type: z.literal("event"),
  family: familySchema,
  event: eventSchema,
  data: z.unknown().optional(),
});
export type ContentEvent = z.infer<typeof contentEventSchema>;

export const contentToPageSchema = z.discriminatedUnion("type", [contentResponseSchema, contentEventSchema]);

/* ---------------------------------------------------------------- content <-> background */

export const portRequestSchema = z.strictObject({
  type: z.literal("request"),
  id: idSchema,
  /** Set by the content script from its own `location.origin`. Never from the page. */
  origin: z.string().min(1).max(2048),
  family: familySchema,
  method: methodSchema,
  params: z.unknown().optional(),
  chain: chainSchema,
});
export type PortRequest = z.infer<typeof portRequestSchema>;

export const portResponseSchema = z.object({
  type: z.literal("response"),
  id: idSchema,
  result: z.unknown().optional(),
  error: rpcErrorSchema.optional(),
});
export type PortResponse = z.infer<typeof portResponseSchema>;

export const portEventSchema = z.object({
  type: z.literal("event"),
  family: familySchema,
  event: eventSchema,
  data: z.unknown().optional(),
});
export type PortEvent = z.infer<typeof portEventSchema>;

export const portToContentSchema = z.discriminatedUnion("type", [portResponseSchema, portEventSchema]);
export type PortToContent = z.infer<typeof portToContentSchema>;

/** Name used for chrome.runtime.connect so the background can tell 1Mask ports apart. */
export const PORT_NAME = "clip-wallet-1mask";

/** Hard cap on a single request's serialised size (bytes of JSON). */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/* ---------------------------------------------------------------- shared result shapes */

/** What the background returns for connect-style calls on non-EVM families. */
export interface ExposedAccount {
  address: string;
  /** Hex public key, if the family exposes it (Solana, Bitcoin). */
  publicKey?: string;
}

/** Internal method the inpage EVM provider uses to read its initial state without prompting. */
export const METHOD_PROVIDER_STATE = "1mask_getProviderState";

export interface EvmProviderState {
  chainId: string;
  networkVersion: string;
  accounts: string[];
  isUnlocked: boolean;
}

/** Internal method the Wallet Standard wallets use to learn their accounts silently (no prompt). */
export const METHOD_WS_STATE = "1mask_getAccounts";
