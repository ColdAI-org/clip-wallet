/**
 * ERC-7682 `auxiliaryFunds` (https://eips.ethereum.org/EIPS/eip-7682): where the wallet can bring money in for a
 * payment from the user's other balances, so apps don't block on the on-chain balance check.
 *
 * Today the money comes through settle on Hedera (./settle-funding.ts): a bonded Connector is paid in the same asset
 * on a network the order book takes deposits on, and delivers on the payment's network. So a network gets the
 * capability when settle on Hedera is on and it has an asset whose key also exists, unbridged, on another deposit
 * network. This is static (catalog + deployment), never the user's balances: advertising balances would tell any
 * connected site what the user holds. Whether a particular payment can be funded is decided when it arrives.
 */
import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";
import { SETTLE_DEPLOYMENTS } from "./phase3.js";

/** EIP-7528 native asset, as ERC-7682 lists it. */
export const NATIVE_ASSET_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export interface AuxiliaryFundsInfo {
  supported: true;
  assets: `0x${string}`[];
}

/** Networks the settle-on-Hedera order book takes deposits on (testnet unless `mainnet`). */
export function settleSourceNetworks(mainnet = false): NetworkId[] {
  const dep = SETTLE_DEPLOYMENTS.find((d) => d.network === (mainnet ? "mainnet" : "testnet"));
  return dep ? Object.keys(dep.deposits) : [];
}

export function auxiliaryFundsFor(p: {
  networkIds: NetworkId[];
  networks: Network[];
  assets: AssetRef[];
  /** Networks money can be taken from (settleSourceNetworks, or the mock Connector's in fixture builds). */
  sources: NetworkId[];
}): Record<NetworkId, AuxiliaryFundsInfo | undefined> {
  const known = new Set(p.networks.map((n) => n.id));
  const usable = (a: AssetRef) => !a.bridged && !a.spam;
  const out: Record<NetworkId, AuxiliaryFundsInfo | undefined> = {};
  for (const id of p.networkIds) {
    out[id] = undefined;
    if (!id.startsWith("eip155:") || !known.has(id)) continue;
    const from = p.sources.filter((s) => s !== id && known.has(s));
    const keys = new Set(p.assets.filter((a) => from.includes(a.networkId) && usable(a)).map((a) => a.key));
    const here = p.assets.filter((a) => a.networkId === id && usable(a) && keys.has(a.key));
    if (here.length === 0) continue;
    const assets = [...new Set(here.map((a) => (a.address ?? NATIVE_ASSET_ADDRESS) as `0x${string}`))];
    out[id] = { supported: true, assets };
  }
  return out;
}
