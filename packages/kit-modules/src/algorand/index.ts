/**
 * Clip Wallet for TxnLab use-wallet v5 (@txnlab/use-wallet), as a wallet adapter:
 *
 *   import { WalletManager } from "@txnlab/use-wallet";
 *   import { clipWallet } from "@clip-wallet/kit-modules/algorand";
 *   new WalletManager({ wallets: [clipWallet()], defaultNetwork: "testnet" });
 *
 * In v5 every wallet is an adapter package exporting a factory that returns a `WalletAdapterConfig`
 * ({ id, metadata, Adapter, options, capabilities }) whose `Adapter` extends `BaseWallet` from
 * "@txnlab/use-wallet/adapter" — the same shape @txnlab/use-wallet-exodus 5.0.1 uses for its injected
 * wallet. This adapter talks to the provider 1Mask injects at `window.clipwallet.algorand`
 * (packages/1mask/src/inpage/algorand.ts: ARC-0001 signTxns + ARC-0006 enable). Clip Wallet is also
 * reachable through use-wallet's WalletConnect adapter (namespace "algorand", method algo_signTxn) once
 * the extension's WalletConnect side lists that namespace.
 */
import algosdk from "algosdk";
import {
  BaseWallet,
  base64ToByteArray,
  byteArrayToBase64,
  flattenTxnGroup,
  isSignedTxn,
  type AdapterConstructorParams,
  type WalletAccount,
  type WalletAdapterConfig,
  type WalletFactoryOptions,
  type WalletMetadata,
  type WalletTransaction,
} from "@txnlab/use-wallet/adapter";
import { CLIP_WALLET_GLOBAL } from "../index.js";
import { CLIP_ICON, announcedIdentity, injected } from "../shared.js";

export const CLIP_WALLET_ALGORAND_ID = "clip-wallet";
/** use-wallet third-party adapter contract: export a WALLET_ID constant. */
export const WALLET_ID = CLIP_WALLET_ALGORAND_ID;

/** Structural copy of 1Mask's ClipAlgorandProvider. */
export interface ClipAlgorandInjected {
  isClipWallet: true;
  isConnected: boolean;
  enable(opts?: { genesisID?: string; genesisHash?: string; accounts?: string[] }): Promise<{ genesisID: string; genesisHash: string; accounts: string[] }>;
  disable(): Promise<void>;
  signTxns(txns: WalletTransaction[]): Promise<(string | null)[]>;
  on(event: "accountsChanged" | "disconnect", cb: (...args: any[]) => void): () => void;
}

export interface ClipAlgorandOptions {
  /** Kit-built wallets inject under their own global. Default "clipwallet". */
  globalKey?: string;
}

export class ClipWalletAdapter extends BaseWallet<ClipAlgorandOptions> {
  static override defaultMetadata: WalletMetadata = { name: "Clip Wallet", icon: CLIP_ICON };

  constructor(params: AdapterConstructorParams<ClipAlgorandOptions>) {
    super(params);
  }

  #provider(): ClipAlgorandInjected {
    const p = injected<ClipAlgorandInjected>(this.options?.globalKey ?? CLIP_WALLET_GLOBAL, "algorand");
    if (!p) throw new Error(`${this.metadata.name} is not installed.`);
    return p;
  }

  #enable() {
    const net = this.activeNetworkConfig;
    const opts: { genesisHash?: string; genesisID?: string } = {};
    if (net.genesisHash) opts.genesisHash = net.genesisHash;
    if (net.genesisId) opts.genesisID = net.genesisId;
    return this.#provider().enable(opts);
  }

  #accounts(addresses: string[]): WalletAccount[] {
    return addresses.map((address, i) => ({ name: `${this.metadata.name} Account ${i + 1}`, address }));
  }

  connect = async (): Promise<WalletAccount[]> => {
    const { accounts } = await this.#enable();
    if (accounts.length === 0) throw new Error("No accounts found!");
    const walletAccounts = this.#accounts(accounts);
    this.store.addWallet({ accounts: walletAccounts, activeAccount: walletAccounts[0]! });
    this.#provider().on("accountsChanged", (list: string[]) => {
      if (Array.isArray(list) && list.length) this.store.setAccounts(this.#accounts(list));
    });
    this.#provider().on("disconnect", () => this.onDisconnect());
    return walletAccounts;
  };

  disconnect = async (): Promise<void> => {
    try {
      await this.#provider().disable();
    } finally {
      this.onDisconnect();
    }
  };

  resumeSession = async (): Promise<void> => {
    if (!this.store.getWalletState()) return;
    try {
      // Already granted sites get their accounts back without a prompt.
      const { accounts } = await this.#enable();
      if (!accounts.length) throw new Error("Clip Wallet is not connected.");
      this.store.setAccounts(this.#accounts(accounts));
    } catch (error) {
      this.onDisconnect();
      throw error;
    }
  };

  #walletTxns(txnGroup: algosdk.Transaction[] | Uint8Array[], indexesToSign?: number[]): WalletTransaction[] {
    return txnGroup.map((item, index) => {
      let txn: algosdk.Transaction;
      let signed = false;
      if (item instanceof Uint8Array) {
        signed = isSignedTxn(algosdk.msgpackRawDecode(item));
        txn = signed ? algosdk.decodeSignedTransaction(item).txn : algosdk.decodeUnsignedTransaction(item);
      } else {
        txn = item;
      }
      const wire: WalletTransaction = { txn: byteArrayToBase64(txn.toByte()) };
      const want = (!indexesToSign || indexesToSign.includes(index)) && !signed && this.addresses.includes(txn.sender.toString());
      if (!want) wire.signers = [];
      return wire;
    });
  }

  signTransactions = async <T extends algosdk.Transaction[] | Uint8Array[]>(txnGroup: T | T[], indexesToSign?: number[]): Promise<(Uint8Array | null)[]> => {
    const flat = flattenTxnGroup(txnGroup as unknown[]) as algosdk.Transaction[] | Uint8Array[];
    const res = await this.#provider().signTxns(this.#walletTxns(flat, indexesToSign));
    return res.map((v) => (v === null ? null : base64ToByteArray(v)));
  };
}

/** use-wallet v5 factory: `new WalletManager({ wallets: [clipWallet()] })`. */
export function clipWallet(options: ClipAlgorandOptions & WalletFactoryOptions = {}): WalletAdapterConfig {
  const { metadata, ...adapterOptions } = options;
  // Explicit metadata, then what the installed wallet announces, then Clip Wallet's own identity.
  const announced = announcedIdentity(adapterOptions.globalKey ?? CLIP_WALLET_GLOBAL);
  return {
    id: CLIP_WALLET_ALGORAND_ID,
    metadata: { ...ClipWalletAdapter.defaultMetadata, ...announced, ...metadata },
    Adapter: ClipWalletAdapter as unknown as WalletAdapterConfig["Adapter"],
    options: Object.keys(adapterOptions).length > 0 ? adapterOptions : undefined,
    // Testnet-only builds simply won't enable on mainnet; the provider answers 4200 there.
    capabilities: { supportedNetworks: ["testnet", "mainnet"] },
  } as WalletAdapterConfig;
}
