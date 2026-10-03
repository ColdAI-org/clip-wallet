import type { Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import { RpcErrorCode, toRpcErrorShape } from "../shared/errors.js";
import { STELLAR_INJECTED, STELLAR_PASSPHRASES } from "../shared/p2-methods.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { DEFAULT_GLOBAL_KEY, InjectedFamilyBase, exposeOnGlobal, type InjectedOptions } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Injected Stellar provider at `window.clipwallet.stellar`, implementing SEP-0043 (Standard Web Wallet
 * API Interface, v1.2.1): methods resolve to `{ ...result }` or `{ error: { code, message, ext? } }`
 * with SEP-43 codes (-1 internal, -2 external service, -3 invalid request, -4 user rejected) and never
 * throw. @clip-wallet/kit-modules/stellar wraps it as a Stellar Wallets Kit ModuleInterface.
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */

export interface Sep43Error {
  message: string;
  code: number;
  ext?: string[];
}

export interface Sep43Options {
  networkPassphrase?: string;
  address?: string;
  /** SEP-43 signTransaction only: sign and submit. `submitUrl` is refused: Clip submits to its own Horizon / RPC. */
  submit?: boolean;
  submitUrl?: string;
}

type Result<T> = Promise<(T & { error?: undefined }) | ({ error: Sep43Error } & Partial<T>)>;

/** 1Mask / EIP-1193 style codes → SEP-43 codes. */
export function toSep43Error(err: unknown): Sep43Error {
  const e = toRpcErrorShape(err);
  const code =
    e.code === RpcErrorCode.UserRejected
      ? -4
      : e.code === RpcErrorCode.InvalidParams || e.code === RpcErrorCode.Unauthorized || e.code === RpcErrorCode.UnsupportedMethod || e.code === RpcErrorCode.ChainDisconnected
        ? -3
        : -1;
  return { code, message: e.message };
}

