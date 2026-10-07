import type { WalletIdentity } from "../shared/config.js";
import { RpcErrorCode, rpcError } from "../shared/errors.js";
import { FUEL_INJECTED, type FuelConnectorNetwork, type FuelWireMessage } from "../shared/fuel.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { Emitter } from "./emitter.js";
import { DEFAULT_GLOBAL_KEY, exposeOnGlobal, type InjectedOptions } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Fuel connector (the Fuel connector standard: fuels-ts `FuelConnector`, packages/account/src/connectors/
 * fuel-connector.ts and fuel.ts in github.com/FuelLabs/fuels-ts, v0.103). Dependency-free: fuels-ts is never bundled
 * into the page; transactions cross to the background as plain JSON.
 *
 * Discovery (fuels-ts connectors/utils/dispatch-fuel-connector-event.ts and `Fuel.setupConnectorListener`): a wallet
 * announces itself with `window.dispatchEvent(new CustomEvent("FuelConnector", { detail: connector }))`; every `Fuel`
 * instance listening on window adds it (`Fuel.addConnector`), pings it, and selects it if none is selected. Fuel Wallet's
 * own connector (FuelLabs/fuel-connectors packages/fuel-wallet, FuelWalletConnector.setupConnector) dispatches the same
 * event once its ping succeeds. Since a `Fuel` created later misses an early event, this connector announces on
 * install, on DOMContentLoaded and on load, and is also at `window.clipwallet.fuel` so a dapp can pass it in
 * `new Fuel({ connectors: [window.clipwallet.fuel] })`. It announces the wallet's own name and icon (AGENTS rule 8),
 * never "Fuel Wallet".
 *
 * What `Fuel` and `Account` use from a connector (checked in fuels-ts source): name, metadata, installed/connected
 * (Fuel writes them, so the object stays extensible), on/off (Fuel.setupConnectorEvents), ping, isConnected, the
 * FuelConnectorMethods it proxies, and `sendTransaction(address, request, params)` whose string result Account turns
 * into a TransactionResponse with provider.getTransactionResponse(id). The request is a fuels-ts TransactionRequest
 * instance: `JSON.stringify` gives the same JSON Fuel Wallet's connector sends (BN → 0x-hex, bytes → 0x-hex).
 */

/** fuels-ts FuelConnectorEventTypes (connectors/types/connector-types.ts). */
export const FUEL_CONNECTOR_EVENTS = {
  connectors: "connectors",
  currentConnector: "currentConnector",
  connection: "connection",
  accounts: "accounts",
  currentAccount: "currentAccount",
  networks: "networks",
  currentNetwork: "currentNetwork",
  assets: "assets",
  abis: "abis",
  consolidateCoins: "consolidateCoins",
} as const;

/** The window event wallets announce with (fuels-ts `FuelConnectorEventType`). */
export const FUEL_CONNECTOR_EVENT = "FuelConnector";

type Hashable = string | { personalSign: string | Uint8Array | ArrayLike<number> };

const toHex = (b: ArrayLike<number>) => `0x${Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, "0")).join("")}`;

/** HashableMessage (fuels-ts @fuel-ts/hasher) → the wire form. Bytes can't cross JSON, so they go as hex. */
export function fuelWireMessage(m: unknown): FuelWireMessage {
  if (typeof m === "string") {
    if (!m.trim()) throw rpcError.invalidParams("Message is required.");
    return { text: m };
  }
  const p = m && typeof m === "object" ? (m as { personalSign?: unknown }).personalSign : undefined;
  if (typeof p === "string") {
    if (!p) throw rpcError.invalidParams("Message is required.");
    return { personalSign: p };
  }
  if (p instanceof Uint8Array || (Array.isArray(p) && p.every((x) => Number.isInteger(x) && x >= 0 && x < 256))) {
    if (!(p as ArrayLike<number>).length) throw rpcError.invalidParams("Message is required.");
    return { personalSignHex: toHex(p as ArrayLike<number>) };
  }
  throw rpcError.invalidParams("Expected a message string or { personalSign }.");
}

/** A TransactionRequest (instance or JSON) → plain JSON, as Fuel Wallet's connector sends it. */
function plainTransaction(tx: unknown): unknown {
  if (!tx || (typeof tx !== "object" && typeof tx !== "string")) throw rpcError.invalidParams("Transaction is required.");
  if (typeof tx === "string") return tx;
  return JSON.parse(JSON.stringify(tx));
}

