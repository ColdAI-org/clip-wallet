/**
 * XRP Ledger wire names for 1Mask, plain strings so the background never imports the in-page wallet.
 *
 * The standard is XLS-72d "Browser Wallet Standard" (https://github.com/XRPLF/XRPL-Standards/discussions/206, by
 * tequ; the discussion was closed for inactivity in March 2026 without being replaced), built on Wallet Standard
 * (https://github.com/wallet-standard/wallet-standard). Its reference types are @xrpl-wallet-standard/core 0.1.4
 * (https://github.com/tequdev/xrpl-wallet-standard, packages/core/src/features/*.ts, networks.ts, utils.ts):
 *  - features `xrpl:signTransaction` 1.0.0 ({ tx_json, account, network, options? } → { signed_tx_blob }) and
 *    `xrpl:signAndSubmitTransaction` 1.0.0 (→ { tx_hash, tx_json }), plus standard:connect / standard:events
 *    (REQUIRED_FEATURES) and standard:disconnect;
 *  - chains `xrpl:<network_id>` (`xrpl:0` mainnet, `xrpl:1` testnet, `xrpl:2` devnet), with the aliases
 *    `xrpl:mainnet` / `xrpl:testnet` / `xrpl:devnet` accepted as input.
 * There is no message-signing feature in XLS-72d, so 1Mask has none for the XRPL.
 */
import { METHOD_WS_STATE } from "./protocol.js";

export const XRPL_SIGN_TRANSACTION = "xrpl:signTransaction" as const;
export const XRPL_SIGN_AND_SUBMIT_TRANSACTION = "xrpl:signAndSubmitTransaction" as const;

export const XRPL_INJECTED = {
  /** Silent account read (no prompt). */
  state: METHOD_WS_STATE,
  connect: "standard:connect",
  disconnect: "standard:disconnect",
  signTransaction: XRPL_SIGN_TRANSACTION,
  signAndSubmitTransaction: XRPL_SIGN_AND_SUBMIT_TRANSACTION,
} as const;

export const XRPL_METHODS_ALLOWED = {
  local: [XRPL_INJECTED.state, XRPL_INJECTED.disconnect],
  connect: [XRPL_INJECTED.connect],
  signing: [XRPL_INJECTED.signTransaction, XRPL_INJECTED.signAndSubmitTransaction],
} as const;

/** For methods.ts `injectedAllowlist("xrpl")`. */
export function xrplAllowlist(): ReadonlySet<string> {
  return new Set<string>([...XRPL_METHODS_ALLOWED.local, ...XRPL_METHODS_ALLOWED.connect, ...XRPL_METHODS_ALLOWED.signing]);
}

const ALIASES: Record<string, string> = { "xrpl:mainnet": "xrpl:0", "xrpl:testnet": "xrpl:1", "xrpl:devnet": "xrpl:2" };

/**
 * An XLS-72d network identifier as the CAIP-2 id the registry uses ("xrpl:testnet" → "xrpl:1"), or undefined when it
 * isn't an XRPL identifier at all. Xahau's `xrpl:21337` / `xrpl:21338` pass through and are refused later as networks
 * this wallet doesn't have.
 */
export function xrplChainId(network: unknown): string | undefined {
  if (typeof network !== "string") return undefined;
  if (ALIASES[network]) return ALIASES[network];
  return /^xrpl:\d{1,10}$/.test(network) ? network : undefined;
}
