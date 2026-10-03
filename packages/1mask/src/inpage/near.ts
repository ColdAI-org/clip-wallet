import type { Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import { bytesToBase64, hexToBytes } from "../shared/bytes.js";
import { rpcError } from "../shared/errors.js";
import { NEAR_INJECTED } from "../shared/p2-methods.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { DEFAULT_GLOBAL_KEY, InjectedFamilyBase, base58Encode, exposeOnGlobal, type InjectedOptions } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Injected NEAR provider at `window.clipwallet.near`. Its shape follows what NEAR Wallet Selector's
 * injected-wallet modules call (signIn/signOut/getAccounts/signAndSendTransaction(s)/signMessage), so
 * @clip-wallet/kit-modules/near maps 1:1 onto it. Actions travel as JSON (wallet-selector
 * `InternalAction` shape; bytes as `argsBase64` / `codeBase64`).
 */

export interface NearAccount {
  accountId: string;
  /** "ed25519:<base58>" as NEAR tooling prints it. */
  publicKey?: string;
}

export type NearNetworkId = "mainnet" | "testnet";

export interface NearActionJson {
  type: string;
  params?: Record<string, unknown>;
}

export interface NearTransactionJson {
  signerId?: string;
  receiverId: string;
  actions: NearActionJson[];
}

export interface NearSignMessageInput {
  message: string;
  recipient: string;
  /** 32 bytes (NEP-413). */
  nonce: Uint8Array | string;
  callbackUrl?: string;
  state?: string;
}

export interface NearSignedMessage {
  accountId: string;
  publicKey: string;
  /** Base64 ed25519 signature. */
  signature: string;
  state?: string;
}

const toNearKey = (hex?: string): string | undefined => {
  if (!hex) return undefined;
  try {
    return `ed25519:${base58Encode(hexToBytes(hex))}`;
  } catch {
    return undefined;
  }
};

export class ClipNearProvider extends InjectedFamilyBase {
  readonly isClipWallet = true;
  readonly name: string;
  readonly icon: string;
  readonly #networks: Set<string>;
  #networkId: NearNetworkId | undefined;

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    super("near", transport);
    this.name = identity.name;
    this.icon = identity.icon;
    this.#networks = new Set(networks.filter((n) => n.family === "near").map((n) => n.id));
  }

  /** Networks this wallet can serve ("testnet", "mainnet"). */
  get supportedNetworks(): NearNetworkId[] {
    return [...this.#networks].map((id) => id.slice("near:".length) as NearNetworkId);
  }

  get accounts(): NearAccount[] {
    return this.publicAccounts();
  }

  protected override publicAccounts(): NearAccount[] {
    return this.accountsCache.map((a) => {
      const out: NearAccount = { accountId: a.address };
      const key = toNearKey(a.publicKey);
      if (key) out.publicKey = key;
      return out;
    });
  }

  #chain(networkId?: string): string | undefined {
    const id = networkId ?? this.#networkId;
    if (!id) return undefined;
    const chain = `near:${id}`;
    if (!this.#networks.has(chain)) throw rpcError.chainDisconnected(`Clip Wallet doesn't support NEAR ${id}.`);
    return chain;
  }

  /** wallet-selector `signIn`. `contractId`/`methodNames` are accepted but Clip never adds a function-call key. */
  async signIn(input: { networkId?: NearNetworkId; contractId?: string; methodNames?: string[] } = {}): Promise<NearAccount[]> {
    const chain = this.#chain(input.networkId);
    if (input.networkId) this.#networkId = input.networkId;
    const res = await this.request(NEAR_INJECTED.connect, { contractId: input.contractId, methodNames: input.methodNames }, chain);
    this.setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []);
    return this.publicAccounts();
  }

  /** Silent: accounts already granted to this site, no prompt. */
  async getAccounts(): Promise<NearAccount[]> {
    const res = await this.request(NEAR_INJECTED.accounts);
    this.setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []);
    return this.publicAccounts();
  }

  async signOut(): Promise<void> {
    await this.request(NEAR_INJECTED.disconnect);
    this.setAccounts([]);
  }

  #signerOk(signerId?: string) {
    if (signerId !== undefined && !this.accountsCache.some((a) => a.address === signerId)) {
      throw rpcError.unauthorized(`${signerId} is not connected to this site.`);
    }
  }

  async signAndSendTransaction(tx: NearTransactionJson & { networkId?: NearNetworkId }): Promise<unknown> {
    if (!tx || typeof tx.receiverId !== "string" || !Array.isArray(tx.actions)) throw rpcError.invalidParams("Expected { receiverId, actions }.");
    this.#signerOk(tx.signerId);
    const { networkId, ...rest } = tx;
    return this.request(NEAR_INJECTED.signAndSendTransaction, rest, this.#chain(networkId));
  }

  async signAndSendTransactions(input: { transactions: NearTransactionJson[]; networkId?: NearNetworkId }): Promise<unknown[]> {
    if (!input || !Array.isArray(input.transactions) || input.transactions.length === 0) throw rpcError.invalidParams("Expected { transactions: [...] }.");
    for (const t of input.transactions) this.#signerOk(t.signerId);
    const res = await this.request(NEAR_INJECTED.signAndSendTransactions, { transactions: input.transactions }, this.#chain(input.networkId));
    return Array.isArray(res) ? res : [res];
  }

  /** NEP-413. */
  async signMessage(input: NearSignMessageInput & { networkId?: NearNetworkId }): Promise<NearSignedMessage> {
    if (!input || typeof input.message !== "string" || typeof input.recipient !== "string") throw rpcError.invalidParams("Expected { message, recipient, nonce }.");
    const nonce = typeof input.nonce === "string" ? input.nonce : bytesToBase64(input.nonce);
    const params: Record<string, unknown> = { message: input.message, recipient: input.recipient, nonce };
    if (input.callbackUrl !== undefined) params.callbackUrl = input.callbackUrl;
    if (input.state !== undefined) params.state = input.state;
    return (await this.request(NEAR_INJECTED.signMessage, params, this.#chain(input.networkId))) as NearSignedMessage;
  }
}

/* ------------------------------------------------------------------ NEAR Connect (injected discovery) */

/**
 * NEAR Connect (github.com/azbang/near-connect, @hot-labs/near-connect; recommended by the NEAR Infra
 * Committee over Wallet Selector) discovers injected wallets EIP-6963-style: it dispatches
 * "near-selector-ready" and listens for a "near-wallet-injected" CustomEvent whose detail implements
 * `NearWalletBase` (src/types/index.ts). Actions arrive as its `ConnectorAction` objects (wallet-selector
 * InternalAction shape, bytes as Uint8Array), converted to the wire JSON here.
 */
export function connectorActionToWire(action: unknown): NearActionJson {
  const a = action as { type?: unknown; params?: Record<string, unknown> };
  if (typeof a?.type !== "string") throw rpcError.invalidParams("Expected NEAR Connect actions ({ type, params }).");
  const params = { ...(a.params ?? {}) };
  for (const [from, to] of [["args", "argsBase64"], ["code", "codeBase64"]] as const) {
    const v = params[from];
    if (v instanceof Uint8Array) {
      delete params[from];
      params[to] = bytesToBase64(v);
    }
  }
  for (const k of ["gas", "deposit", "stake", "allowance"]) if (typeof params[k] === "bigint") params[k] = String(params[k]);
  return Object.keys(params).length ? { type: a.type, params } : { type: a.type };
}

export function nearConnectWallet(provider: ClipNearProvider, identity: WalletIdentity) {
  const nets = provider.supportedNetworks;
  const toWire = (actions: unknown[]) => actions.map(connectorActionToWire);
  return {
    manifest: {
      id: identity.rdns,
      platform: [] as string[],
      name: identity.name,
      icon: identity.icon,
      description: "Non-custodial wallet for every CLPR network.",
      website: "https://coldai.org/clip-wallet",
      version: "1.0.0",
      executor: "",
      type: "injected" as const,
      permissions: {},
      features: {
        signMessage: true,
        signTransaction: false,
        signAndSendTransaction: true,
        signAndSendTransactions: true,
        signInWithoutAddKey: true,
        signInAndSignMessage: true,
        signInWithFunctionCallKey: false,
        signDelegateActions: false,
        mainnet: nets.includes("mainnet"),
        testnet: nets.includes("testnet"),
      },
    },
    signIn: (d?: { network?: NearNetworkId }) => provider.signIn(d?.network ? { networkId: d.network } : {}),
    async signInAndSignMessage(d: { network?: NearNetworkId; messageParams: { message: string; recipient: string; nonce: Uint8Array } }) {
      const accounts = await provider.signIn(d?.network ? { networkId: d.network } : {});
      const signed = await provider.signMessage({ ...d.messageParams, ...(d.network ? { networkId: d.network } : {}) });
      return accounts.map((a) => ({ ...a, signedMessage: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature } }));
    },
    signOut: () => provider.signOut(),
    getAccounts: () => provider.getAccounts(),
    signAndSendTransaction: (p: { network?: NearNetworkId; signerId?: string; receiverId: string; actions: unknown[] }) =>
      provider.signAndSendTransaction({
        receiverId: p.receiverId,
        actions: toWire(p.actions),
        ...(p.signerId ? { signerId: p.signerId } : {}),
        ...(p.network ? { networkId: p.network } : {}),
      }),
    signAndSendTransactions: (p: { network?: NearNetworkId; signerId?: string; transactions: { receiverId: string; actions: unknown[] }[] }) =>
      provider.signAndSendTransactions({
        transactions: p.transactions.map((t) => ({ receiverId: t.receiverId, actions: toWire(t.actions), ...(p.signerId ? { signerId: p.signerId } : {}) })),
        ...(p.network ? { networkId: p.network } : {}),
      }),
    async signMessage(p: { message: string; recipient: string; nonce: Uint8Array; network?: NearNetworkId }) {
      const s = await provider.signMessage({ message: p.message, recipient: p.recipient, nonce: p.nonce, ...(p.network ? { networkId: p.network } : {}) });
      return { accountId: s.accountId, publicKey: s.publicKey, signature: s.signature };
    },
    async signDelegateActions(): Promise<never> {
      throw rpcError.unsupportedMethod("signDelegateActions");
    },
  };
}

/** Announces the wallet to NEAR Connect now and whenever a connector says it's ready. */
export function announceNearConnect(win: Window, wallet: ReturnType<typeof nearConnectWallet>): () => void {
  const announce = () => win.dispatchEvent(new CustomEvent("near-wallet-injected", { detail: wallet }));
  win.addEventListener("near-selector-ready", announce);
  announce();
  return () => win.removeEventListener("near-selector-ready", announce);
}

export function installNearProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions = {},
): { provider: ClipNearProvider; stop(): void } {
  const provider = new ClipNearProvider(identity, networks, transport);
  const unexpose = exposeOnGlobal(win, opts.globalKey ?? DEFAULT_GLOBAL_KEY, "near", provider, identity);
  const unannounce = announceNearConnect(win, nearConnectWallet(provider, identity));
  return { provider, stop: () => (unexpose(), unannounce()) };
}