interface SendTxParams {
  onBeforeSend?: (req: unknown) => Promise<unknown>;
  provider?: { url?: string };
}

export interface FuelConnectorOptions extends InjectedOptions {
  /** metadata.install.link: where people get this wallet (shown by pickers only when it isn't installed). */
  installLink?: string;
  /** Announce on DOMContentLoaded and load too (default true). */
  reannounce?: boolean;
}

export class ClipFuelConnector {
  readonly isClipWallet = true;
  name: string;
  metadata: { image: string; install: { action: string; link: string; description: string } };
  connected = false;
  installed = true;
  external = true;
  events = FUEL_CONNECTOR_EVENTS;
  readonly #events = new Emitter();
  readonly #transport: InpageTransport;
  #accounts: string[] = [];

  constructor(identity: WalletIdentity, transport: InpageTransport, opts: FuelConnectorOptions = {}) {
    this.name = identity.name;
    this.metadata = {
      image: identity.icon,
      install: { action: "Install", link: opts.installLink ?? "", description: `Install ${identity.name} to connect it.` },
    };
    this.#transport = transport;
    transport.onEvent((family, event, data) => {
      if (family !== "fuel") return;
      if (event === "accountsChanged") this.#setAccounts(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      else if (event === "disconnect") this.#setAccounts([]);
      else if (event === "chainChanged" && data && typeof data === "object") this.#emit(FUEL_CONNECTOR_EVENTS.currentNetwork, data);
    });
  }

