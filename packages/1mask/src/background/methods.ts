import type { Family } from "@clip-wallet/core";
import { METHOD_PROVIDER_STATE, METHOD_WS_STATE } from "../shared/protocol.js";

/**
 * Method allowlists per family. Anything not listed is answered with 4200 (unsupported method)
 * before it reaches `handle`.
 */

export const EVM_METHODS = {
  /** Answered by the router itself (no prompt, no `handle`). */
  local: [
    METHOD_PROVIDER_STATE,
    "eth_accounts",
    "eth_chainId",
    "net_version",
    "wallet_getPermissions",
    "wallet_revokePermissions",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
  ],
  /** Connect approval; grants the per-origin "evm" permission. */
  connect: ["eth_requestAccounts", "wallet_requestPermissions"],
  /** Need the permission and an approval. */
  signing: ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"],
  /** Proxied to `handle` (the background answers from its RPC). No permission needed, no approval. */
  readOnly: [
    "eth_blockNumber",
    "eth_call",
    "eth_estimateGas",
    "eth_feeHistory",
    "eth_gasPrice",
    "eth_getBalance",
    "eth_getBlockByHash",
    "eth_getBlockByNumber",
    "eth_getCode",
    "eth_getLogs",
    "eth_getStorageAt",
    "eth_getTransactionByHash",
    "eth_getTransactionCount",
    "eth_getTransactionReceipt",
    "eth_maxPriorityFeePerGas",
    "eth_syncing",
    "web3_clientVersion",
  ],
  /** Refused outright. eth_sign signs an arbitrary 32-byte hash: it can hide any transaction. */
  rejected: ["eth_sign"],
} as const;

export const SOLANA_METHODS = {
  local: [METHOD_WS_STATE, "standard:disconnect"],
  connect: ["standard:connect"],
  /** signIn connects and signs in one approval. */
  signIn: ["solana:signIn"],
  signing: ["solana:signTransaction", "solana:signAndSendTransaction", "solana:signMessage"],
} as const;

export const BITCOIN_METHODS_ALLOWED = {
  local: [METHOD_WS_STATE, "bitcoin:disconnect"],
  connect: ["bitcoin:connect"],
  signing: ["bitcoin:signTransaction", "bitcoin:signAndSendTransaction", "bitcoin:signMessage", "bitcoin:sendTransfer"],
} as const;

/**
 * Hedera native methods (hashgraph/hedera-wallet-connect `HederaJsonRpcMethod`). Reached only over
 * WalletConnect (namespace "hedera"); there is no injected Hedera provider in v1.
 */
export const HEDERA_METHODS = [
  "hedera_getNodeAddresses",
  "hedera_executeTransaction",
  "hedera_signMessage",
  "hedera_signAndExecuteQuery",
  "hedera_signAndExecuteTransaction",
  "hedera_signTransaction",
] as const;

export function injectedAllowlist(family: Family): ReadonlySet<string> {
  switch (family) {
    case "evm":
      return new Set<string>([
        ...EVM_METHODS.local,
        ...EVM_METHODS.connect,
        ...EVM_METHODS.signing,
        ...EVM_METHODS.readOnly,
      ]);
    case "solana":
      return new Set<string>([...SOLANA_METHODS.local, ...SOLANA_METHODS.connect, ...SOLANA_METHODS.signIn, ...SOLANA_METHODS.signing]);
    case "bitcoin":
      return new Set<string>([...BITCOIN_METHODS_ALLOWED.local, ...BITCOIN_METHODS_ALLOWED.connect, ...BITCOIN_METHODS_ALLOWED.signing]);
    case "hedera":
      return new Set<string>();
    default:
      // Phase 2 families register their injected methods here as their connectors land.
      return new Set<string>();
  }
}
