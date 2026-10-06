import type { Network } from "@clip-wallet/core";
import { hexToBytes } from "../shared/bytes.js";
import type { WalletIdentity } from "../shared/config.js";
import { ProviderRpcError, RpcErrorCode, rpcError } from "../shared/errors.js";
import { MULTIVERSX_INJECTED, multiversxNetworkIdOf } from "../shared/multiversx-methods.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { DEFAULT_GLOBAL_KEY, type InjectedOptions, exposeOnGlobal } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * MultiversX provider: BEST EFFORT, through an UNDOCUMENTED hook.
 *
 * MultiversX has no wallet-discovery standard for browser extensions. @multiversx/sdk-dapp 5.x's `initApp` merges
 * `window.multiversx?.providers` with the dapp's own `customProviders` (deduplicated by `type`) into
 * `ProviderFactory.customProviders` (out/methods/initApp/initApp.mjs, 5.7.3), and `ProviderFactory.create({ type })`
 * calls the matching entry's `constructor({ address, anchor })`, then `provider.init()`
 * (out/providers/ProviderFactory.mjs). The entry shape is `ICustomProvider` { name, type, iconUrl?, constructor }
 * (out/providers/types/providerFactory.types.d.ts). sdk-dapp's README presents `window.multiversx.providers` as
 * something the DAPP sets; nothing documents it as a channel for wallets. So this works only on sdk-dapp dapps
 * that call initApp after the page script ran and don't replace `window.multiversx` (MultiversX's template dapp does
 * replace it), and only for as long as sdk-dapp keeps reading it.
 *
 * Identity: the entry is listed under the wallet's own name, icon and type (the global key, "clipwallet"), never as
 * "extension" or the MultiversX DeFi Wallet. Nothing here answers the DeFi Wallet's `erdw-*` postMessage protocol
 * or sets `window.elrondWallet` / `window.multiversxWallet`.
 *
 * The provider implements sdk-dapp's `IProvider` (init, login, logout, getType, getAddress, plus sdk-dapp-utils 3.1
 * IDAppProviderBase: getAccount, setAccount, isInitialized, isConnected, signTransaction(s), signMessage).
 *  - Transactions arrive as the dapp's sdk-core `Transaction` objects. They're read duck-typed (`toPlainObject()`),
 *    sent as plain JSON, and the same objects come back with `signature` set (guardian fields untouched).
 *    mx-sdk-js-extension-provider returns `Transaction.newFromPlainObject(...)` copies instead; sdk-dapp only reads
 *    the returned objects (signTransactionsWithProvider), so mutating its own instances is equivalent and needs no
 *    sdk-core in the page.
 *  - `login({ token })` connects, then signs `address + token` as a MultiversX message (sdk-core MessageComputer).
 *    That is what sdk-native-auth-server checks: `signedMessage = \`${decoded.address}${decoded.body}\`` verified over
 *    `MessageComputer.computeBytesForSigning(new Message({ address, data }))`
 *    (mx-sdk-js-native-auth-server src/native.auth.server.ts `validate` / `verifySignature`), with `body` the login
 *    token sdk-dapp passed in (sdk-native-auth-client `getToken(address, token, signature)`). The background refuses a
 *    token whose origin isn't this site.
 */

export const MULTIVERSX_DEFAULT_TYPE = DEFAULT_GLOBAL_KEY;

/** What sdk-dapp's ProviderFactory reads from `window.multiversx.providers` (ICustomProvider). */
export interface MultiversXProviderEntry {
  readonly name: string;
  readonly type: string;
  readonly iconUrl?: string;
  constructor: (options?: { address?: string; anchor?: unknown }) => Promise<ClipMultiversXProvider>;
}

/** The parts of an sdk-core Transaction this provider uses. */
interface TransactionLike {
  toPlainObject(): Record<string, unknown>;
  signature?: Uint8Array;
}

/** The parts of an sdk-core Message this provider uses. */
interface MessageLike {
  data: Uint8Array;
  signature?: Uint8Array;
  address?: unknown;
  signer?: string;
}

const bytesOf = (h: unknown): Uint8Array => {
  if (typeof h !== "string" || !/^[0-9a-f]{128}$/i.test(h)) throw rpcError.internal("The wallet returned no signature.");
  return hexToBytes(h);
};

export class ClipMultiversXProvider {
  readonly isClipWallet = true;
  readonly #transport: InpageTransport;
  readonly #type: string;
  readonly #name: string;
  readonly #defaultNetwork: string;
  #account: { address: string } = { address: "" };
  #initialized = false;

