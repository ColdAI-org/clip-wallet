import type { WalletIdentity } from "../shared/config.js";
import { RpcErrorCode } from "../shared/errors.js";
import type { ExposedAccount } from "../shared/protocol.js";
import type { InpageTransport } from "./transport.js";

/**
 * get-starknet v4 injected wallet (`window.starknet_<id>`), implementing the Starknet wallet API
 * (@starknet-io/types-js 0.10 `StarknetWindowObject`): `id`, `name`, `version`, `icon`,
 * `request({ type, params })`, `on` / `off` for `accountsChanged` and `networkChanged`.
 * get-starknet-core 4.0.8 discovers it by scanning `window` for keys starting with "starknet" whose value has
 * id/name/version/icon/request/on/off. Every call goes to the background router (family "starknet").
 */

/** Starknet wallet API error codes (types-js wallet-api/errors.d.ts). */
export const STARKNET_ERRORS = {
  NOT_ERC20: 111,
  UNLISTED_NETWORK: 112,
  USER_REFUSED_OP: 113,
  INVALID_REQUEST_PAYLOAD: 114,
  ACCOUNT_ALREADY_DEPLOYED: 115,
  DEPLOYMENT_DATA_NOT_AVAILABLE: 116,
  CHAIN_ID_NOT_SUPPORTED: 117,
  API_VERSION_NOT_SUPPORTED: 162,
  UNKNOWN_ERROR: 163,
} as const;

const NAMES: Record<number, string> = Object.fromEntries(Object.entries(STARKNET_ERRORS).map(([k, v]) => [v, k]));

export class StarknetWalletError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "StarknetWalletError";
  }
}

/** EIP-1193-style codes from the router → Starknet wallet API codes. Our plain-words message goes in `data`. */
export function toStarknetError(err: unknown): StarknetWalletError {
  const e = (err ?? {}) as { code?: unknown; message?: unknown; data?: unknown };
  const msg = typeof e.message === "string" ? e.message : "Request failed.";
  let code: number = STARKNET_ERRORS.UNKNOWN_ERROR;
  switch (e.code) {
    case RpcErrorCode.UserRejected:
    case RpcErrorCode.Unauthorized:
      code = STARKNET_ERRORS.USER_REFUSED_OP;
      break;
    case RpcErrorCode.InvalidParams:
      code = STARKNET_ERRORS.INVALID_REQUEST_PAYLOAD;
      break;
    case RpcErrorCode.UnrecognizedChain:
    case RpcErrorCode.ChainDisconnected:
      code = STARKNET_ERRORS.UNLISTED_NETWORK;
      break;
    default:
      if (typeof e.code === "number" && NAMES[e.code]) code = e.code;
  }
  return new StarknetWalletError(code, `An error occurred (${NAMES[code]})`, msg);
}

type AccountsHandler = (accounts?: string[]) => void;
type NetworkHandler = (chainId?: string, accounts?: string[]) => void;
type Handlers = { accountsChanged: AccountsHandler; networkChanged: NetworkHandler };

/** Window key suffix from the wallet name ("Clip Wallet" → "clipwallet"). */
export function starknetWalletId(identity: WalletIdentity): string {
  const id = identity.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return id || "clipwallet";
}

export class ClipStarknetWallet {
  readonly id: string;
  readonly name: string;
  readonly version = "1.0.0";
  readonly icon: string;
  #transport: InpageTransport;
  #accounts: string[] = [];
  #chainId: string | undefined;
  #listeners: { [K in keyof Handlers]: Set<Handlers[K]> } = { accountsChanged: new Set(), networkChanged: new Set() };

  constructor(identity: WalletIdentity, transport: InpageTransport) {
    this.id = starknetWalletId(identity);
    this.name = identity.name;
    this.icon = identity.icon;
    this.#transport = transport;
    transport.onEvent((family, event, data) => {
      if (family !== "starknet") return;
      if (event === "accountsChanged") this.#setAccounts(Array.isArray(data) ? (data as (ExposedAccount | string)[]) : []);
      else if (event === "disconnect") this.#setAccounts([]);
      else if (event === "chainChanged" && typeof data === "string") this.#setChain(data);
    });
  }

  /** Last accounts this site was allowed to see (not part of the spec; handy for debugging). */
  get selectedAddress(): string | undefined {
    return this.#accounts[0];
  }

  request = async (call: { type: string; params?: unknown }): Promise<unknown> => {
    if (!call || typeof call !== "object" || typeof call.type !== "string" || !call.type) {
      throw new StarknetWalletError(STARKNET_ERRORS.INVALID_REQUEST_PAYLOAD, "An error occurred (INVALID_REQUEST_PAYLOAD)", "Expected { type, params }.");
    }
    let result: unknown;
    try {
      result = await this.#transport.request("starknet", call.type, call.params);
    } catch (e) {
      throw toStarknetError(e);
    }
    if (call.type === "wallet_requestAccounts" && Array.isArray(result)) this.#setAccounts(result as string[]);
    if (call.type === "wallet_requestChainId" && typeof result === "string") this.#chainId ??= result;
    return result;
  };

  on = <E extends keyof Handlers>(event: E, handler: Handlers[E]): void => {
    if (typeof handler !== "function" || !(event in this.#listeners)) return;
    (this.#listeners[event] as Set<Handlers[E]>).add(handler);
  };

  off = <E extends keyof Handlers>(event: E, handler: Handlers[E]): void => {
    (this.#listeners[event] as Set<Handlers[E]> | undefined)?.delete(handler);
  };

  #setAccounts(list: (ExposedAccount | string)[]) {
    const next = list.map((a) => (typeof a === "string" ? a : a?.address)).filter((a): a is string => typeof a === "string");
    if (next.length === this.#accounts.length && next.every((a, i) => a === this.#accounts[i])) return;
    this.#accounts = next;
    for (const l of [...this.#listeners.accountsChanged]) safe(() => l(next));
  }

  #setChain(chainId: string) {
    if (chainId === this.#chainId) return;
    this.#chainId = chainId;
    for (const l of [...this.#listeners.networkChanged]) safe(() => l(chainId, this.#accounts));
  }
}

function safe(f: () => void) {
  try {
    f();
  } catch {
    /* a dapp listener throwing must not break the wallet */
  }
}

/**
 * Defines `window.starknet_<id>` (never overwriting another wallet's object). Also sets the legacy
 * `window.starknet` only when asked and nothing owns it.
 */
export function injectStarknet(win: Window, wallet: ClipStarknetWallet, opts: { claimWindowStarknet?: boolean } = {}): { key: string; stop(): void } {
  const key = `starknet_${wallet.id}`;
  const w = win as unknown as Record<string, unknown>;
  const owned: string[] = [];
  const define = (k: string) => {
    if (w[k] !== undefined) return;
    Object.defineProperty(win, k, { value: wallet, configurable: true, enumerable: true, writable: false });
    owned.push(k);
  };
  define(key);
  if (opts.claimWindowStarknet) define("starknet");
  return {
    key,
    stop: () => {
      for (const k of owned) if (w[k] === wallet) delete w[k];
    },
  };
}
