import { METHOD_WS_STATE } from "./protocol.js";

/**
 * Wire methods of the MultiversX provider (inpage/multiversx.ts ↔ background/multiversx.ts). The signing methods are
 * chains-multiversx's own DappRequest methods (MultiversX's WalletConnect method names), handed to the module
 * unchanged:
 *  - mvx_signTransactions { transactions: sdk-core plain objects, address? } → { signatures: [{ signature }], transactions }
 *  - mvx_signMessage { message: UTF-8 text, address } → { signature: hex, address }
 */
export const MULTIVERSX_INJECTED = {
  accounts: METHOD_WS_STATE,
  connect: "mvx:connect",
  disconnect: "mvx:disconnect",
  signTransactions: "mvx_signTransactions",
  signMessage: "mvx_signMessage",
} as const;

/** "mvx:" + the transaction chainID ("1", "D", "T"): the ChainAgnostic / WalletConnect id chains-multiversx uses. */
export function multiversxNetworkIdOf(chainID: unknown): string | null {
  return typeof chainID === "string" && /^[0-9A-Za-z]{1,8}$/.test(chainID) ? `mvx:${chainID}` : null;
}

const fromB64Url = (s: string): string | null => {
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
};

/**
 * The site a MultiversX native-auth login token is for, or null when `token` isn't one. Token format
 * (sdk-native-auth-client `initialize`): base64url(origin) "." blockHash "." ttl "." base64url(extraInfo JSON).
 * https://github.com/multiversx/mx-sdk-js-native-auth-client/blob/main/src/native.auth.client.ts
 */
export function nativeAuthOrigin(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || !/^[0-9a-f]{64}$/i.test(parts[1]!) || !/^\d{1,10}$/.test(parts[2]!)) return null;
  const origin = fromB64Url(parts[0]!);
  return origin && origin.length <= 512 ? origin : null;
}
