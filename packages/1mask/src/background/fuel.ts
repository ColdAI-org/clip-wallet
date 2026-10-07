import type { DappRequest, Family, Network, NetworkId } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import { FUEL_INJECTED, fuelChainId, fuelConnectorNetwork } from "../shared/fuel.js";
import type { ExposedAccount, OneMaskEvent } from "../shared/protocol.js";

/**
 * Background side of the Fuel connector (inpage/fuel.ts). The router keeps the policy (permissions, approvals, rate
 * limits, per-site networks) and lends its closures as `FuelRouterInternals` (the same shape as StarknetTonHelpers);
 * this file knows the connector's method list, how its params name the account, and Fuel networks
 * ({ url, chainId }, fuels-ts connectors/types `Network`). Wire it into router.ts for `family === "fuel"`, and
 * `fuelInjectedAllowlist()` into methods.ts.
 */

export const FUEL_METHODS_ALLOWED = {
  /** Answered here, no prompt. */
  local: [FUEL_INJECTED.accounts, FUEL_INJECTED.disconnect, FUEL_INJECTED.currentNetwork, FUEL_INJECTED.networks, FUEL_INJECTED.selectNetwork],
  connect: [FUEL_INJECTED.connect],
  signing: [FUEL_INJECTED.sendTransaction, FUEL_INJECTED.signTransaction, FUEL_INJECTED.signMessage],
} as const;

export function fuelInjectedAllowlist(): ReadonlySet<string> {
  return new Set<string>([...FUEL_METHODS_ALLOWED.local, ...FUEL_METHODS_ALLOWED.connect, ...FUEL_METHODS_ALLOWED.signing]);
}

export interface FuelRouterInternals {
  permitted(origin: string, family: Family): Promise<boolean>;
  accounts(origin: string, family: Family): Promise<ExposedAccount[]>;
  /** Connect approval + permission grant; resolves with the accounts the site now sees. */
  connect(origin: string, family: Family, net: Network, method: string, params: unknown): Promise<ExposedAccount[]>;
  approve(req: DappRequest): Promise<unknown>;
  makeReq(origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest;
  selectedNetwork(origin: string, family: Family): Network | undefined;
  setSelected(origin: string, family: Family, id: NetworkId): void;
  candidates(family: Family): Network[];
  emit(origin: string, family: Family, event: OneMaskEvent, data?: unknown): void;
  revoke(origin: string, family: Family, o?: { silent?: boolean }): Promise<void>;
}

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

const sameUrl = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
};

/** Fuel addresses are 0x-hex in any case (checksummed or not): compare lower-case. */
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createFuelDispatcher(h: FuelRouterInternals) {
  const FAMILY: Family = "fuel";

  const selected = (origin: string): Network => {
    const net = h.selectedNetwork(origin, FAMILY);
    if (!net) throw rpcError.chainDisconnected("No Fuel network is available.");
    return net;
  };

  async function dispatch(origin: string, method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case FUEL_INJECTED.accounts:
        return (await h.permitted(origin, FAMILY)) ? h.accounts(origin, FAMILY) : [];
      case FUEL_INJECTED.connect:
        if (await h.permitted(origin, FAMILY)) return h.accounts(origin, FAMILY);
        return h.connect(origin, FAMILY, selected(origin), method, {});
      case FUEL_INJECTED.disconnect:
        await h.revoke(origin, FAMILY);
        return null;
      case FUEL_INJECTED.currentNetwork:
        // FuelConnector.currentNetwork: answered "even if the connection is not established".
        return fuelConnectorNetwork(selected(origin));
      case FUEL_INJECTED.networks:
        return h.candidates(FAMILY).map(fuelConnectorNetwork);
      case FUEL_INJECTED.selectNetwork: {
        const p = obj(params);
        const net = h.candidates(FAMILY).find(
          (n) => (typeof p.chainId === "number" && fuelChainId(n.id) === p.chainId) || (typeof p.url === "string" && n.rpcUrls.some((u) => sameUrl(u, p.url as string))),
        );
        // Never add networks: only the ones that ship with the wallet.
        if (!net) throw rpcError.unrecognizedChain(String(p.chainId ?? p.url ?? ""));
        const before = h.selectedNetwork(origin, FAMILY);
        h.setSelected(origin, FAMILY, net.id);
        if (before?.id !== net.id) h.emit(origin, FAMILY, "chainChanged", fuelConnectorNetwork(net));
        return true;
      }
    }

    if ((FUEL_METHODS_ALLOWED.signing as readonly string[]).includes(method)) {
      if (!(await h.permitted(origin, FAMILY))) throw rpcError.unauthorized();
      const p = obj(params);
      if (typeof p.address !== "string") throw rpcError.invalidParams("Expected { address, … }.");
      const list = await h.accounts(origin, FAMILY);
      if (!list.some((a) => sameAddress(a.address, p.address as string))) throw rpcError.unauthorized("That account is not connected to this site.");
      if (method === FUEL_INJECTED.signMessage ? p.message === undefined : p.transaction === undefined) {
        throw rpcError.invalidParams(method === FUEL_INJECTED.signMessage ? "Expected { address, message }." : "Expected { address, transaction }.");
      }
      return h.approve(h.makeReq(origin, FAMILY, selected(origin), method, params));
    }

    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}
