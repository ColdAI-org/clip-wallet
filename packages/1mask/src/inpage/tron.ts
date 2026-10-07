import type { Network } from "@clip-wallet/core";
import { uuidV4 } from "../shared/bytes.js";
import type { WalletIdentity } from "../shared/config.js";
import { ProviderRpcError, RpcErrorCode, rpcError } from "../shared/errors.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { TRON_INJECTED, tronChainIdOf, tronNetworkIdOf } from "../shared/tron-methods.js";
import { Emitter } from "./emitter.js";
import { DEFAULT_GLOBAL_KEY, type InjectedOptions, exposeOnGlobal } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Injected TRON provider at `window.clipwallet.tron`, announced with TIP-6963 under the wallet's own identity.
 *
 *  - TIP-1193 "TRON Provider JavaScript API" (Final): `request({ method, params })`, events `connect` /
 *    `disconnect` / `chainChanged` / `accountsChanged` via `on` / `removeListener` (Node EventEmitter API, return
 *    `this`), errors 4001 / 4100 / 4200 / 4900 / 4901. https://github.com/tronprotocol/tips/blob/master/tip-1193.md
 *  - TIP-1102 "Opt-in account exposure" (Final): `eth_requestAccounts` → `[address]`.
 *    https://github.com/tronprotocol/tips/blob/master/tip-1102.md
 *  - TIP-3326 "Wallet Switch TRON Chain Method" (Final): `wallet_switchEthereumChain` `[{ chainId }]` → null, 4902 for
 *    an unknown chain. https://github.com/tronprotocol/tips/blob/master/tip-3326.md
 *  - `eth_chainId`: TIP-1193 / TIP-3326 take the chain id from "TRON's eth_chainId" ("0x" + last 4 bytes of the genesis
 *    block id, e.g. 0x2b6653dc); answered from the page's current chain.
 *  - TIP-6963 "Multi Injected Provider Discovery" (Final): `TIP6963:announceProvider` with a frozen
 *    `{ info: { uuid, name, icon, rdns }, provider }`, re-announced on `TIP6963:requestProvider`.
 *    https://github.com/tronprotocol/tips/blob/master/tip-6963.md
 *
 * TIP-1193 defines no signing methods: it says the provider exposes an instantiated TronWeb as `tron.tronWeb` and
 * dapps sign through it (`tronWeb.trx.sign`, `tronWeb.trx.signMessageV2`; that's also what @tronweb3/tronwallet-adapters
 * calls). Clip doesn't ship TronWeb in the page; `tronWeb` here is only the documented subset dapps use for signing:
 * `defaultAddress`, `ready`, `fullNode/solidityNode/eventServer.host`, `trx.sign(transaction)` and
 * `trx.signMessageV2(message)`. Everything else on TronWeb (building transactions, reading the chain) a dapp does with
 * its own TronWeb instance. Legacy `trx.sign(hexString)` message signing, `multiSign` and `_signTypedData` are refused
 * with 4200. The provider never takes a private key, never sets `isTronLink`, and never touches `window.tronLink`,
 * `window.tronWeb` or (unless `claimWindowTron` and nothing owns it) `window.tron`.
 */

export interface TronRequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

export interface TIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface TIP6963ProviderDetail {
  info: TIP6963ProviderInfo;
  provider: ClipTronProvider;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** "41…" hex of a base58 TRON address (checksum not re-checked: the address comes from the wallet itself). */
function hex41(address: string): string | false {
  let n = 0n;
  for (const c of address) {
    const i = B58.indexOf(c);
    if (i < 0) return false;
    n = n * 58n + BigInt(i);
  }
  const h = n.toString(16).padStart(50, "0");
  return h.startsWith("41") ? h.slice(0, 42) : false;
}

const toHex = (b: ArrayLike<number>) => Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, "0")).join("");

export class ClipTronProvider {
  readonly isClipWallet = true;
  /** The documented signing subset of TronWeb (see the file comment). */
  readonly tronWeb: ClipTronWeb;
  readonly #events = new Emitter();
  readonly #transport: InpageTransport;
  readonly #networks: Network[];
  #accounts: string[] = [];
  #chainId: string;
  #connected = false;

