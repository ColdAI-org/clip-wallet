import type { DappRequest, Family, Network, NetworkId } from "@clip-wallet/core";
import { ProviderRpcError, rpcError } from "../shared/errors.js";
import type { ExposedAccount, OneMaskEvent } from "../shared/protocol.js";

/**
 * Background side of the Starknet (get-starknet / Starknet wallet API) and TON Connect (JS bridge) connectors.
 * The router owns permissions, approvals and per-site networks; it hands those in as `StarknetTonHelpers`
 * and forwards `family === "starknet" | "ton"` requests here (see docs/phase2/integration/starknet-ton.md).
 */

export const STARKNET_METHODS_ALLOWED = {
  /** Answered here, no prompt. */
  local: [
    "wallet_getPermissions",
    "wallet_requestChainId",
    "wallet_switchStarknetChain",
    "wallet_addStarknetChain",
    "wallet_watchAsset",
    "wallet_deploymentData",
    "wallet_supportedSpecs",
    "wallet_supportedWalletApi",
  ],
  connect: ["wallet_requestAccounts"],
  signing: ["wallet_addInvokeTransaction", "wallet_signTypedData", "wallet_addDeclareTransaction"],
} as const;

export const TON_METHODS_ALLOWED = {
  local: ["tonconnect:restoreConnection", "tonconnect:disconnect"],
  connect: ["tonconnect:connect"],
  signing: ["tonconnect:sendTransaction", "tonconnect:signData", "tonconnect:signMessage"],
} as const;

export function starknetTonAllowlist(family: Family): ReadonlySet<string> {
  if (family === "starknet") return new Set<string>([...STARKNET_METHODS_ALLOWED.local, ...STARKNET_METHODS_ALLOWED.connect, ...STARKNET_METHODS_ALLOWED.signing]);
  if (family === "ton") return new Set<string>([...TON_METHODS_ALLOWED.local, ...TON_METHODS_ALLOWED.connect, ...TON_METHODS_ALLOWED.signing]);
  return new Set<string>();
}

/** Wallet API spec versions this wallet answers (Starknet JSON-RPC 0.10, @starknet-io/types-js 0.10.x). */
export const STARKNET_SPECS = ["0.10"] as const;
export const STARKNET_WALLET_API = ["0.10"] as const;

/** What the router lends this module (its own closures). */
export interface StarknetTonHelpers {
  permitted(origin: string, family: Family): Promise<boolean>;
  accounts(origin: string, family: Family): Promise<ExposedAccount[]>;
  /** Connect approval + permission grant; resolves with the accounts the site now sees. */
  connect(origin: string, family: Family, net: Network, method: string, params: unknown): Promise<ExposedAccount[]>;
  /** Runs `handle` for a request the user must approve. */
  approve(req: DappRequest): Promise<unknown>;
  makeReq(origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest;
  selectedNetwork(origin: string, family: Family): Network | undefined;
  setSelected(origin: string, family: Family, id: NetworkId): void;
  candidates(family: Family): Network[];
  emit(origin: string, family: Family, event: OneMaskEvent, data?: unknown): void;
  revoke(origin: string, family: Family, o?: { silent?: boolean }): Promise<void>;
}

/** TON Connect `ton_addr` reply. */
export interface TonAddrItem {
  name: "ton_addr";
  address: string;
  network: string;
  publicKey: string;
  walletStateInit: string;
}

export interface StarknetTonOptions {
  /** wallet_deploymentData: chains-starknet `deploymentDataFor`, or null once the account is deployed. */
  starknetDeploymentData?(origin: string, net: Network): Promise<unknown | null>;
  /** TON Connect `ton_addr` for the account this origin sees: chains-ton `tonAddrItem(publicKey, net)`. */
  tonAddrItem?(origin: string, net: Network): Promise<TonAddrItem>;
}

/* ------------------------------------------------------------------ Starknet chain ids */

/** "starknet:SN_SEPOLIA" → "0x534e5f5345504f4c4941" (the short string as a felt). */
export function starknetFeltChainId(net: Network): string {
  const s = net.id.replace(/^starknet:/, "");
  let h = "";
  for (const ch of s) h += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return `0x${h}`;
}

/** Accepts the felt hex or the short string ("SN_SEPOLIA"). */
function starknetNetwork(candidates: Network[], chainId: unknown): Network | undefined {
  if (typeof chainId !== "string" || !chainId) return undefined;
  let name = chainId;
  if (/^0x[0-9a-fA-F]+$/.test(chainId)) {
    let hex = chainId.slice(2).replace(/^0+/, "");
    if (hex.length % 2) hex = `0${hex}`;
    name = "";
    for (let i = 0; i < hex.length; i += 2) name += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return candidates.find((n) => n.id === `starknet:${name}` || n.id === chainId);
}

function stripApiVersion(params: unknown): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const p = { ...(params as Record<string, unknown>) };
  const v = p.api_version;
  delete p.api_version;
  if (v !== undefined && !(STARKNET_WALLET_API as readonly string[]).some((s) => String(v).startsWith(s))) {
    throw new ProviderRpcError(162, "An error occurred (API_VERSION_NOT_SUPPORTED)", String(v));
  }
  return p;
}

/* ------------------------------------------------------------------ dispatch */

export function createStarknetTonDispatch(h: StarknetTonHelpers, o: StarknetTonOptions = {}) {
  const requirePermission = async (origin: string, family: Family) => {
    if (!(await h.permitted(origin, family))) throw rpcError.unauthorized();
  };
  const selected = (origin: string, family: Family) => {
    const net = h.selectedNetwork(origin, family);
    if (!net) throw rpcError.chainDisconnected(`Clip Wallet has no ${family === "ton" ? "TON" : "Starknet"} networks.`);
    return net;
  };

  async function starknet(origin: string, method: string, rawParams: unknown): Promise<unknown> {
    const params = stripApiVersion(rawParams);
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "wallet_supportedSpecs":
        return [...STARKNET_SPECS];
      case "wallet_supportedWalletApi":
        return [...STARKNET_WALLET_API];
      case "wallet_getPermissions":
        return (await h.permitted(origin, "starknet")) ? ["accounts"] : [];
      case "wallet_requestChainId":
        return starknetFeltChainId(selected(origin, "starknet"));
      case "wallet_requestAccounts": {
        if (await h.permitted(origin, "starknet")) return (await h.accounts(origin, "starknet")).map((a) => a.address);
        if (p.silent_mode === true) return [];
        return (await h.connect(origin, "starknet", selected(origin, "starknet"), method, params ?? {})).map((a) => a.address);
      }
      case "wallet_switchStarknetChain":
      case "wallet_addStarknetChain": {
        const net = starknetNetwork(h.candidates("starknet"), method === "wallet_addStarknetChain" ? p.chain_id : p.chainId);
        if (!net) {
          // Never add arbitrary RPCs: only networks that ship with the wallet.
          if (method === "wallet_addStarknetChain") throw rpcError.userRejected("Clip Wallet only connects to the networks it ships with.");
          throw rpcError.unrecognizedChain(String(p.chainId));
        }
        const before = h.selectedNetwork(origin, "starknet");
        h.setSelected(origin, "starknet", net.id);
        if (before?.id !== net.id) h.emit(origin, "starknet", "chainChanged", starknetFeltChainId(net));
        return true;
      }
      case "wallet_watchAsset":
        // Token lists are curated (AGENTS.md "Add a token list"); a site can't add one. Answer "not added".
        await requirePermission(origin, "starknet");
        return false;
      case "wallet_deploymentData": {
        await requirePermission(origin, "starknet");
        const d = o.starknetDeploymentData ? await o.starknetDeploymentData(origin, selected(origin, "starknet")) : null;
        if (!d) throw new ProviderRpcError(115, "An error occurred (ACCOUNT_ALREADY_DEPLOYED)");
        return d;
      }
    }
    if ((STARKNET_METHODS_ALLOWED.signing as readonly string[]).includes(method)) {
      await requirePermission(origin, "starknet");
      return h.approve(h.makeReq(origin, "starknet", selected(origin, "starknet"), method, params));
    }
    throw rpcError.unsupportedMethod(method);
  }

