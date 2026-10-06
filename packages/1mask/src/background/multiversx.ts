import { rpcError } from "../shared/errors.js";
import { MULTIVERSX_INJECTED, nativeAuthOrigin } from "../shared/multiversx-methods.js";
import type { P2RouterInternals } from "./p2-families.js";

/**
 * Background side of the MultiversX provider (inpage/multiversx.ts). Same shape as createTronDispatcher: the router
 * keeps the policy (permissions, approvals, rate limits, timeouts) and lends its closures; this file only knows the
 * method list and which account a request names. Signing goes to chains-multiversx unchanged (mvx_signTransactions /
 * mvx_signMessage), which checks the sender and chain again and decodes in plain words.
 *
 * Wiring (router.ts / methods.ts, by the coordinator):
 *   const multiversx = createMultiversXDispatcher({ permitted, requirePermission, accounts, connect, approve, makeReq, requireNetwork, revoke });
 *   if (family === "multiversx") return multiversx.dispatch(origin, method, params, chain);
 *   injectedAllowlist("multiversx") = multiversxInjectedAllowlist()
 */

export const MULTIVERSX_METHODS_ALLOWED = {
  local: [MULTIVERSX_INJECTED.accounts, MULTIVERSX_INJECTED.disconnect],
  connect: [MULTIVERSX_INJECTED.connect],
  signing: [MULTIVERSX_INJECTED.signTransactions, MULTIVERSX_INJECTED.signMessage],
} as const;

export const MULTIVERSX_CONNECT_METHODS = [MULTIVERSX_INJECTED.connect] as const;

/** For methods.ts `injectedAllowlist`. */
export function multiversxInjectedAllowlist(): ReadonlySet<string> {
  const a = MULTIVERSX_METHODS_ALLOWED;
  return new Set<string>([...a.local, ...a.connect, ...a.signing]);
}

const MAX_TXS = 20;
const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function createMultiversXDispatcher(r: P2RouterInternals) {
  async function dispatch(origin: string, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    // Silent account read (no prompt).
    if (method === MULTIVERSX_INJECTED.accounts) return (await r.permitted(origin, "multiversx")) ? r.accounts(origin, "multiversx") : [];

    if (method === MULTIVERSX_INJECTED.disconnect) {
      await r.revoke(origin, "multiversx");
      return null;
    }

    if (method === MULTIVERSX_INJECTED.connect) {
      if (await r.permitted(origin, "multiversx")) return r.accounts(origin, "multiversx");
      return r.connect(origin, "multiversx", r.requireNetwork("multiversx", origin, chain), method, {});
    }

    if ((MULTIVERSX_METHODS_ALLOWED.signing as readonly string[]).includes(method)) {
      await r.requirePermission(origin, "multiversx");
      const p = obj(params);
      const mine = new Set((await r.accounts(origin, "multiversx")).map((a) => a.address));
      const own = (address: unknown) => {
        if (typeof address !== "string" || !mine.has(address)) throw rpcError.unauthorized("That account is not connected to this site.");
      };
      if (p.address !== undefined) own(p.address);
      if (method === MULTIVERSX_INJECTED.signTransactions) {
        const txs = p.transactions;
        if (!Array.isArray(txs) || txs.length === 0 || txs.length > MAX_TXS) throw rpcError.invalidParams(`Expected { transactions: 1 to ${MAX_TXS} plain transactions }.`);
        for (const t of txs) own(obj(t).sender);
      } else {
        if (typeof p.message !== "string" || typeof p.address !== "string") throw rpcError.invalidParams("Expected { message, address }.");
        // A native-auth login token names the site it signs in to. Another site's token is refused outright: signing
        // it would hand this site a login to that one.
        const token = p.message.startsWith(p.address) ? p.message.slice(p.address.length) : "";
        const site = token ? nativeAuthOrigin(token) : null;
        if (site !== null && originOf(site) !== originOf(origin)) throw rpcError.unauthorized("This sign-in is for a different site.");
      }
      const net = r.requireNetwork("multiversx", origin, chain);
      return r.approve(r.makeReq(origin, "multiversx", net, method, params));
    }

    throw rpcError.unsupportedMethod(method);
  }

  return { dispatch };
}
