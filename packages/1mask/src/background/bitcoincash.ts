import type { Family, Network } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import { BCH_SIGNING_METHODS, BCH_WC, bchAddressOn, bchNetworkForWcChain } from "../shared/bitcoincash.js";
import type { P2RouterInternals } from "./p2-families.js";

/**
 * Background side of Bitcoin Cash over WalletConnect (wc2-bch-bcr). There is no injected BCH standard to implement
 * (no discovery mechanism wallets share; Paytaca's extension injects its own `window.paytaca`, which another wallet
 * mustn't imitate), so Clip appears to BCH dapps through WalletConnect under its own metadata.
 *
 * The WalletConnect session layer (walletconnect/namespaces.ts, wallet.ts) maps the "bch" namespace and its
 * "bch:bitcoincash" / "bch:bchtest" chains onto the registry's bip122 ids with `bchNetworkForWcChain` and answers
 * bch_getAddresses from the session itself. This dispatcher (for a future injected path) answers bch_getAddresses with the account's CashAddr spelled for the session's network and
 * hands signing methods to chains-bitcoincash unchanged.
 */
export const BCH_METHODS_ALLOWED = { local: [BCH_WC.getAddresses], signing: BCH_SIGNING_METHODS } as const;

const FAMILY: Family = "bitcoincash";

export function createBitcoinCashDispatcher(r: Pick<P2RouterInternals, "permitted" | "requirePermission" | "accounts" | "approve" | "makeReq" | "requireNetwork">) {
  async function addresses(origin: string, net: Network): Promise<string[]> {
    const out: string[] = [];
    for (const a of await r.accounts(origin, FAMILY)) {
      const s = bchAddressOn(a.address, net.id);
      if (s) out.push(s);
    }
    return out;
  }

  /** `chain` may be a wc2-bch-bcr chain ("bch:bchtest") or a CAIP-2 id from the registry. */
  async function dispatch(origin: string, family: Family, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    if (family !== FAMILY) throw rpcError.unsupportedMethod(method);
    const net = r.requireNetwork(FAMILY, origin, bchNetworkForWcChain(chain) ?? chain);
    if (method === BCH_WC.getAddresses) {
      await r.requirePermission(origin, FAMILY);
      return addresses(origin, net);
    }
    if (BCH_SIGNING_METHODS.includes(method)) {
      await r.requirePermission(origin, FAMILY);
      return r.approve(r.makeReq(origin, FAMILY, net, method, params ?? {}));
    }
    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}
