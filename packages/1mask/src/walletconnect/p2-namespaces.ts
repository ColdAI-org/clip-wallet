import type { Family } from "@clip-wallet/core";

/**
 * WalletConnect namespaces for NEAR, Stellar, Tezos and Algorand, merged into namespaces.ts
 * (WC_NAMESPACE_FAMILY / WC_SUPPORTED_METHODS / WC_SUPPORTED_EVENTS) by the integration step.
 * Method names are what each ecosystem's WalletConnect dApp side sends:
 *  - near: near/wallet-selector packages/wallet-connect (chains near:mainnet / near:testnet).
 *  - stellar: Reown RPC reference (stellar_signXDR, stellar_signAndSubmitXDR) plus the two extra methods
 *    @creit.tech/stellar-wallets-kit 2.7 WalletConnectModule sends (stellar_signMessage, stellar_signAuthEntry).
 *  - tezos: Reown Tezos RPC reference (tezos_getAccounts, tezos_send, tezos_sign).
 *  - algorand: Reown Algorand RPC reference / ARC-25 (algo_signTxn).
 * Each signing method is a chains-<family> DappRequest method, so the background serves it unchanged.
 */

export type P2WcNamespaceKey = "near" | "stellar" | "tezos" | "algorand";

export const P2_WC_NAMESPACE_FAMILY: Record<P2WcNamespaceKey, Family> = {
  near: "near",
  stellar: "stellar",
  tezos: "tezos",
  algorand: "algorand",
};

export const P2_WC_SUPPORTED_METHODS: Record<P2WcNamespaceKey, readonly string[]> = {
  near: ["near_getAccounts", "near_signIn", "near_signOut", "near_signTransaction", "near_signTransactions", "near_signMessage"],
  stellar: ["stellar_signXDR", "stellar_signAndSubmitXDR", "stellar_signMessage", "stellar_signAuthEntry"],
  tezos: ["tezos_getAccounts", "tezos_send", "tezos_sign"],
  algorand: ["algo_signTxn"],
};

/** Answered by the connector from the session's accounts, never by a chain module. */
export const P2_WC_ACCOUNT_METHODS: Record<P2WcNamespaceKey, readonly string[]> = {
  near: ["near_getAccounts"],
  stellar: [],
  tezos: ["tezos_getAccounts"],
  algorand: [],
};

export const P2_WC_SUPPORTED_EVENTS: Record<P2WcNamespaceKey, readonly string[]> = {
  near: ["accountsChanged"],
  stellar: [],
  tezos: [],
  algorand: [],
};
