/**
 * Sui and Aptos wire method names, as plain strings so the background (allowlists, router) doesn't import the
 * in-page wallets — those pull in @aptos-labs/ts-sdk and @mysten/wallet-standard, which the background never
 * needs. test/move-methods.test.ts checks these against the libraries' own constants.
 */
import { METHOD_WS_STATE } from "./protocol.js";

/** 1Mask-local: the network the site is on, for AIP-62 `aptos:network`. */
export const METHOD_APTOS_NETWORK = "1mask_getNetwork";

/** @aptos-labs/wallet-standard AptosConnectNamespace etc. */
export const APTOS_CONNECT_METHODS = ["aptos:connect"] as const;
export const APTOS_LOCAL_METHODS = [METHOD_WS_STATE, METHOD_APTOS_NETWORK, "aptos:disconnect"] as const;
export const APTOS_SIGNING_METHODS = ["aptos:signTransaction", "aptos:signAndSubmitTransaction", "aptos:signMessage"] as const;

/** @mysten/wallet-standard SuiSignTransaction, SuiSignAndExecuteTransaction, SuiSignPersonalMessage. */
export const SUI_SIGNING_METHODS = ["sui:signTransaction", "sui:signAndExecuteTransaction", "sui:signPersonalMessage"] as const;
