import { rpcError } from "../shared/errors.js";
import { XRPL_INJECTED, XRPL_METHODS_ALLOWED, xrplAllowlist, xrplChainId } from "../shared/xrpl.js";
import type { P2RouterInternals } from "./p2-families.js";

/**
 * Background side of the XLS-72d XRPL wallet (inpage/xrpl.ts). The router keeps the policy (permissions,
 * approvals, rate limits, timeouts); this file only knows the method list and where XLS-72d params name the account
 * and the network. To wire it (coordinator): `injectedAllowlist("xrpl")` → `xrplAllowlist()`, and in `dispatchRaw`
 * `if (family === "xrpl") return xrpl.dispatch(origin, method, params, chain)` with
 * `const xrpl = createXrplDispatcher({ permitted, requirePermission, accounts, connect, approve, makeReq, requireNetwork, revoke })`.
 *
 * DappRequest params for both signing methods: `{ tx_json, account: "r…", network: "xrpl:<id>", options? }` with
 * `networkId` = that network (chains-xrpl normalize() checks every field again before anything is signed).
 */
export { xrplAllowlist, XRPL_METHODS_ALLOWED };

export type XrplRouterInternals = Pick<P2RouterInternals, "permitted" | "requirePermission" | "accounts" | "connect" | "approve" | "makeReq" | "requireNetwork" | "revoke">;

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

export function createXrplDispatcher(r: XrplRouterInternals) {
  async function dispatch(origin: string, method: string, params: unknown, chain: string | undefined): Promise<unknown> {
    if (!xrplAllowlist().has(method)) throw rpcError.unsupportedMethod(method);

    if (method === XRPL_INJECTED.state) return (await r.permitted(origin, "xrpl")) ? r.accounts(origin, "xrpl") : [];

    if (method === XRPL_INJECTED.disconnect) {
      await r.revoke(origin, "xrpl");
      return null;
    }

    if (method === XRPL_INJECTED.connect) {
      if (await r.permitted(origin, "xrpl")) return r.accounts(origin, "xrpl");
      return r.connect(origin, "xrpl", r.requireNetwork("xrpl", origin, chain === undefined ? undefined : xrplChainId(chain) ?? chain), method, params ?? {});
    }

    // xrpl:signTransaction / xrpl:signAndSubmitTransaction
    await r.requirePermission(origin, "xrpl");
    const p = obj(params);
    const tx = obj(p.tx_json);
    if (!Object.keys(tx).length) throw rpcError.invalidParams("Expected { tx_json, account, network }.");
    const list = await r.accounts(origin, "xrpl");
    for (const a of [p.account, tx.Account]) {
      if (a === undefined) continue;
      if (typeof a !== "string" || !list.some((x) => x.address === a)) throw rpcError.unauthorized("That account is not connected to this site.");
    }
    if (p.account === undefined && tx.Account === undefined) throw rpcError.invalidParams("Expected { tx_json, account, network }.");
    const fromParams = p.network === undefined ? undefined : xrplChainId(p.network);
    if (p.network !== undefined && !fromParams) throw rpcError.invalidParams("network must be an XRPL chain such as xrpl:1.");
    const hint = chain === undefined ? undefined : (xrplChainId(chain) ?? chain);
    if (fromParams && hint && fromParams !== hint) throw rpcError.invalidParams("The request names two different networks.");
    const net = r.requireNetwork("xrpl", origin, fromParams ?? hint);
    const wire: Record<string, unknown> = { tx_json: tx, account: p.account ?? tx.Account, network: net.id };
    if (p.options !== undefined) wire.options = obj(p.options);
    return r.approve(r.makeReq(origin, "xrpl", net, method, wire));
  }

  return { dispatch };
}
