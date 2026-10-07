import type { Family, Network } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { STACKS_CHAINS, STACKS_INJECTED, STACKS_SIGNING_METHODS, stacksAddressOn, stacksNetworkName } from "../shared/stacks.js";
import type { P2RouterInternals } from "./p2-families.js";

/**
 * Background side of the injected Stacks provider (inpage/stacks.ts, SIP-030 `request`). The router keeps the
 * policy (permissions, approvals, rate limits, timeouts); this file knows Stacks' method list and that an
 * account's address is spelled per network (Account.address is the mainnet "SP…" form; the testnet is "ST…").
 * Wired into router.ts by the integration step, like createP2Dispatcher.
 */

export const STACKS_METHODS_ALLOWED = {
  local: [STACKS_INJECTED.accounts, STACKS_INJECTED.disconnect, STACKS_INJECTED.getNetworks],
  connect: [STACKS_INJECTED.connect],
  signing: STACKS_SIGNING_METHODS,
} as const;

/** For methods.ts `injectedAllowlist`. */
export function stacksInjectedAllowlist(): ReadonlySet<string> {
  return new Set<string>([...STACKS_METHODS_ALLOWED.local, ...STACKS_METHODS_ALLOWED.connect, ...STACKS_METHODS_ALLOWED.signing]);
}

export interface StacksRouterInternals extends Pick<P2RouterInternals, "permitted" | "requirePermission" | "accounts" | "connect" | "approve" | "makeReq" | "requireNetwork" | "revoke"> {
  /** The wallet's Stacks networks (for stx_getNetworks). Default: only the one the site is on. */
  networks?(): Network[];
}

const FAMILY: Family = "stacks";
const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

export function createStacksDispatcher(r: StacksRouterInternals) {
  /** The site's accounts, spelled for `net`. */
  async function spelled(origin: string, net: Network, list?: ExposedAccount[]): Promise<ExposedAccount[]> {
    const accounts = list ?? (await r.accounts(origin, FAMILY));
    const out: ExposedAccount[] = [];
    for (const a of accounts) {
      const address = await stacksAddressOn(a.address, net.id);
      if (address) out.push({ ...a, address });
    }
    return out;
  }

  async function dispatch(origin: string, family: Family, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    if (family !== FAMILY) throw rpcError.unsupportedMethod(method);

    if (method === STACKS_INJECTED.accounts) {
      if (!(await r.permitted(origin, FAMILY))) return [];
      return spelled(origin, r.requireNetwork(FAMILY, origin, chain));
    }

    if (method === STACKS_INJECTED.disconnect) {
      await r.revoke(origin, FAMILY);
      return null;
    }

    if (method === STACKS_INJECTED.connect) {
      const net = r.requireNetwork(FAMILY, origin, chain);
      const list = (await r.permitted(origin, FAMILY)) ? await r.accounts(origin, FAMILY) : await r.connect(origin, FAMILY, net, method, params ?? {});
      return spelled(origin, net, list);
    }

    if (method === STACKS_INJECTED.getNetworks) {
      await r.requirePermission(origin, FAMILY);
      const active = r.requireNetwork(FAMILY, origin, chain);
      const nets = (r.networks?.() ?? [active]).filter((n) => n.family === FAMILY && stacksNetworkName(n.id));
      const shape = (n: Network) => {
        const name = stacksNetworkName(n.id)!;
        return { id: name, chainId: STACKS_CHAINS[name].chainId, transactionVersion: STACKS_CHAINS[name].transactionVersion };
      };
      return { active: stacksNetworkName(active.id), networks: nets.map(shape) };
    }

    if (STACKS_SIGNING_METHODS.includes(method)) {
      await r.requirePermission(origin, FAMILY);
      const net = r.requireNetwork(FAMILY, origin, chain);
      const address = obj(params).address;
      if (address !== undefined && address !== null) {
        const mine = await spelled(origin, net);
        if (typeof address !== "string" || !mine.some((a) => a.address === address.trim().toUpperCase())) {
          throw rpcError.unauthorized("That account is not connected to this site.");
        }
      }
      return r.approve(r.makeReq(origin, FAMILY, net, method, params ?? {}));
    }

    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}
