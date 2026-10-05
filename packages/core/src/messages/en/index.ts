/**
 * The background's English messages ("bg.*"), the source every language translates. Plain {arguments} only
 * (no plural/select in English: fillTemplate renders the fallback without the ICU parser); translations may
 * use plural/select on the same arguments.
 */
import requests from "./requests.js";
import labels from "./labels.js";
import warnings from "./warnings.js";
import errors from "./errors.js";
import activity from "./activity.js";
/** chains-evm, chains-bitcoin, chains-solana, chains-hedera, 1mask */
import chainsA from "./chainsA.js";
/** chains-algorand, chains-aptos, chains-cardano, chains-near, chains-starknet */
import chainsB from "./chainsB.js";
/** chains-stellar, chains-substrate, chains-sui, chains-tezos, chains-ton */
import chainsC from "./chainsC.js";
/** features (staking, swaps, trade, steps), security, route, social handles */
import features from "./features.js";

/** The parts, for the duplicate-id test (a later part must never silently replace an earlier id). */
export const BG_MESSAGE_PARTS = { requests, labels, warnings, errors, activity, chainsA, chainsB, chainsC, features } as const;

export const BG_MESSAGES = {
  ...requests,
  ...labels,
  ...warnings,
  ...errors,
  ...activity,
  ...chainsA,
  ...chainsB,
  ...chainsC,
  ...features,
} as const;

export type BgMessages = typeof BG_MESSAGES;
export type BgMessageId = keyof BgMessages;
/** A translation of every background message (typecheck fails on a missing or extra id). */
export type BgTranslation = { readonly [K in BgMessageId]: string };
