import type { WalletIdentity } from "../shared/config.js";
import { ProviderRpcError, RpcErrorCode, rpcError } from "../shared/errors.js";
import { METHOD_PROVIDER_STATE, type EvmProviderState } from "../shared/protocol.js";
import { uuidV4 } from "../shared/bytes.js";
import { Emitter } from "./emitter.js";
import type { InpageTransport } from "./transport.js";

export interface RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

/** EIP-6963 provider info. */
export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: ClipEthereumProvider;
}

/**
 * EIP-1193 provider. Every call goes to the background router, which owns permissions, the per-site
 * network and the method allowlist; the page-side object only keeps a cache for events.
 */
export class ClipEthereumProvider extends Emitter {
  readonly isClipWallet = true;
  #transport: InpageTransport;
  #chainId: string | null = null;
  #accounts: string[] = [];
  #connected = false;
  /** Resolves once the initial state was fetched (or failed). Requests do not wait on it. */
  readonly ready: Promise<void>;

  constructor(transport: InpageTransport) {
    super();
    this.#transport = transport;
    transport.onEvent((family, event, data) => {
      if (family !== "evm") return;
      this.#onEvent(event, data);
    });
    this.ready = this.#init();
  }

  /** Current chain id as last reported (hex), or null before the first answer. */
  get chainId(): string | null {
    return this.#chainId;
  }

  /** Last accounts the site was allowed to see. */
  get selectedAddress(): string | null {
    return this.#accounts[0] ?? null;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  async request(args: RequestArguments): Promise<unknown> {
    if (!args || typeof args !== "object" || typeof args.method !== "string" || args.method.length === 0) {
      throw rpcError.invalidParams("Expected a single, non-array, object argument with a 'method' string.");
    }
    const { method } = args;
    const params = args.params;
    if (params !== undefined && (params === null || typeof params !== "object")) {
      throw rpcError.invalidParams("'params' must be an array or object if provided.");
    }
    // Refused locally too, so a broken background can never turn it on.
    if (method === "eth_sign") {
      throw new ProviderRpcError(
        RpcErrorCode.UnsupportedMethod,
        "eth_sign is disabled: it signs raw hashes that can hide any transaction. Use personal_sign or eth_signTypedData_v4.",
      );
    }
    const result = await this.#transport.request("evm", method, params);
    if (method === "eth_requestAccounts" || method === "eth_accounts") {
      if (Array.isArray(result)) this.#setAccounts(result as string[]);
    } else if (method === "eth_chainId" && typeof result === "string") {
      this.#setChain(result);
    }
    return result;
  }

  /** Legacy: `ethereum.enable()`. */
  enable(): Promise<unknown> {
    return this.request({ method: "eth_requestAccounts" });
  }

  async #init(): Promise<void> {
    try {
      const state = (await this.#transport.request("evm", METHOD_PROVIDER_STATE)) as EvmProviderState;
      this.#chainId = state.chainId;
      this.#accounts = Array.isArray(state.accounts) ? state.accounts : [];
      this.#connected = true;
      this.emit("connect", { chainId: state.chainId });
    } catch {
      // Background not reachable yet: stay "disconnected"; requests still go through and may succeed.
    }
  }

  #setAccounts(accounts: string[]): void {
    const same = accounts.length === this.#accounts.length && accounts.every((a, i) => a === this.#accounts[i]);
    this.#accounts = accounts;
    if (!same) this.emit("accountsChanged", accounts);
  }

  #setChain(chainId: string): void {
    if (chainId === this.#chainId) return;
    this.#chainId = chainId;
    this.emit("chainChanged", chainId);
  }

  #onEvent(event: string, data: unknown): void {
    switch (event) {
      case "accountsChanged":
        if (Array.isArray(data)) this.#setAccounts(data.filter((a): a is string => typeof a === "string"));
        break;
      case "chainChanged":
        if (typeof data === "string") this.#setChain(data);
        break;
      case "connect": {
        const chainId = (data as { chainId?: unknown } | undefined)?.chainId;
        if (typeof chainId === "string") this.#chainId = chainId;
        if (!this.#connected) {
          this.#connected = true;
          this.emit("connect", { chainId: this.#chainId });
        }
        break;
      }
      case "disconnect":
        this.#connected = false;
        this.#setAccounts([]);
        this.emit("disconnect", rpcError.disconnected());
        break;
    }
  }
}

/**
 * EIP-6963: announce on load and whenever a dapp dispatches `eip6963:requestProvider`.
 * The uuid is a v4 UUID generated once per page session and reused for every announcement.
 */
export function announceEip6963(
  win: Window,
  identity: WalletIdentity,
  provider: ClipEthereumProvider,
): { detail: EIP6963ProviderDetail; stop(): void } {
  const info: EIP6963ProviderInfo = Object.freeze({
    uuid: uuidV4(),
    name: identity.name,
    icon: identity.icon,
    rdns: identity.rdns,
  });
  const detail: EIP6963ProviderDetail = Object.freeze({ info, provider });
  const announce = () => win.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  win.addEventListener("eip6963:requestProvider", announce);
  announce();
  return { detail, stop: () => win.removeEventListener("eip6963:requestProvider", announce) };
}

/**
 * Optional legacy injection. Only defines `window.ethereum` when nothing owns it; overriding another
 * wallet is compatibility-mode territory (not in v1).
 */
export function claimWindowEthereum(win: Window, provider: ClipEthereumProvider): boolean {
  const w = win as unknown as { ethereum?: unknown };
  if (w.ethereum !== undefined) return false;
  Object.defineProperty(win, "ethereum", { value: provider, configurable: true, enumerable: true, writable: false });
  return true;
}
