/**
 * @clip-wallet/1mask/walletconnect — WalletConnect wallet side (Reown WalletKit).
 *
 * Pair, map CAIP-25 proposals to Clip accounts (eip155, solana, bip122, hedera), turn
 * session_request into DappRequest{via:"walletconnect"}, attach Verify API warnings, support
 * one-click auth (session_authenticate / CAIP-122), list and disconnect sessions.
 */
export * from "./namespaces.js";
export * from "./verify.js";
export * from "./wallet.js";