  constructor(networks: Network[], transport: InpageTransport) {
    this.#transport = transport;
    this.#networks = networks.filter((n) => n.family === "tron" && tronChainIdOf(n.id));
    this.#chainId = tronChainIdOf(this.#networks[0]?.id ?? "") ?? "0x00000000";
    this.tronWeb = new ClipTronWeb(this);
    transport.onEvent((family, event, data) => {
      if (family !== "tron") return;
      if (event === "accountsChanged") this.#setAccounts(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      if (event === "disconnect") {
        this.#setAccounts([]);
        if (this.#connected) {
          this.#connected = false;
          this.#events.emit("disconnect", rpcError.disconnected());
        }
      }
    });
  }

  get chainId(): string {
    return this.#chainId;
  }

  get selectedAddress(): string | undefined {
    return this.#accounts[0];
  }

  /** The current network's CAIP-2 id (what the background validates). */
  get networkId(): string {
    return `tron:${this.#chainId}`;
  }

  get rpcUrl(): string {
    return this.#networks.find((n) => n.id === this.networkId)?.rpcUrls[0] ?? "";
  }

  #setAccounts(list: ExposedAccount[]): void {
    const next = list.filter((a) => a && typeof a.address === "string").map((a) => a.address);
    const changed = next.length !== this.#accounts.length || next.some((a, i) => a !== this.#accounts[i]);
    this.#accounts = next;
    if (changed) this.#events.emit("accountsChanged", [...next]);
  }

  /** Background call on the current chain. */
  call(method: string, params?: unknown): Promise<unknown> {
    return this.#transport.request("tron", method, params, this.networkId);
  }

  async request(args: TronRequestArguments): Promise<unknown> {
    if (!args || typeof args !== "object" || typeof args.method !== "string") throw rpcError.invalidParams("Expected { method, params }.");
    switch (args.method) {
      case "eth_requestAccounts": {
        let list = (await this.call(TRON_INJECTED.accounts)) as ExposedAccount[];
        if (!Array.isArray(list) || !list.length) list = (await this.call(TRON_INJECTED.connect, {})) as ExposedAccount[];
        this.#setAccounts(Array.isArray(list) ? list : []);
        if (!this.#accounts.length) throw new ProviderRpcError(RpcErrorCode.Unauthorized, "No TRON account is available.");
        if (!this.#connected) {
          this.#connected = true;
          this.#events.emit("connect", { chainId: this.#chainId });
        }
        return [...this.#accounts];
      }
      case "eth_chainId":
        return this.#chainId;
      case "wallet_switchEthereumChain": {
        const p = Array.isArray(args.params) ? args.params[0] : args.params;
        const chainId = p && typeof p === "object" ? (p as { chainId?: unknown }).chainId : undefined;
        if (typeof chainId !== "string") throw rpcError.invalidParams("Expected [{ chainId }].");
        const id = tronNetworkIdOf(chainId);
        if (!id || !this.#networks.some((n) => n.id === id)) throw rpcError.unrecognizedChain(chainId);
        const next = tronChainIdOf(id)!;
        if (next !== this.#chainId) {
          this.#chainId = next;
          this.#events.emit("chainChanged", { chainId: next });
        }
        return null;
      }
      default:
        throw rpcError.unsupportedMethod(args.method);
    }
  }

  /** Signs a TronWeb transaction object; resolves to it with `signature` added (TronWeb `trx.sign`). */
  async signTransaction(transaction: unknown): Promise<unknown> {
    if (!transaction || typeof transaction !== "object") throw rpcError.invalidParams("Expected a TronWeb transaction object.");
    const address = this.#requireAccount();
    return this.call(TRON_INJECTED.signTransaction, { address, transaction });
  }

  /** TronWeb `trx.signMessageV2`: a string (UTF-8) or bytes; resolves to the "0x…" signature. */
  async signMessageV2(message: unknown): Promise<string> {
    const address = this.#requireAccount();
    let params: { address: string; message: string; encoding?: "hex" };
    if (typeof message === "string") params = { address, message };
    else if (message instanceof Uint8Array || (Array.isArray(message) && message.every((x) => Number.isInteger(x) && x >= 0 && x < 256))) params = { address, message: toHex(message as ArrayLike<number>), encoding: "hex" };
    else throw rpcError.invalidParams("Expected a message string or bytes.");
    const res = (await this.call(TRON_INJECTED.signMessage, params)) as { signature?: string };
    if (typeof res?.signature !== "string") throw rpcError.internal();
    return res.signature;
  }

  #requireAccount(): string {
    const a = this.#accounts[0];
    if (!a) throw rpcError.unauthorized("Connect Clip Wallet to this site first (eth_requestAccounts).");
    return a;
  }

  on(event: string, listener: (...args: any[]) => void): this {
    this.#events.on(event, listener);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this {
    this.#events.once(event, listener);
    return this;
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    this.#events.removeListener(event, listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener);
  }

  /** Not in TIP-1193: forgets this site's connection in the wallet. */
  async disconnect(): Promise<void> {
    await this.call(TRON_INJECTED.disconnect);
    this.#setAccounts([]);
  }
}

/** The signing subset of TronWeb a TIP-1193 provider exposes as `tron.tronWeb` (see the file comment). */
export class ClipTronWeb {
  readonly #p: ClipTronProvider;
  readonly trx: {
    sign(transaction: unknown, privateKey?: unknown, useTronHeader?: unknown, multisig?: unknown): Promise<unknown>;
    signMessageV2(message: unknown, privateKey?: unknown): Promise<string>;
    multiSign(): Promise<never>;
    _signTypedData(): Promise<never>;
  };

  constructor(p: ClipTronProvider) {
    this.#p = p;
    const noKeys = (k: unknown) => {
      if (k !== undefined && k !== false && k !== null) throw rpcError.invalidParams("Clip Wallet signs with its own keys; don't pass a private key.");
    };
    this.trx = Object.freeze({
      sign: async (transaction: unknown, privateKey?: unknown, _useTronHeader?: unknown, multisig?: unknown) => {
        noKeys(privateKey);
        if (typeof transaction === "string") throw new ProviderRpcError(RpcErrorCode.UnsupportedMethod, "Clip Wallet signs messages with signMessageV2 only.");
        if (multisig) throw rpcError.unsupportedMethod("multiSign");
        return p.signTransaction(transaction);
      },
      signMessageV2: async (message: unknown, privateKey?: unknown) => {
        noKeys(privateKey);
        return p.signMessageV2(message);
      },
      multiSign: async () => {
        throw rpcError.unsupportedMethod("multiSign");
      },
      _signTypedData: async () => {
        throw rpcError.unsupportedMethod("_signTypedData");
      },
    });
  }

  get ready(): boolean {
    return !!this.#p.selectedAddress;
  }

  get defaultAddress(): { base58: string | false; hex: string | false } {
    const a = this.#p.selectedAddress;
    return { base58: a ?? false, hex: a ? hex41(a) : false };
  }

  get fullNode(): { host: string } {
    return { host: this.#p.rpcUrl };
  }

  get solidityNode(): { host: string } {
    return { host: this.#p.rpcUrl };
  }

  get eventServer(): { host: string } {
    return { host: this.#p.rpcUrl };
  }
}

/** TIP-6963: announce now and on every `TIP6963:requestProvider`. One v4 uuid per page session. */
export function announceTip6963(win: Window, identity: WalletIdentity, provider: ClipTronProvider): { detail: TIP6963ProviderDetail; stop(): void } {
  const info: TIP6963ProviderInfo = Object.freeze({ uuid: uuidV4(), name: identity.name, icon: identity.icon, rdns: identity.rdns });
  const detail: TIP6963ProviderDetail = Object.freeze({ info, provider });
  const announce = () => win.dispatchEvent(new CustomEvent("TIP6963:announceProvider", { detail }));
  win.addEventListener("TIP6963:requestProvider", announce);
  announce();
  return { detail, stop: () => win.removeEventListener("TIP6963:requestProvider", announce) };
}

export interface TronInjectedOptions extends InjectedOptions {
  /**
   * Also set `window.tron` (TIP-1193's suggested global) when nothing owns it. Default false: TIP-6963 discovery and
   * `window.clipwallet.tron` only. Never overrides another wallet's `window.tron`.
   */
  claimWindowTron?: boolean;
}

export function installTronProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: TronInjectedOptions = {},
): { provider: ClipTronProvider; detail: TIP6963ProviderDetail; claimedWindowTron: boolean; stop(): void } {
  const provider = new ClipTronProvider(networks, transport);
  const unexpose = exposeOnGlobal(win, opts.globalKey ?? DEFAULT_GLOBAL_KEY, "tron", provider, identity);
  const { detail, stop } = announceTip6963(win, identity, provider);
  let claimed = false;
  const w = win as unknown as { tron?: unknown };
  if (opts.claimWindowTron && w.tron === undefined) {
    Object.defineProperty(win, "tron", { value: provider, configurable: true, enumerable: false, writable: false });
    claimed = true;
  }
  return {
    provider,
    detail,
    claimedWindowTron: claimed,
    stop: () => {
      unexpose();
      stop();
      if (claimed) delete (win as unknown as { tron?: unknown }).tron;
    },
  };
}
