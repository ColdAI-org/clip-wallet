/**
 * Clip Wallet for Stellar Wallets Kit (@creit.tech/stellar-wallets-kit v2), as a `ModuleInterface`:
 *
 *   import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
 *   import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
 *   import { ClipWalletModule } from "@clip-wallet/kit-modules/stellar";
 *   StellarWalletsKit.init({ modules: [...defaultModules(), new ClipWalletModule()] });
 *
 * It wraps the SEP-43 provider 1Mask injects at `window.clipwallet.stellar`
 * (packages/1mask/src/inpage/stellar.ts). The interface below is copied structurally from
 * stellar-wallets-kit 2.7.0 `esm/types/mod.d.ts` (ModuleInterface, ModuleType, IKitError) so this
 * package doesn't pull the kit's dependency tree; `moduleType` is the enum's string value.
 *
 * @module
 */
import { CLIP_WALLET_GLOBAL } from "../index.js";
import { CLIP_ICON, announcedIdentity, injected } from "../shared.js";

export const CLIP_WALLET_STELLAR_ID = "clip-wallet";

/** stellar-wallets-kit `ModuleType` values. */
export type SwkModuleType = "HW_WALLET" | "HOT_WALLET" | "BRIDGE_WALLET" | "AIR_GAPED_WALLET";

/** stellar-wallets-kit `IKitError` (SEP-43 error shape). */
export interface SwkError {
  code: number;
  message: string;
  ext?: string | string[];
}

interface Opts {
  networkPassphrase?: string;
  address?: string;
  path?: string;
}

/** stellar-wallets-kit 2.7.0 `ModuleInterface` (structural copy). */
export interface SwkModuleInterface {
  moduleType: SwkModuleType;
  productId: string;
  productName: string;
  productUrl: string;
  productIcon: string;
  isAvailable(): Promise<boolean>;
  isPlatformWrapper?(): Promise<boolean>;
  onChange?(callback: (event: { address: string; network: string; networkPassphrase: string; error?: SwkError }) => void): void;
  getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }>;
  signTransaction(xdr: string, opts?: Opts): Promise<{ signedTxXdr: string; signerAddress?: string }>;
  signAuthEntry(authEntry: string, opts?: Opts): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
  signMessage(message: string, opts?: Opts): Promise<{ signedMessage: string; signerAddress?: string }>;
  signAndSubmitTransaction?(xdr: string, opts?: { networkPassphrase?: string; address?: string }): Promise<{ status: "success" | "pending" }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  disconnect?(): Promise<void>;
}

type Sep43<T> = Promise<(T & { error?: undefined }) | ({ error: SwkError } & Partial<T>)>;

/** Structural copy of 1Mask's ClipStellarProvider (SEP-43). */
export interface ClipStellarInjected {
  isClipWallet: true;
  name: string;
  address?: string;
  getAddress(): Sep43<{ address: string }>;
  getNetwork(): Sep43<{ network: string; networkPassphrase: string }>;
  signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string }): Sep43<{ signedTxXdr: string; signerAddress: string }>;
  signAndSubmitTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string }): Sep43<{ status: "success" | "pending"; hash?: string }>;
  signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string }): Sep43<{ signedAuthEntry: string; signerAddress: string }>;
  signMessage(message: string, opts?: { networkPassphrase?: string; address?: string }): Sep43<{ signedMessage: string; signerAddress: string }>;
  disconnect(): Promise<void>;
  on(event: "accountsChanged" | "disconnect", cb: (...args: any[]) => void): () => void;
}

export interface ClipWalletStellarParams {
  productName?: string;
  productUrl?: string;
  productIcon?: string;
  globalKey?: string;
}

/** Kit modules reject with an IKitError; SEP-43 resolves with { error }. */
async function unwrap<T>(p: Sep43<T>): Promise<T> {
  const r = await p;
  if (r.error) throw { code: r.error.code, message: r.error.message, ...(r.error.ext ? { ext: r.error.ext } : {}) } satisfies SwkError;
  return r as T;
}

const strip = (opts?: Opts) => {
  const o: { networkPassphrase?: string; address?: string } = {};
  if (opts?.networkPassphrase) o.networkPassphrase = opts.networkPassphrase;
  if (opts?.address) o.address = opts.address;
  return o;
};

export class ClipWalletModule implements SwkModuleInterface {
  readonly moduleType: SwkModuleType = "HOT_WALLET";
  readonly productId = CLIP_WALLET_STELLAR_ID;
  readonly productName: string;
  readonly productUrl: string;
  readonly productIcon: string;
  readonly #globalKey: string;

  constructor(params: ClipWalletStellarParams = {}) {
    this.#globalKey = params.globalKey ?? CLIP_WALLET_GLOBAL;
    // Explicit options, then what the installed wallet announces, then Clip Wallet's own identity.
    const announced = announcedIdentity(this.#globalKey);
    this.productName = params.productName ?? announced.name ?? "Clip Wallet";
    this.productUrl = params.productUrl ?? "https://coldai.org/clip-wallet";
    this.productIcon = params.productIcon ?? announced.icon ?? CLIP_ICON;
  }

  #provider(): ClipStellarInjected {
    const p = injected<ClipStellarInjected>(this.#globalKey, "stellar");
    if (!p) throw { code: -1, message: `${this.productName} is not installed` } satisfies SwkError;
    return p;
  }

  async isAvailable(): Promise<boolean> {
    return !!injected(this.#globalKey, "stellar");
  }

  onChange(callback: (event: { address: string; network: string; networkPassphrase: string; error?: SwkError }) => void): void {
    const p = injected<ClipStellarInjected>(this.#globalKey, "stellar");
    p?.on("accountsChanged", async () => {
      const address = p.address ?? "";
      const net = await p.getNetwork();
      if (net.error) callback({ address, network: "", networkPassphrase: "", error: net.error });
      else callback({ address, network: net.network, networkPassphrase: net.networkPassphrase });
    });
  }

  async getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }> {
    const p = this.#provider();
    if (params?.skipRequestAccess && !p.address) throw { code: -3, message: "Not connected yet: call getAddress() without skipRequestAccess first." } satisfies SwkError;
    if (params?.skipRequestAccess && p.address) return { address: p.address };
    const { address } = await unwrap(p.getAddress());
    return { address };
  }

  async signTransaction(xdr: string, opts?: Opts): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    const r = await unwrap(this.#provider().signTransaction(xdr, strip(opts)));
    return { signedTxXdr: r.signedTxXdr, signerAddress: r.signerAddress };
  }

  async signAndSubmitTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string }): Promise<{ status: "success" | "pending" }> {
    const r = await unwrap(this.#provider().signAndSubmitTransaction(xdr, strip(opts)));
    return { status: r.status };
  }

  async signAuthEntry(authEntry: string, opts?: Opts): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    const r = await unwrap(this.#provider().signAuthEntry(authEntry, strip(opts)));
    return { signedAuthEntry: r.signedAuthEntry, signerAddress: r.signerAddress };
  }

  async signMessage(message: string, opts?: Opts): Promise<{ signedMessage: string; signerAddress?: string }> {
    const r = await unwrap(this.#provider().signMessage(message, strip(opts)));
    return { signedMessage: r.signedMessage, signerAddress: r.signerAddress };
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    const r = await unwrap(this.#provider().getNetwork());
    return { network: r.network, networkPassphrase: r.networkPassphrase };
  }

  async disconnect(): Promise<void> {
    await this.#provider().disconnect();
  }
}