  #request(method: string, params?: unknown): Promise<unknown> {
    return this.#transport.request("fuel", method, params);
  }

  #emit(event: string, ...args: unknown[]) {
    try {
      this.#events.emit(event, ...args);
    } catch {
      /* a dapp listener throwing must not break the connector */
    }
  }

  #setAccounts(list: ExposedAccount[]) {
    const next = list.filter((a) => a && typeof a.address === "string").map((a) => a.address);
    const changed = next.length !== this.#accounts.length || next.some((a, i) => a !== this.#accounts[i]);
    const wasConnected = this.connected;
    this.#accounts = next;
    this.connected = next.length > 0;
    if (changed) {
      this.#emit(FUEL_CONNECTOR_EVENTS.accounts, [...next]);
      this.#emit(FUEL_CONNECTOR_EVENTS.currentAccount, next[0] ?? null);
    }
    if (wasConnected !== this.connected) this.#emit(FUEL_CONNECTOR_EVENTS.connection, this.connected);
  }

  async #silentAccounts(): Promise<string[]> {
    const list = (await this.#request(FUEL_INJECTED.accounts)) as ExposedAccount[];
    this.#setAccounts(Array.isArray(list) ? list : []);
    return [...this.#accounts];
  }

  /* ---------------------------------------------------------------- EventEmitter surface (Fuel uses on/off) */

  on(event: string, listener: (...args: any[]) => void): this {
    this.#events.on(event, listener);
    return this;
  }
  addListener(event: string, listener: (...args: any[]) => void): this {
    return this.on(event, listener);
  }
  once(event: string, listener: (...args: any[]) => void): this {
    this.#events.once(event, listener);
    return this;
  }
  off(event: string, listener: (...args: any[]) => void): this {
    this.#events.removeListener(event, listener);
    return this;
  }
  removeListener(event: string, listener: (...args: any[]) => void): this {
    return this.off(event, listener);
  }
  removeAllListeners(event?: string): this {
    this.#events.removeAllListeners(event);
    return this;
  }
  listenerCount(event: string): number {
    return this.#events.listenerCount(event);
  }
  emit(event: string, ...args: unknown[]): boolean {
    this.#emit(event, ...args);
    return true;
  }
  setMaxListeners(_n: number): this {
    return this;
  }

  /* ---------------------------------------------------------------- FuelConnector methods */

  /** Answered in the page: the connector is here, so it's alive. */
  async ping(): Promise<boolean> {
    return true;
  }

  async version(): Promise<{ app: string; network: string }> {
    return { app: "1.0.0", network: ">=0.48.0" };
  }

  async isConnected(): Promise<boolean> {
    try {
      return (await this.#silentAccounts()).length > 0;
    } catch {
      return false;
    }
  }

  async accounts(): Promise<string[]> {
    return this.#silentAccounts();
  }

  async currentAccount(): Promise<string | null> {
    return (await this.#silentAccounts())[0] ?? null;
  }

  /** True once the person approves; false when they decline (FuelConnector.connect contract). */
  async connect(): Promise<boolean> {
    try {
      const list = (await this.#request(FUEL_INJECTED.connect, {})) as ExposedAccount[];
      this.#setAccounts(Array.isArray(list) ? list : []);
      return this.connected;
    } catch (e) {
      if ((e as { code?: number })?.code === RpcErrorCode.UserRejected) return false;
      throw e;
    }
  }

  /** Returns the connection status after disconnecting (false). */
  async disconnect(): Promise<boolean> {
    await this.#request(FUEL_INJECTED.disconnect);
    this.#setAccounts([]);
    return false;
  }

  async signMessage(address: string, message: Hashable): Promise<string> {
    return (await this.#request(FUEL_INJECTED.signMessage, { address, message: fuelWireMessage(message) })) as string;
  }

  async #tx(method: string, address: string, transaction: unknown, params?: SendTxParams): Promise<unknown> {
    let tx = transaction;
    if (params?.onBeforeSend) tx = await params.onBeforeSend(tx);
    const url = params?.provider?.url;
    return this.#request(method, { address, transaction: plainTransaction(tx), ...(typeof url === "string" ? { provider: { url } } : {}) });
  }

  /** Signs and submits; resolves with the transaction id (Account turns it into a TransactionResponse). */
  async sendTransaction(address: string, transaction: unknown, params?: SendTxParams): Promise<string> {
    return (await this.#tx(FUEL_INJECTED.sendTransaction, address, transaction, params)) as string;
  }

  /** Signs only; resolves with the signed TransactionRequest as JSON (`transactionRequestify` reads it), like Fuel Wallet. */
  async signTransaction(address: string, transaction: unknown, params?: SendTxParams): Promise<unknown> {
    return this.#tx(FUEL_INJECTED.signTransaction, address, transaction, params);
  }

  async currentNetwork(): Promise<FuelConnectorNetwork> {
    return (await this.#request(FUEL_INJECTED.currentNetwork)) as FuelConnectorNetwork;
  }

  async networks(): Promise<FuelConnectorNetwork[]> {
    return (await this.#request(FUEL_INJECTED.networks)) as FuelConnectorNetwork[];
  }

  async selectNetwork(network: { chainId?: number; url?: string }): Promise<boolean> {
    return (await this.#request(FUEL_INJECTED.selectNetwork, { chainId: network?.chainId, url: network?.url })) as boolean;
  }

  /** Only the networks the wallet ships with. */
  async addNetwork(_networkUrl: string): Promise<boolean> {
    throw rpcError.userRejected(`${this.name} only connects to the networks it ships with.`);
  }

  /** The wallet's token list is curated; a site can't add to it. */
  async assets(): Promise<unknown[]> {
    return [];
  }
  async addAsset(_asset: unknown): Promise<boolean> {
    return false;
  }
  async addAssets(_assets: unknown[]): Promise<boolean> {
    return false;
  }

  /** ABIs aren't used: transactions are explained from their coin flows and a dry run. */
  async addABI(_contractId: string, _abi: unknown): Promise<boolean> {
    return false;
  }
  async getABI(_contractId: string): Promise<null> {
    return null;
  }
  async hasABI(_contractId: string): Promise<boolean> {
    return false;
  }

  async startConsolidation(_opts: unknown): Promise<void> {
    throw rpcError.unsupportedMethod("startConsolidation");
  }
}

/** Installs the connector at window[globalKey].fuel and announces it with the FuelConnector event. */
export function installFuelConnector(
  win: Window,
  identity: WalletIdentity,
  transport: InpageTransport,
  opts: FuelConnectorOptions = {},
): { connector: ClipFuelConnector; announce(): void; stop(): void } {
  const connector = new ClipFuelConnector(identity, transport, opts);
  const unexpose = exposeOnGlobal(win, opts.globalKey ?? DEFAULT_GLOBAL_KEY, "fuel", connector, identity);
  const announce = () => {
    try {
      win.dispatchEvent(new (win as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent(FUEL_CONNECTOR_EVENT, { detail: connector }));
    } catch {
      /* no CustomEvent: the global is still there */
    }
  };
  announce();
  const again = () => announce();
  const reannounce = opts.reannounce !== false;
  if (reannounce) {
    win.addEventListener("DOMContentLoaded", again, { once: true });
    win.addEventListener("load", again, { once: true });
  }
  return {
    connector,
    announce,
    stop: () => {
      unexpose();
      if (reannounce) {
        win.removeEventListener("DOMContentLoaded", again);
        win.removeEventListener("load", again);
      }
    },
  };
}
