import type { Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import { RpcErrorCode, toRpcErrorShape } from "../shared/errors.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { STACKS_INJECTED, STACKS_SIGNING_METHODS, stacksChainHint } from "../shared/stacks.js";
import { Emitter } from "./emitter.js";
import { DEFAULT_GLOBAL_KEY, exposeOnGlobal, type InjectedOptions } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Injected Stacks provider at `window.clipwallet.stacks` (or `window[globalKey].stacks`), implementing SIP-030
 * (https://github.com/stacksgov/sips/blob/main/sips/sip-030/sip-030-wallet-interface.md): `request(method, params)`
 * answers with a JSON-RPC 2.0 response `{ jsonrpc, id, result }` and rejects with `{ jsonrpc, id, error }` using the
 * SIP-030 codes (-32000 user rejection, -32002 access denied, -32601 method not found, -32602 invalid params).
 *
 * Discovery is WBIP-004 (https://wbips.netlify.app/wbips/WBIP004): the wallet PUSHES `{ id, name, icon, methods }`
 * onto `window.wbip_providers`, where `id` is the provider's path on `window`. @stacks/connect v8 reads that array
 * for its wallet list (connect-ui `getRegisteredProviders`) and resolves the chosen id with
 * `id.split(".").reduce((o, k) => o?.[k], window)` (`getProviderFromId`), so the id "clipwallet.stacks" finds this
 * object. https://github.com/stx-labs/connect/blob/main/packages/connect-ui/src/providers.ts
 *
 * SIP-030 discourages a shared global ("Using a shared global object between multiple wallets is discouraged"), so
 * this never sets `window.StacksProvider`, `window.LeatherProvider` or `window.XverseProviders`. Holds no secrets.
 */

export type StacksJsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string; data?: unknown } });