export class ClipStellarProvider extends InjectedFamilyBase {
  readonly isClipWallet = true;
  readonly name: string;
  readonly icon: string;
  readonly #networks: Set<string>;

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    super("stellar", transport);
    this.name = identity.name;
    this.icon = identity.icon;
    this.#networks = new Set(networks.filter((n) => n.family === "stellar").map((n) => n.id));
  }

  get address(): string | undefined {
    return this.accountsCache[0]?.address;
  }

  async #wrap<T>(fn: () => Promise<T>): Result<T> {
    try {
      return (await fn()) as T & { error?: undefined };
    } catch (err) {
      return { error: toSep43Error(err) } as { error: Sep43Error } & Partial<T>;
    }
  }

  #chain(passphrase?: string): string | undefined {
    if (passphrase === undefined) return undefined;
    const id = STELLAR_PASSPHRASES[passphrase];
    if (!id || !this.#networks.has(id)) {
      throw Object.assign(new Error(`Clip Wallet doesn't support the Stellar network “${passphrase}”.`), { code: RpcErrorCode.InvalidParams });
    }
    return id;
  }

  #checkOpts(opts?: Sep43Options) {
    if (opts?.submitUrl !== undefined) {
      throw Object.assign(new Error("Clip Wallet submits through its own Stellar servers; submitUrl isn't supported."), { code: RpcErrorCode.InvalidParams });
    }
    if (opts?.address !== undefined && this.accountsCache.length && !this.accountsCache.some((a) => a.address === opts.address)) {
      throw Object.assign(new Error("That account isn't connected to this site."), { code: RpcErrorCode.Unauthorized });
    }
  }

  /** Prompts to connect on first use, like Freighter's requestAccess + getAddress. */
  getAddress(): Result<{ address: string }> {
    return this.#wrap(async () => {
      let list = (await this.request(STELLAR_INJECTED.accounts)) as ExposedAccount[];
      if (!Array.isArray(list) || list.length === 0) list = (await this.request(STELLAR_INJECTED.connect, {})) as ExposedAccount[];
      this.setAccounts(Array.isArray(list) ? list : []);
      const address = this.address;
      if (!address) throw Object.assign(new Error("No Stellar account is connected."), { code: RpcErrorCode.Unauthorized });
      return { address };
    });
  }

  getNetwork(): Result<{ network: string; networkPassphrase: string }> {
    return this.#wrap(async () => (await this.request(STELLAR_INJECTED.getNetwork)) as { network: string; networkPassphrase: string });
  }

  signTransaction(xdr: string, opts?: Sep43Options): Result<{ signedTxXdr: string; signerAddress: string }> {
    return this.#wrap(async () => {
      if (typeof xdr !== "string" || !xdr) throw Object.assign(new Error("Expected a base64 transaction XDR."), { code: RpcErrorCode.InvalidParams });
      this.#checkOpts(opts);
      const chain = this.#chain(opts?.networkPassphrase);
      const params = { xdr, networkPassphrase: opts?.networkPassphrase, address: opts?.address };
      if (opts?.submit) {
        const sent = (await this.request(STELLAR_INJECTED.signAndSubmitXDR, params, chain)) as { signedXDR?: string };
        return { signedTxXdr: sent.signedXDR ?? "", signerAddress: opts?.address ?? this.address ?? "" };
      }
      const res = (await this.request(STELLAR_INJECTED.signXDR, params, chain)) as { signedXDR: string };
      return { signedTxXdr: res.signedXDR, signerAddress: opts?.address ?? this.address ?? "" };
    });
  }

  /** Not in SEP-43; mirrors Stellar Wallets Kit's optional `signAndSubmitTransaction`. */
  signAndSubmitTransaction(xdr: string, opts?: Omit<Sep43Options, "submit" | "submitUrl">): Result<{ status: "success" | "pending"; hash?: string }> {
    return this.#wrap(async () => {
      this.#checkOpts(opts);
      const chain = this.#chain(opts?.networkPassphrase);
      return (await this.request(STELLAR_INJECTED.signAndSubmitXDR, { xdr, networkPassphrase: opts?.networkPassphrase, address: opts?.address }, chain)) as {
        status: "success" | "pending";
        hash?: string;
      };
    });
  }

  signAuthEntry(authEntry: string, opts?: Omit<Sep43Options, "submit" | "submitUrl">): Result<{ signedAuthEntry: string; signerAddress: string }> {
    return this.#wrap(async () => {
      this.#checkOpts(opts);
      const chain = this.#chain(opts?.networkPassphrase);
      const res = (await this.request(STELLAR_INJECTED.signAuthEntry, { authEntry, networkPassphrase: opts?.networkPassphrase, address: opts?.address }, chain)) as {
        signedAuthEntry: string;
        signerAddress?: string;
      };
      return { signedAuthEntry: res.signedAuthEntry, signerAddress: res.signerAddress ?? this.address ?? "" };
    });
  }

  signMessage(message: string, opts?: Omit<Sep43Options, "submit" | "submitUrl">): Result<{ signedMessage: string; signerAddress: string }> {
    return this.#wrap(async () => {
      if (typeof message !== "string") throw Object.assign(new Error("Expected a message string."), { code: RpcErrorCode.InvalidParams });
      this.#checkOpts(opts);
      const chain = this.#chain(opts?.networkPassphrase);
      const res = (await this.request(STELLAR_INJECTED.signMessage, { message, networkPassphrase: opts?.networkPassphrase, address: opts?.address }, chain)) as {
        signedMessage?: string;
        signature?: string;
        signerAddress?: string;
      };
      return { signedMessage: res.signedMessage ?? res.signature ?? "", signerAddress: res.signerAddress ?? this.address ?? "" };
    });
  }

  async disconnect(): Promise<void> {
    await this.request(STELLAR_INJECTED.disconnect);
    this.setAccounts([]);
  }
}

export function installStellarProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions = {},
): { provider: ClipStellarProvider; stop(): void } {
  const provider = new ClipStellarProvider(identity, networks, transport);
  const stop = exposeOnGlobal(win, opts.globalKey ?? DEFAULT_GLOBAL_KEY, "stellar", provider, identity);
  return { provider, stop };
}
