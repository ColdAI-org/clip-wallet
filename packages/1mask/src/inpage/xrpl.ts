import type { Network } from "@clip-wallet/core";
import type { IdentifierArray, Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardConnectInput,
  type StandardConnectOutput,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import { registerWallet } from "@wallet-standard/wallet";
import type { WalletIdentity } from "../shared/config.js";
import { rpcError } from "../shared/errors.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { XRPL_INJECTED, XRPL_SIGN_AND_SUBMIT_TRANSACTION, XRPL_SIGN_TRANSACTION, xrplChainId } from "../shared/xrpl.js";
import { DEFAULT_GLOBAL_KEY, type InjectedOptions, exposeOnGlobal } from "./injected-base.js";
import { StandardWalletBase } from "./standard-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * XLS-72d XRPL wallet on Wallet Standard (see ../shared/xrpl.ts for the spec links). Types are written out here
 * from @xrpl-wallet-standard/core 0.1.4 instead of importing it: that package pulls in xrpl.js and an alpha
 * Xahau fork just for transaction types. The wallet registers under the kit wallet's own name and icon
 * (`registerWallet`), so dapps list it as itself; it never claims to be GemWallet, Crossmark or Xaman.
 */

export interface XrplSignTransactionInput {
  tx_json: Record<string, unknown>;
  account: WalletAccount;
  /** `xrpl:<NetworkID>` or an alias (`xrpl:testnet`). */
  network: string;
  options?: { autofill?: boolean; multisig?: boolean };
}
export interface XrplSignTransactionOutput {
  signed_tx_blob: string;
}
export interface XrplSignAndSubmitTransactionOutput {
  tx_hash: string;
  tx_json: Record<string, unknown>;
}

export type XrplSignTransactionFeature = {
  [XRPL_SIGN_TRANSACTION]: { version: "1.0.0"; signTransaction(input: XrplSignTransactionInput): Promise<XrplSignTransactionOutput> };
};
export type XrplSignAndSubmitTransactionFeature = {
  [XRPL_SIGN_AND_SUBMIT_TRANSACTION]: { version: "1.0.0"; signAndSubmitTransaction(input: XrplSignTransactionInput): Promise<XrplSignAndSubmitTransactionOutput> };
};

export type ClipXrplFeatures = StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & XrplSignTransactionFeature & XrplSignAndSubmitTransactionFeature;

/** @xrpl-wallet-standard/core REQUIRED_FEATURES, plus standard:disconnect. */
export const XRPL_FEATURES = [StandardConnect, StandardDisconnect, StandardEvents, XRPL_SIGN_TRANSACTION, XRPL_SIGN_AND_SUBMIT_TRANSACTION] as const;

/** The registry's XRPL networks as XLS-72d chains (their CAIP-2 ids already are: "xrpl:0", "xrpl:1", "xrpl:2"). */
export function xrplChains(networks: Network[]): `xrpl:${string}`[] {
  return networks.filter((n) => n.family === "xrpl" && /^xrpl:\d+$/.test(n.id)).map((n) => n.id as `xrpl:${string}`);
}

export class ClipXrplWallet extends StandardWalletBase {
  protected readonly family = "xrpl" as const;
  protected readonly accountFeatures: IdentifierArray = [XRPL_SIGN_TRANSACTION, XRPL_SIGN_AND_SUBMIT_TRANSACTION];

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    super(identity, xrplChains(networks), transport);
    this.listen();
  }

  get features(): ClipXrplFeatures {
    return {
      [StandardConnect]: { version: "1.0.0", connect: this.#connect },
      [StandardDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0", on: this.on },
      [XRPL_SIGN_TRANSACTION]: { version: "1.0.0", signTransaction: this.#signTransaction },
      [XRPL_SIGN_AND_SUBMIT_TRANSACTION]: { version: "1.0.0", signAndSubmitTransaction: this.#signAndSubmitTransaction },
    };
  }

  #connect = async (input?: StandardConnectInput): Promise<StandardConnectOutput> => {
    if (input?.silent) return { accounts: await this.silentAccounts() };
    const res = await this.transport.request("xrpl", XRPL_INJECTED.connect);
    return { accounts: this.setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []) };
  };

  #disconnect = async (): Promise<void> => {
    await this.transport.request("xrpl", XRPL_INJECTED.disconnect);
    this.setAccounts([]);
  };

  #wire(input: XrplSignTransactionInput): { params: Record<string, unknown>; chain: string } {
    if (!input || typeof input !== "object" || !input.tx_json || typeof input.tx_json !== "object") throw rpcError.invalidParams("Expected { tx_json, account, network }.");
    const chain = xrplChainId(input.network);
    if (!chain || !this.chains.includes(chain as `xrpl:${string}`)) throw rpcError.chainDisconnected(`This wallet does not support ${String(input.network)}.`);
    const account = this.ownAccount(input.account).address;
    const params: Record<string, unknown> = { tx_json: input.tx_json, account, network: chain };
    if (input.options && typeof input.options === "object") {
      params.options = { ...(input.options.autofill !== undefined ? { autofill: !!input.options.autofill } : {}), ...(input.options.multisig !== undefined ? { multisig: !!input.options.multisig } : {}) };
    }
    return { params, chain };
  }

  #signTransaction = async (input: XrplSignTransactionInput): Promise<XrplSignTransactionOutput> => {
    const { params, chain } = this.#wire(input);
    const res = (await this.transport.request("xrpl", XRPL_SIGN_TRANSACTION, params, chain)) as XrplSignTransactionOutput;
    return { signed_tx_blob: res.signed_tx_blob };
  };

  #signAndSubmitTransaction = async (input: XrplSignTransactionInput): Promise<XrplSignAndSubmitTransactionOutput> => {
    const { params, chain } = this.#wire(input);
    const res = (await this.transport.request("xrpl", XRPL_SIGN_AND_SUBMIT_TRANSACTION, params, chain)) as XrplSignAndSubmitTransactionOutput;
    return { tx_hash: res.tx_hash, tx_json: res.tx_json };
  };
}

/**
 * Registers the wallet with Wallet Standard (how XLS-72d dapps find wallets: @wallet-standard/app getWallets(),
 * @xrpl-wallet-standard/app getRegisterdXRPLWallets()) and exposes it at `window.clipwallet.xrpl` (or the kit
 * wallet's own global key). Returns undefined when the registry has no XRPL network.
 */
export function installXrpl(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions & { register?: (w: Wallet) => void } = {},
): { wallet: ClipXrplWallet; stop(): void } | undefined {
  if (!xrplChains(networks).length) return undefined;
  const wallet = new ClipXrplWallet(identity, networks, transport);
  // Wallet Standard has no unregister for wallets (the other Standard wallets in index.ts don't have one either).
  (opts.register ?? registerWallet)(wallet);
  const unexpose = exposeOnGlobal(win, opts.globalKey ?? DEFAULT_GLOBAL_KEY, "xrpl", wallet, identity);
  return { wallet, stop: unexpose };
}
