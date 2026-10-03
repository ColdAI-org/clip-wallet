import { FAMILIES as ALL_FAMILIES } from "../shared/protocol.js";
import type { DappRequest, Family, Network, NetworkId } from "@clip-wallet/core";
import { randomId } from "../shared/bytes.js";
import { ProviderRpcError, RpcErrorCode, fromRpcErrorShape, rpcError, toRpcErrorShape } from "../shared/errors.js";
import {
  evmChainId,
  findEvmNetwork,
  networkForChain,
  parseChainId,
  toHexChainId,
} from "../shared/networks.js";
import {
  METHOD_PROVIDER_STATE,
  METHOD_WS_STATE,
  portRequestSchema,
  type EvmProviderState,
  type ExposedAccount,
  type OneMaskEvent,
  type PortEvent,
  type PortResponse,
} from "../shared/protocol.js";
import { BITCOIN_METHODS_ALLOWED, EVM_METHODS, SOLANA_METHODS, injectedAllowlist } from "./methods.js";
import { METHOD_APTOS_NETWORK } from "../inpage/aptos.js";
import type { PermissionStore } from "./permissions.js";

/** Background side of a runtime port (chrome.runtime.Port satisfies it). */
export interface RouterPort {
  postMessage(message: unknown): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect?(): void;
}

/** Anything with an address and optional public key; core `Account` qualifies. Only these fields are exposed. */
export interface AccountLike {
  address: string;
  publicKey?: string;
  /** Bitcoin: "payment" | "ordinals". */
  purpose?: string;
  /** Bitcoin: "p2wpkh" | "p2tr" ... */
  addressType?: string;
}

export interface OneMaskRouterOptions {
  /** The wallet's network registry. Chains outside it do not exist for dapps. */
  networks: Network[];
  /**
   * Decode, ask the user, sign, reply. Resolve with the dapp's result; reject to refuse (an error with
   * numeric `code` is forwarded, a ClipError with a reject/cancel code becomes 4001, anything else -32603).
   * For connect methods (eth_requestAccounts, wallet_requestPermissions, standard:connect,
   * bitcoin:connect) resolving means "approved"; the router then grants the permission and answers
   * with `accountsFor`.
   */
  handle(req: DappRequest): Promise<unknown>;
  permissions: PermissionStore;
  /** Accounts of `family` this origin may see once connected (the user's choice for that site). */
  accountsFor(origin: string, family: Family): AccountLike[] | Promise<AccountLike[]>;
  /**
   * Which family serves a network's requests. Default: every eip155 network is "evm" (so Hedera's
   * eip155:295/296 JSON-RPC goes to chains-evm over the Hashio relay), everything else uses the
   * registry's own family. Override to route e.g. eip155:296 to "hedera".
   */
  familyForNetwork?(net: Network): Family;
  /** Network a fresh origin starts on for a family. Default: first registry network of that family. */
  defaultNetwork?(origin: string, family: Family): NetworkId | undefined;
  isUnlocked?(): boolean | Promise<boolean>;
  /** Told when the router gives up on a request (timeout) so the approval window can close. */
  cancel?(requestId: string, reason: "timeout"): void;
  timeouts?: { approvalMs?: number; readMs?: number };
  rateLimit?: { perSecond?: number; burst?: number; maxPendingApprovals?: number };
  newId?(): string;
  now?(): number;
}

export interface DispatchInput {
  family: Family;
  method: string;
  params?: unknown;
  /** CAIP-2 or Wallet Standard chain hint from the page. Validated against the registry. */
  chain?: string | undefined;
}

export interface OneMaskRouter {
  /** Wire a content-script port. Pass `senderOrigin` (from port.sender) to cross-check the content script. */
  attachPort(port: RouterPort, opts?: { senderOrigin?: string }): void;
  /** Core entry point; `origin` must come from the content script / sender, never from the page. */
  dispatch(origin: string, input: DispatchInput): Promise<unknown>;
  emit(origin: string, family: Family, event: OneMaskEvent, data?: unknown): void;
  /** Push fresh accounts to every connected origin (after the user switches accounts, locks, unlocks). */
  notifyAccountsChanged(family?: Family): Promise<void>;
  /** Disconnect a site (from the wallet UI). */
  revoke(origin: string, family?: Family): Promise<void>;
  selectedNetwork(origin: string, family: Family): Network | undefined;
  connectedOrigins(): string[];
}

const FAMILIES: readonly Family[] = ALL_FAMILIES;