  constructor(networks: Network[], transport: InpageTransport, type: string, name: string) {
    this.#transport = transport;
    this.#type = type;
    this.#name = name;
    this.#defaultNetwork = networks.find((n) => n.family === "multiversx")?.id ?? "mvx:D";
    transport.onEvent((family, event, data) => {
      if (family !== "multiversx") return;
      if (event === "disconnect") this.#account = { address: "" };
      if (event === "accountsChanged") {
        const list = Array.isArray(data) ? (data as ExposedAccount[]) : [];
        if (!list.some((a) => a?.address === this.#account.address)) this.#account = { address: list[0]?.address ?? "" };
      }
    });
  }

  #call(method: string, params: unknown, chain = this.#defaultNetwork): Promise<unknown> {
    return this.#transport.request("multiversx", method, params, chain);
  }

  async init(): Promise<boolean> {
    this.#initialized = true;
    return true;
  }

  isInitialized(): boolean {
    return this.#initialized;
  }

  isConnected(): boolean {
    return !!this.#account.address;
  }

  getType(): string {
    return this.#type;
  }

  async getAddress(): Promise<string | undefined> {
    return this.#account.address || undefined;
  }

  getAccount(): { address: string } | null {
    return this.#account.address ? { ...this.#account } : null;
  }

  setAccount(account: { address?: string } | null | undefined): void {
    this.#account = { address: typeof account?.address === "string" ? account.address : "" };
  }

  /** Connects (approval on first use per site); with a native-auth `token`, also signs `address + token`. */
  async login(options: { token?: string; callbackUrl?: string } = {}): Promise<{ address: string; signature: string }> {
    let list = (await this.#call(MULTIVERSX_INJECTED.accounts, undefined)) as ExposedAccount[];
    if (!Array.isArray(list) || !list.length) list = (await this.#call(MULTIVERSX_INJECTED.connect, {})) as ExposedAccount[];
    const address = Array.isArray(list) ? list[0]?.address : undefined;
    if (!address) throw new ProviderRpcError(RpcErrorCode.Unauthorized, "No MultiversX account is available.");
    this.#account = { address };
    if (!options.token) return { address, signature: "" };
    const r = (await this.#call(MULTIVERSX_INJECTED.signMessage, { message: `${address}${options.token}`, address })) as { signature?: unknown };
    bytesOf(r?.signature);
    return { address, signature: String(r.signature) };
  }

  async logout(): Promise<boolean> {
    try {
      await this.#call(MULTIVERSX_INJECTED.disconnect, undefined);
    } finally {
      this.#account = { address: "" };
    }
    return true;
  }

  cancelLogin(): void {
    /* the approval window has its own cancel */
  }

  #ensureConnected(): string {
    if (!this.#account.address) throw rpcError.unauthorized("Connect first.");
    return this.#account.address;
  }

  async signTransaction<T extends TransactionLike>(transaction: T): Promise<T> {
    const [signed] = await this.signTransactions([transaction]);
    if (!signed) throw rpcError.internal("The wallet returned no signature.");
    return signed;
  }

  async signTransactions<T extends TransactionLike>(transactions: T[]): Promise<T[]> {
    const address = this.#ensureConnected();
    if (!Array.isArray(transactions) || !transactions.length) throw rpcError.invalidParams("Expected a list of transactions.");
    const plain = transactions.map((t) => {
      if (!t || typeof t.toPlainObject !== "function") throw rpcError.invalidParams("Expected MultiversX Transaction objects.");
      // JSON round trip: only plain data crosses to the background.
      return JSON.parse(JSON.stringify(t.toPlainObject())) as Record<string, unknown>;
    });
    const chains = new Set(plain.map((p) => multiversxNetworkIdOf(p.chainID)));
    if (chains.size !== 1 || chains.has(null)) throw rpcError.invalidParams("All transactions must name the same MultiversX chain.");
    const r = (await this.#call(MULTIVERSX_INJECTED.signTransactions, { transactions: plain, address }, [...chains][0]!)) as { signatures?: { signature?: unknown }[] };
    const sigs = Array.isArray(r?.signatures) ? r.signatures : [];
    if (sigs.length !== transactions.length) throw rpcError.internal("The wallet returned the wrong number of signatures.");
    transactions.forEach((t, i) => {
      t.signature = bytesOf(sigs[i]?.signature);
    });
    return transactions;
  }

  async signMessage<M extends MessageLike>(message: M): Promise<M> {
    const address = this.#ensureConnected();
    if (!message || !(message.data instanceof Uint8Array)) throw rpcError.invalidParams("Expected a MultiversX Message.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(message.data);
    } catch {
      throw rpcError.invalidParams("Clip Wallet signs text messages only.");
    }
    const r = (await this.#call(MULTIVERSX_INJECTED.signMessage, { message: text, address })) as { signature?: unknown };
    message.signature = bytesOf(r?.signature);
    message.signer = this.#name;
    return message;
  }
}

/**
 * Adds the wallet's entry to `window.multiversx.providers` (creating the object/array only if absent; other wallets'
 * entries and the array itself are kept) and exposes the provider at `window[globalKey].multiversx`.
 */
export function installMultiversXProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions = {},
): { provider: ClipMultiversXProvider; entry: MultiversXProviderEntry; stop(): void } {
  const type = opts.globalKey ?? DEFAULT_GLOBAL_KEY;
  const provider = new ClipMultiversXProvider(networks, transport, type, identity.name);
  const entry: MultiversXProviderEntry = Object.freeze({
    name: identity.name,
    type,
    iconUrl: identity.icon,
    // sdk-dapp passes the address it stored at login (session restore); the background still checks every signer.
    constructor: async (options?: { address?: string }) => {
      if (options?.address && !provider.isConnected()) provider.setAccount({ address: options.address });
      return provider;
    },
  });
  const w = win as unknown as { multiversx?: { providers?: unknown } };
  if (!w.multiversx || typeof w.multiversx !== "object") w.multiversx = {};
  if (!Array.isArray(w.multiversx.providers)) w.multiversx.providers = [];
  const list = w.multiversx.providers as unknown[];
  if (!list.some((e) => (e as { type?: unknown })?.type === type)) list.push(entry);
  const unexpose = exposeOnGlobal(win, type, "multiversx", provider, identity);
  return {
    provider,
    entry,
    stop: () => {
      unexpose();
      const now = (win as unknown as { multiversx?: { providers?: unknown } }).multiversx?.providers;
      if (Array.isArray(now)) {
        const i = now.indexOf(entry);
        if (i >= 0) now.splice(i, 1);
      }
    },
  };
}
