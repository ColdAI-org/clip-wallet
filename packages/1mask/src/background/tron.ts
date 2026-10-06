import { rpcError } from "../shared/errors.js";
import { TRON_INJECTED } from "../shared/tron-methods.js";
import type { P2RouterInternals } from "./p2-families.js";

/**
 * Background side of the injected TRON provider (inpage/tron.ts). Same shape as createP2Dispatcher: the router keeps
 * the policy (permissions, approvals, rate limits, timeouts) and lends its closures; this file only knows TRON's
 * method list and where its params name the signer. eth_chainId / wallet_switchEthereumChain are answered in the page
 * (the page passes its chain with every call and requireNetwork checks it against the registry).
 */

export const TRON_METHODS_ALLOWED = {
  local: [TRON_INJECTED.accounts, TRON_INJECTED.disconnect],
  connect: [TRON_INJECTED.connect],
  signing: [TRON_INJECTED.signTransaction, TRON_INJECTED.signMessage],
} as const;

export const TRON_CONNECT_METHODS = [TRON_INJECTED.connect] as const;

/** For methods.ts `injectedAllowlist`. */
export function tronInjectedAllowlist(): ReadonlySet<string> {
  const a = TRON_METHODS_ALLOWED;
  return new Set<string>([...a.local, ...a.connect, ...a.signing]);
}

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

export function createTronDispatcher(r: P2RouterInternals) {
  async function dispatch(origin: string, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    // Silent account read (no prompt).
    if (method === TRON_INJECTED.accounts) return (await r.permitted(origin, "tron")) ? r.accounts(origin, "tron") : [];

    if (method === TRON_INJECTED.disconnect) {
      await r.revoke(origin, "tron");
      return null;
    }

    if (method === TRON_INJECTED.connect) {
      if (await r.permitted(origin, "tron")) return r.accounts(origin, "tron");
      return r.connect(origin, "tron", r.requireNetwork("tron", origin, chain), method, params ?? {});
    }

    if ((TRON_METHODS_ALLOWED.signing as readonly string[]).includes(method)) {
      await r.requirePermission(origin, "tron");
      const p = obj(params);
      // The signer is named by `address` (Reown TRON params); chains-tron also checks it against the account.
      const address = p.address;
      const list = await r.accounts(origin, "tron");
      if (address !== undefined && (typeof address !== "string" || !list.some((a) => a.address === address))) {
        throw rpcError.unauthorized("That account is not connected to this site.");
      }
      if (method === TRON_INJECTED.signTransaction && (!p.transaction || typeof p.transaction !== "object")) throw rpcError.invalidParams("Expected { address, transaction }.");
      if (method === TRON_INJECTED.signMessage && typeof p.message !== "string") throw rpcError.invalidParams("Expected { address, message }.");
      const net = r.requireNetwork("tron", origin, chain);
      return r.approve(r.makeReq(origin, "tron", net, method, params));
    }

    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}
