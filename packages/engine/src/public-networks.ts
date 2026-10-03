import type { Network } from "@clip-wallet/core";

/** Networks as the inpage providers may see them: public facts only, one RPC (never a user override). */
export function publicNetworks(networks: Network[]): Network[] {
  return networks.map((n) => ({ ...n, rpcUrls: n.rpcUrls.slice(0, 1) }));
}
