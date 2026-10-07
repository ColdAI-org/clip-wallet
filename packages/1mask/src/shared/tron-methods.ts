import type { NetworkId } from "@clip-wallet/core";
import { METHOD_WS_STATE } from "./protocol.js";

/**
 * Wire methods of the injected TRON provider (inpage/tron.ts ↔ background/tron.ts). The signing methods are
 * chains-tron's own DappRequest methods (the WalletConnect / Reown TRON method names), so the background hands them
 * to the module unchanged:
 *  - tron_signTransaction { address, transaction } → the TronWeb transaction with `signature: [hex]`
 *  - tron_signMessage { address, message, encoding?: "hex" } → { signature: "0x…" } (TronWeb signMessageV2 format)
 */
export const TRON_INJECTED = {
  accounts: METHOD_WS_STATE,
  connect: "tron:connect",
  disconnect: "tron:disconnect",
  signTransaction: "tron_signTransaction",
  signMessage: "tron_signMessage",
} as const;

/** TRON chain ids as `eth_chainId` / TIP-1193 report them ("0x" + last 4 bytes of the genesis block id). */
export const TRON_CHAIN_IDS = {
  mainnet: "0x2b6653dc",
  shasta: "0x94a9059e",
  nile: "0xcd8690dc",
} as const;

/** CAIP-2 id (WalletConnect / Reown form, "tron:0x…") for a TIP-1193 chain id. */
export function tronNetworkIdOf(chainId: string): NetworkId | null {
  const c = chainId.trim().toLowerCase();
  if (/^0x[0-9a-f]{1,8}$/.test(c)) return `tron:0x${c.slice(2).padStart(8, "0")}`;
  if (/^\d{1,10}$/.test(c)) return `tron:0x${Number(c).toString(16).padStart(8, "0")}`;
  return null;
}

/** TIP-1193 chain id ("0x…") of a CAIP-2 TRON network id. */
export function tronChainIdOf(networkId: NetworkId): string | null {
  const m = /^tron:(0x[0-9a-f]{8})$/i.exec(networkId);
  return m ? m[1]!.toLowerCase() : null;
}