/** SIP-030 error codes. */
export const SIP030_ERRORS = { userRejection: -32000, addressMismatch: -32001, accessDenied: -32002, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

export function toSip030Error(err: unknown): { code: number; message: string } {
  const e = toRpcErrorShape(err);
  const code =
    e.code === RpcErrorCode.UserRejected
      ? SIP030_ERRORS.userRejection
      : e.code === RpcErrorCode.Unauthorized
        ? SIP030_ERRORS.accessDenied
        : e.code === RpcErrorCode.UnsupportedMethod || e.code === RpcErrorCode.MethodNotFound
          ? SIP030_ERRORS.methodNotFound
          : e.code === RpcErrorCode.InvalidParams || e.code === RpcErrorCode.ChainDisconnected || e.code === RpcErrorCode.UnrecognizedChain
            ? SIP030_ERRORS.invalidParams
            : SIP030_ERRORS.internal;
  return { code, message: e.message };
}

/** WBIP-004 provider entry. */
export interface WbipProvider {
  id: string;
  name: string;
  icon: string;
  webUrl?: string;
  methods?: string[];
}

const ADDRESS_METHODS = new Set(["getAddresses", "stx_getAddresses", "stx_requestAccounts"]);
export const STACKS_PROVIDER_METHODS = ["getAddresses", "stx_getAddresses", "stx_getNetworks", ...STACKS_SIGNING_METHODS];

export class ClipStacksProvider {
  readonly isClipWallet = true;
  readonly name: string;
  readonly icon: string;
  readonly #events = new Emitter();
  readonly #transport: InpageTransport;
  #accounts: ExposedAccount[] = [];
  #nextId = 1;

  constructor(identity: WalletIdentity, _networks: Network[], transport: InpageTransport) {
    this.name = identity.name;
    this.icon = identity.icon;
    this.#transport = transport;
    transport.onEvent((f, event, data) => {
      if (f !== "stacks") return;
      if (event === "accountsChanged") this.#setAccounts(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      if (event === "disconnect") {
        this.#setAccounts([]);
        this.#events.emit("disconnect");
      }
    });
  }

  #setAccounts(next: ExposedAccount[]): void {
    const clean = next.filter((a) => a && typeof a.address === "string");
    const changed = clean.length !== this.#accounts.length || clean.some((a, i) => a.address !== this.#accounts[i]?.address);
    this.#accounts = clean;
    if (changed) this.#events.emit("accountsChanged", this.#accounts.map((a) => ({ address: a.address, publicKey: a.publicKey ?? "" })));
  }

  #send(method: string, params?: unknown, chain?: string): Promise<unknown> {
    return this.#transport.request("stacks", method, params, chain);
  }

  async #call(method: string, params: unknown): Promise<unknown> {
    const p = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
    const chain = stacksChainHint(p.network);
    if (p.network !== undefined && !chain) {
      throw Object.assign(new Error(`Clip Wallet doesn't support the Stacks network “${String(p.network)}”.`), { code: RpcErrorCode.InvalidParams });
    }
    if (ADDRESS_METHODS.has(method)) {
      const list = (await this.#send(STACKS_INJECTED.connect, p, chain)) as ExposedAccount[];
      this.#setAccounts(Array.isArray(list) ? list : []);
      return { addresses: this.#accounts.map((a) => ({ symbol: "STX", address: a.address, publicKey: a.publicKey ?? "" })) };
    }
    if (method === STACKS_INJECTED.getNetworks) return this.#send(method, undefined, chain);
    if (STACKS_SIGNING_METHODS.includes(method)) return this.#send(method, params ?? {}, chain);
    throw Object.assign(new Error(`Clip Wallet does not support ${method}.`), { code: RpcErrorCode.MethodNotFound });
  }

  /** SIP-030 request. Resolves `{ jsonrpc, id, result }`; rejects with `{ jsonrpc, id, error }`. */
  async request(method: string, params?: unknown): Promise<StacksJsonRpcResponse> {
    const id = this.#nextId++;
    if (typeof method !== "string") throw { jsonrpc: "2.0", id, error: { code: SIP030_ERRORS.invalidParams, message: "Expected a method name." } };
    try {
      return { jsonrpc: "2.0", id, result: await this.#call(method, params) };
    } catch (err) {
      throw { jsonrpc: "2.0", id, error: toSip030Error(err) };
    }
  }

  /** SIP-030 listeners: "stx_accountChange" (accounts), also "accountsChanged" and "disconnect". Returns unlisten. */
  listen(event: string, listener: (...args: any[]) => void): () => void {
    const name = event === "stx_accountChange" ? "accountsChanged" : event;
    this.#events.on(name, listener);
    return () => this.#events.removeListener(name, listener);
  }

  /** Accounts this site sees right now (silent, no prompt). */
  async accounts(): Promise<{ address: string; publicKey: string }[]> {
    const list = (await this.#send(STACKS_INJECTED.accounts)) as ExposedAccount[];
    this.#setAccounts(Array.isArray(list) ? list : []);
    return this.#accounts.map((a) => ({ address: a.address, publicKey: a.publicKey ?? "" }));
  }

  async disconnect(): Promise<void> {
    await this.#send(STACKS_INJECTED.disconnect);
    this.#setAccounts([]);
  }
}

export function installStacksProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions & { webUrl?: string } = {},
): { provider: ClipStacksProvider; entry: WbipProvider; stop(): void } {
  const provider = new ClipStacksProvider(identity, networks, transport);
  const key = opts.globalKey ?? DEFAULT_GLOBAL_KEY;
  const unexpose = exposeOnGlobal(win, key, "stacks", provider, identity);
  const entry: WbipProvider = Object.freeze({
    id: `${key}.stacks`,
    name: identity.name,
    icon: identity.icon,
    ...(opts.webUrl ? { webUrl: opts.webUrl } : {}),
    methods: [...STACKS_PROVIDER_METHODS],
  });
  // WBIP-004: make sure the array exists, then push; never replace it (other wallets' entries stay).
  const w = win as unknown as { wbip_providers?: unknown };
  if (!Array.isArray(w.wbip_providers)) w.wbip_providers = [];
  const list = w.wbip_providers as WbipProvider[];
  if (!list.some((p) => p && p.id === entry.id)) list.push(entry);
  return {
    provider,
    entry,
    stop: () => {
      unexpose();
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    },
  };
}
