/**
 * Hedera's injected surface is discovery only (inpage/hedera.ts): a dApp's DAppConnector hands the wallet a
 * WalletConnect pairing code. The router passes it to the host's `walletConnectPair` (opt-in); everything after that
 * is the normal WalletConnect flow with its own approval.
 */
export const HEDERA_WC_PAIR = "hedera:walletConnectPair";
export const HEDERA_INJECTED_METHODS = [HEDERA_WC_PAIR] as const;

/** WalletConnect v2 pairing URI (the same check as the wallet's paste field). */
export const isWalletConnectPairingUri = (uri: string): boolean =>
  uri.length <= 2048 && /^wc:[0-9a-f]{64}@2\?/i.test(uri) && /[?&]symKey=[0-9a-f]{64}/i.test(uri) && /[?&]relay-protocol=/i.test(uri);