function exposeAccount(a: AccountLike): ExposedAccount & { purpose?: string; addressType?: string } {
  const out: ExposedAccount & { purpose?: string; addressType?: string } = { address: a.address };
  if (a.publicKey) out.publicKey = a.publicKey;
  if (a.purpose) out.purpose = a.purpose;
  if (a.addressType) out.addressType = a.addressType;
  return out;
}

export function defaultRouterFamilyForNetwork(net: Network): Family {
  return net.id.startsWith("eip155:") ? "evm" : net.family;
}

export function createOneMaskRouter(opts: OneMaskRouterOptions): OneMaskRouter {
  const familyFor = opts.familyForNetwork ?? defaultRouterFamilyForNetwork;
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? randomId;
  const approvalMs = opts.timeouts?.approvalMs ?? 10 * 60_000;
  const readMs = opts.timeouts?.readMs ?? 30_000;
  const perSecond = opts.rateLimit?.perSecond ?? 20;
  const burst = opts.rateLimit?.burst ?? 60;
  const maxPendingApprovals = opts.rateLimit?.maxPendingApprovals ?? 5;

  const ports = new Map<string, Set<RouterPort>>();
  /** origin → provider family → selected network id */
  const selected = new Map<string, Map<Family, NetworkId>>();
  const buckets = new Map<string, { tokens: number; at: number }>();
  const pendingApprovals = new Map<string, number>();
  const pendingConnect = new Set<string>();

  /* ------------------------------------------------------------ helpers */

  /** Networks a provider family can talk to. The EVM provider sees every eip155 network. */
  const candidates = (family: Family): Network[] =>
    family === "evm"
      ? opts.networks.filter((n) => n.id.startsWith("eip155:"))
      : opts.networks.filter((n) => familyFor(n) === family);

  const selectedNetwork = (origin: string, family: Family): Network | undefined => {
    const id = selected.get(origin)?.get(family) ?? opts.defaultNetwork?.(origin, family);
    const list = candidates(family);
    return list.find((n) => n.id === id) ?? list[0];
  };

  const setSelected = (origin: string, family: Family, id: NetworkId) => {
    let m = selected.get(origin);
    if (!m) selected.set(origin, (m = new Map()));
    m.set(family, id);
  };

  const rateLimited = (origin: string): boolean => {
    const t = now();
    const b = buckets.get(origin) ?? { tokens: burst, at: t };
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * perSecond);
    b.at = t;
    buckets.set(origin, b);
    if (b.tokens < 1) return true;
    b.tokens -= 1;
    return false;
  };

  const withTimeout = <T>(p: Promise<T>, ms: number, id: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        opts.cancel?.(id, "timeout");
        reject(new ProviderRpcError(RpcErrorCode.Internal, "The request timed out in Clip Wallet."));
      }, ms);
      p.then(
        (v) => (clearTimeout(timer), resolve(v)),
        (e) => (clearTimeout(timer), reject(e)),
      );
    });

  const accounts = async (origin: string, family: Family) =>
    (await opts.accountsFor(origin, family)).filter((a) => a && typeof a.address === "string").map(exposeAccount);

  const permitted = async (origin: string, family: Family) => !!(await opts.permissions.has(origin, family));

  const requirePermission = async (origin: string, family: Family) => {
    if (!(await permitted(origin, family))) throw rpcError.unauthorized();
  };

  const makeReq = (origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest => ({
    id: newId(),
    origin,
    via: "injected",
    family: familyFor(net) ?? family,
    networkId: net.id,
    method,
    params,
  });

  /** Runs `handle` for something the user must approve: per-origin cap + approval timeout. */
  const approve = async (req: DappRequest): Promise<unknown> => {
    const n = pendingApprovals.get(req.origin) ?? 0;
    if (n >= maxPendingApprovals) throw rpcError.limitExceeded("Too many requests from this site are waiting in Clip Wallet.");
    pendingApprovals.set(req.origin, n + 1);
    try {
      return await withTimeout(opts.handle(req), approvalMs, req.id);
    } finally {
      const left = (pendingApprovals.get(req.origin) ?? 1) - 1;
      if (left <= 0) pendingApprovals.delete(req.origin);
      else pendingApprovals.set(req.origin, left);
    }
  };

  /** Connect approval shared by all families; -32002 if one is already waiting for this origin+family. */
  const connect = async (origin: string, family: Family, net: Network, method: string, params: unknown) => {
    const key = `${family}\u0000${origin}`;
    if (pendingConnect.has(key)) throw rpcError.pending();
    pendingConnect.add(key);
    try {
      await approve(makeReq(origin, family, net, method, params));
      await opts.permissions.grant(origin, family);
    } finally {
      pendingConnect.delete(key);
    }
    const list = await accounts(origin, family);
    emit(origin, family, "accountsChanged", family === "evm" ? list.map((a) => a.address) : list);
    return list;
  };

  const emit = (origin: string, family: Family, event: OneMaskEvent, data?: unknown) => {
    const msg: PortEvent = { type: "event", family, event, data };
    for (const p of ports.get(origin) ?? []) {
      try {
        p.postMessage(msg);
      } catch {
        /* dead port; onDisconnect cleans up */
      }
    }
  };

  const requireNetwork = (family: Family, origin: string, chain: string | undefined): Network => {
    if (chain !== undefined) {
      const net = networkForChain(candidates(family), family, chain) ?? candidates(family).find((n) => n.id === chain);
      if (!net) throw rpcError.chainDisconnected(`Clip Wallet does not support ${chain}.`);
      return net;
    }
    const net = selectedNetwork(origin, family);
    if (!net) throw rpcError.chainDisconnected();
    return net;
  };

  const sameAddress = (family: Family, a: string, b: string) =>
    family === "evm" || family === "sui" || family === "aptos" ? a.toLowerCase() === b.toLowerCase() : a === b;

  const requireOwnAddresses = async (origin: string, family: Family, addresses: unknown[]) => {
    const list = await accounts(origin, family);
    for (const addr of addresses) {
      if (typeof addr !== "string" || !list.some((a) => sameAddress(family, a.address, addr))) {
        throw rpcError.unauthorized("That account is not connected to this site.");
      }
    }
  };

  /* ------------------------------------------------------------ EVM */

  const evmParams = (params: unknown): unknown[] => {
    if (params === undefined) return [];
    if (!Array.isArray(params)) throw rpcError.invalidParams("params must be an array.");
    return params;
  };

  const permissionObject = (origin: string, addrs: string[]) => [
    {
      id: `${origin}#eth_accounts`,
      parentCapability: "eth_accounts",
      invoker: origin,
      date: now(),
      caveats: [{ type: "restrictReturnedAccounts", value: addrs }],
    },
  ];

  const switchEvmChain = (origin: string, raw: unknown) => {
    const chainId = parseChainId((raw as { chainId?: unknown } | undefined)?.chainId);
    if (chainId === undefined) throw rpcError.invalidParams("chainId must be a hex string like 0x1.");
    const net = findEvmNetwork(candidates("evm"), chainId);
    if (!net) return undefined;
    const before = selectedNetwork(origin, "evm");
    setSelected(origin, "evm", net.id);
    // Networks are invisible: registry networks switch without a prompt.
    if (before?.id !== net.id) emit(origin, "evm", "chainChanged", toHexChainId(chainId));
    return net;
  };

  const dispatchEvm = async (origin: string, method: string, rawParams: unknown): Promise<unknown> => {
    if ((EVM_METHODS.rejected as readonly string[]).includes(method)) {
      throw new ProviderRpcError(RpcErrorCode.UnsupportedMethod, "eth_sign is disabled in Clip Wallet. Use personal_sign or eth_signTypedData_v4.");
    }
    const net = selectedNetwork(origin, "evm");
    if (!net) throw rpcError.chainDisconnected("Clip Wallet has no EVM networks.");
    const chainId = evmChainId(net)!;
    const params = evmParams(rawParams);

    switch (method) {
      case METHOD_PROVIDER_STATE: {
        const state: EvmProviderState = {
          chainId: toHexChainId(chainId),
          networkVersion: String(chainId),
          accounts: (await permitted(origin, "evm")) ? (await accounts(origin, "evm")).map((a) => a.address) : [],
          isUnlocked: opts.isUnlocked ? !!(await opts.isUnlocked()) : true,
        };
        return state;
      }
      case "eth_chainId":
        return toHexChainId(chainId);
      case "net_version":
        return String(chainId);
      case "eth_accounts":
        return (await permitted(origin, "evm")) ? (await accounts(origin, "evm")).map((a) => a.address) : [];
      case "eth_requestAccounts": {
        if (await permitted(origin, "evm")) return (await accounts(origin, "evm")).map((a) => a.address);
        return (await connect(origin, "evm", net, method, params)).map((a) => a.address);
      }
      case "wallet_requestPermissions": {
        const req = params[0];
        if (!req || typeof req !== "object" || Object.keys(req).length === 0) {
          throw rpcError.invalidParams("Expected [{ eth_accounts: {} }].");
        }
        for (const k of Object.keys(req)) {
          if (k !== "eth_accounts") throw rpcError.invalidParams(`Unknown permission ${k}.`);
        }
        const list = await connect(origin, "evm", net, method, params);
        return permissionObject(origin, list.map((a) => a.address));
      }
      case "wallet_getPermissions":
        return (await permitted(origin, "evm"))
          ? permissionObject(origin, (await accounts(origin, "evm")).map((a) => a.address))
          : [];
      case "wallet_revokePermissions":
        await revoke(origin, "evm");
        return null;
      case "wallet_switchEthereumChain": {
        const raw = params[0];
        const switched = switchEvmChain(origin, raw);
        if (!switched) throw rpcError.unrecognizedChain(String((raw as { chainId?: unknown })?.chainId));
        return null;
      }
      case "wallet_addEthereumChain": {
        // Never add arbitrary RPCs: only networks already in the registry are accepted (and switched to).
        const switched = switchEvmChain(origin, params[0]);
        if (!switched) {
          throw new ProviderRpcError(
            RpcErrorCode.UserRejected,
            "Clip Wallet only connects to the networks it ships with. This network is not one of them.",
          );
        }
        return null;
      }
    }

    if ((EVM_METHODS.signing as readonly string[]).includes(method)) {
      await requirePermission(origin, "evm");
      if (method === "personal_sign") {
        if (params.length < 2) throw rpcError.invalidParams("personal_sign expects [message, address].");
        await requireOwnAddresses(origin, "evm", [params[1]]);
      } else if (method === "eth_signTypedData_v4") {
        if (params.length < 2) throw rpcError.invalidParams("eth_signTypedData_v4 expects [address, typedData].");
        await requireOwnAddresses(origin, "evm", [params[0]]);
      } else {
        const tx = params[0] as { from?: unknown; chainId?: unknown } | undefined;
        if (!tx || typeof tx !== "object") throw rpcError.invalidParams("eth_sendTransaction expects [transaction].");
        await requireOwnAddresses(origin, "evm", [tx.from]);
        if (tx.chainId !== undefined && parseChainId(tx.chainId) !== chainId) {
          throw rpcError.invalidParams("The transaction's chainId does not match the selected network.");
        }
      }
      return approve(makeReq(origin, "evm", net, method, params));
    }

    // Read-only JSON-RPC: proxied to the background's RPC, no prompt.
    const req = makeReq(origin, "evm", net, method, params);
    return withTimeout(opts.handle(req), readMs, req.id);
  };

  /* ------------------------------------------------------------ Solana & Bitcoin (Wallet Standard) */

  const inputsOf = (params: unknown): Record<string, unknown>[] => {
    const inputs = (params as { inputs?: unknown } | undefined)?.inputs;
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 32) {
      throw rpcError.invalidParams("Expected { inputs: [...] } with 1 to 32 entries.");
    }
    for (const i of inputs) if (!i || typeof i !== "object") throw rpcError.invalidParams("Invalid input.");
    return inputs as Record<string, unknown>[];
  };

  /** All inputs must target the same registry network (one DappRequest has one networkId). */
  const chainFromInputs = (family: Family, origin: string, inputs: Record<string, unknown>[], hint?: string) => {
    const chains = new Set(inputs.map((i) => i.chain).filter((c): c is string => typeof c === "string"));
    if (hint) chains.add(hint);
    if (chains.size > 1) throw rpcError.invalidParams("All inputs must use the same chain.");
    return requireNetwork(family, origin, [...chains][0]);
  };

  const dispatchStandard = async (
    origin: string,
    family: "solana" | "bitcoin" | "sui" | "aptos",
    method: string,
    params: unknown,
    chain: string | undefined,
  ): Promise<unknown> => {
    switch (method) {
      case METHOD_WS_STATE:
        return (await permitted(origin, family)) ? accounts(origin, family) : [];
      case "standard:disconnect":
      case "bitcoin:disconnect":
      case "aptos:disconnect":
        await revoke(origin, family);
        return null;
      case METHOD_APTOS_NETWORK:
        return { networkId: requireNetwork(family, origin, chain).id };
      case "standard:connect":
      case "bitcoin:connect":
      case "aptos:connect": {
        if (await permitted(origin, family)) return accounts(origin, family);
        return connect(origin, family, requireNetwork(family, origin, chain), method, params ?? {});
      }
      case "solana:signIn": {
        const inputs = inputsOf(params);
        const net = requireNetwork(family, origin, chain);
        const res = await approve(makeReq(origin, family, net, method, { inputs }));
        if (!(await permitted(origin, family))) {
          await opts.permissions.grant(origin, family);
          emit(origin, family, "accountsChanged", await accounts(origin, family));
        }
        return res;
      }
    }

    await requirePermission(origin, family);
    const inputs = method === "bitcoin:sendTransfer" ? [] : inputsOf(params);
    if (family === "solana" || family === "sui" || family === "aptos") {
      await requireOwnAddresses(origin, family, inputs.map((i) => i.account));
      if (method === "solana:signAndSendTransaction" && inputs.some((i) => typeof i.chain !== "string")) {
        throw rpcError.invalidParams("solana:signAndSendTransaction needs a chain.");
      }
    } else if (method === "bitcoin:signMessage") {
      await requireOwnAddresses(origin, family, inputs.map((i) => i.address));
    } else if (method !== "bitcoin:sendTransfer") {
      const addrs = inputs.flatMap((i) =>
        Array.isArray(i.inputsToSign) ? (i.inputsToSign as { address?: unknown }[]).map((s) => s?.address) : [undefined],
      );
      await requireOwnAddresses(origin, family, addrs);
    }
    const net = method === "bitcoin:sendTransfer" ? requireNetwork(family, origin, chain) : chainFromInputs(family, origin, inputs, chain);
    return approve(makeReq(origin, family, net, method, params));
  };

  /* ------------------------------------------------------------ public */

  /** Errors leave the router as ProviderRpcError {code,message} only: no stacks, no causes. */
  const dispatch = (origin: string, input: DispatchInput): Promise<unknown> =>
    dispatchRaw(origin, input).catch((err) => {
      throw fromRpcErrorShape(toRpcErrorShape(err));
    });

  const dispatchRaw = async (origin: string, input: DispatchInput): Promise<unknown> => {
    const { family, method, params, chain } = input;
    if (rateLimited(origin)) throw rpcError.limitExceeded();
    if (family === "evm" && (EVM_METHODS.rejected as readonly string[]).includes(method)) {
      return dispatchEvm(origin, method, params);
    }
    if (!injectedAllowlist(family).has(method)) throw rpcError.unsupportedMethod(method);
    if (family === "evm") return dispatchEvm(origin, method, params);
    if (family === "solana" || family === "bitcoin" || family === "sui" || family === "aptos") {
      return dispatchStandard(origin, family, method, params, chain);
    }
    throw rpcError.unsupportedMethod(method);
  };

  const revoke = async (origin: string, family?: Family, o?: { silent?: boolean }) => {
    for (const f of family ? [family] : FAMILIES) {
      const had = await permitted(origin, f);
      await opts.permissions.revoke(origin, f);
      if (had && !o?.silent) {
        emit(origin, f, "accountsChanged", []);
        if (f !== "evm") emit(origin, f, "disconnect");
      }
    }
  };

  const attachPort = (port: RouterPort, o?: { senderOrigin?: string }) => {
    const origins = new Set<string>();
    const register = (origin: string) => {
      if (origins.has(origin)) return;
      origins.add(origin);
      let set = ports.get(origin);
      if (!set) ports.set(origin, (set = new Set()));
      set.add(port);
    };
    if (o?.senderOrigin) register(o.senderOrigin);
    const respond = (msg: PortResponse) => {
      try {
        port.postMessage(msg);
      } catch {
        /* port gone */
      }
    };
    port.onMessage.addListener((raw) => {
      const parsed = portRequestSchema.safeParse(raw);
      if (!parsed.success) return;
      const req = parsed.data;
      if (o?.senderOrigin && req.origin !== o.senderOrigin) {
        respond({ type: "response", id: req.id, error: rpcError.unauthorized("Origin mismatch.").toJSON() });
        return;
      }
      register(req.origin);
      dispatch(req.origin, { family: req.family, method: req.method, params: req.params, chain: req.chain }).then(
        (result) => respond({ type: "response", id: req.id, result: result === undefined ? null : result }),
        (err) => respond({ type: "response", id: req.id, error: toRpcErrorShape(err) }),
      );
    });
    port.onDisconnect.addListener(() => {
      for (const origin of origins) {
        const set = ports.get(origin);
        set?.delete(port);
        if (set && set.size === 0) ports.delete(origin);
      }
    });
  };

  const notifyAccountsChanged = async (family?: Family) => {
    for (const origin of ports.keys()) {
      for (const f of family ? [family] : FAMILIES) {
        if (!(await permitted(origin, f))) continue;
        const list = await accounts(origin, f);
        emit(origin, f, "accountsChanged", f === "evm" ? list.map((a) => a.address) : list);
      }
    }
  };

  return {
    attachPort,
    dispatch,
    emit,
    notifyAccountsChanged,
    revoke: (origin, family) => revoke(origin, family),
    selectedNetwork,
    connectedOrigins: () => [...ports.keys()],
  };
}

export { SOLANA_METHODS, BITCOIN_METHODS_ALLOWED };
