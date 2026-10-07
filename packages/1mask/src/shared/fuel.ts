import type { Network, NetworkId } from "@clip-wallet/core";
import { METHOD_WS_STATE } from "./protocol.js";

/**
 * Wire methods of the Fuel connector (inpage/fuel.ts ↔ background/fuel.ts). The signing names are chains-fuel's own
 * DappRequest methods (FUEL_METHODS), so the background hands them to the module unchanged.
 */
export const FUEL_INJECTED = {
  /** Silent account read (no prompt). */
  accounts: METHOD_WS_STATE,
  connect: "fuel:connect",
  disconnect: "fuel:disconnect",
  currentNetwork: "fuel:currentNetwork",
  networks: "fuel:networks",
  selectNetwork: "fuel:selectNetwork",
  sendTransaction: "fuel_sendTransaction",
  signTransaction: "fuel_signTransaction",
  signMessage: "fuel_signMessage",
} as const;

export const FUEL_CONNECT_METHODS = [FUEL_INJECTED.connect] as const;

/** The Fuel connector's network shape (fuels-ts connectors/types `Network`). */
export interface FuelConnectorNetwork {
  url: string;
  chainId: number;
}

/** "fuel:<chain id>" (chains-fuel networks) → the connector's numeric chain id. */
export function fuelChainId(networkId: NetworkId): number | undefined {
  const m = /^fuel:(\d+)$/.exec(networkId);
  return m ? Number(m[1]) : undefined;
}

export function fuelConnectorNetwork(net: Network): FuelConnectorNetwork {
  return { url: net.rpcUrls[0] ?? "", chainId: fuelChainId(net.id) ?? -1 };
}

/** Message forms on the wire (chains-fuel `FuelMessage`): a plain string, personalSign text, or personalSign bytes. */
export type FuelWireMessage = { text: string } | { personalSign: string } | { personalSignHex: string };