  async function addrItem(origin: string, net: Network): Promise<TonAddrItem> {
    if (!o.tonAddrItem) throw rpcError.internal("TON accounts aren't set up in this build.");
    return o.tonAddrItem(origin, net);
  }

  async function ton(origin: string, method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "tonconnect:connect": {
        const req = (params ?? {}) as { manifestUrl?: unknown; items?: unknown };
        const items = Array.isArray(req.items) ? (req.items as { name?: unknown; network?: unknown; payload?: unknown }[]) : [];
        const addr = items.find((i) => i?.name === "ton_addr");
        if (!addr) throw rpcError.invalidParams("TON Connect needs the ton_addr item.");
        let net = selected(origin, "ton");
        if (addr.network !== undefined) {
          const want = h.candidates("ton").find((n) => n.id === `ton:${String(addr.network)}`);
          if (!want) throw rpcError.chainDisconnected(`Clip Wallet doesn't connect to TON network ${String(addr.network)}.`);
          net = want;
        }
        const fresh = !(await h.permitted(origin, "ton"));
        if (fresh) await h.connect(origin, "ton", net, method, { manifestUrl: req.manifestUrl, items });
        h.setSelected(origin, "ton", net.id);
        const out: unknown[] = [];
        for (const it of items) {
          if (it?.name === "ton_addr") out.push(await addrItem(origin, net));
          else if (it?.name === "ton_proof") {
            if (typeof it.payload !== "string") {
              out.push({ name: "ton_proof", error: { code: 0, message: "Missing payload." } });
              continue;
            }
            try {
              out.push(await h.approve(h.makeReq(origin, "ton", net, "ton_proof", { payload: it.payload })));
            } catch (e) {
              if (fresh) await h.revoke(origin, "ton", { silent: true });
              throw e;
            }
          } else out.push({ name: String(it?.name ?? ""), error: { code: 400, message: "Method not supported." } });
        }
        return out;
      }
      case "tonconnect:restoreConnection":
        await requirePermission(origin, "ton");
        return [await addrItem(origin, selected(origin, "ton"))];
      case "tonconnect:disconnect":
        // rpc.md: no disconnect event when the dApp itself disconnects.
        await h.revoke(origin, "ton", { silent: true });
        return {};
    }
    if ((TON_METHODS_ALLOWED.signing as readonly string[]).includes(method)) {
      await requirePermission(origin, "ton");
      return h.approve(h.makeReq(origin, "ton", selected(origin, "ton"), method.slice("tonconnect:".length), params));
    }
    throw rpcError.unsupportedMethod(method);
  }

  return { starknet, ton };
}

