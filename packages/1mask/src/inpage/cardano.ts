/**
 * CIP-30 connector: `window.cardano.<walletKey>` (https://cips.cardano.org/cip/CIP-30).
 *
 *   cardano.<key> = { apiVersion: "1", name, icon, supportedExtensions, enable(), isEnabled() }
 *   enable() → API { getExtensions, getNetworkId, getUtxos, getCollateral, getBalance, getUsedAddresses,
 *                    getUnusedAddresses, getChangeAddress, getRewardAddresses, signTx, signData, submitTx,
 *                    experimental: { getCollateral } }
 *
 * Errors are CIP-30 shapes ({ code, info }): APIError (-1 InvalidRequest, -2 InternalError, -3 Refused,
 * -4 AccountChange), TxSignError (1 ProofGeneration, 2 UserDeclined), DataSignError (1 ProofGeneration,
 * 2 AddressNotPK, 3 UserDeclined), TxSendError (1 Refused, 2 Failure), PaginateError ({ maxSize }).
 * Every call goes to the background as a `cardano_*` DappRequest method; nothing is decided here.
 */
import type { WalletIdentity } from "../shared/config.js";
import { RpcErrorCode } from "../shared/errors.js";
import { METHOD_WS_STATE } from "../shared/protocol.js";
import type { InpageTransport } from "./transport.js";

export const CIP30_METHODS = {
  enable: "cardano_enable",
  disconnect: "cardano_disconnect",
  getNetworkId: "cardano_getNetworkId",
  getUtxos: "cardano_getUtxos",
  getCollateral: "cardano_getCollateral",
  getBalance: "cardano_getBalance",
  getUsedAddresses: "cardano_getUsedAddresses",
  getUnusedAddresses: "cardano_getUnusedAddresses",
  getChangeAddress: "cardano_getChangeAddress",
  getRewardAddresses: "cardano_getRewardAddresses",
  signTx: "cardano_signTx",
  signData: "cardano_signData",
  submitTx: "cardano_submitTx",
} as const;

export const APIErrorCode = { InvalidRequest: -1, InternalError: -2, Refused: -3, AccountChange: -4 } as const;
export const TxSignErrorCode = { ProofGeneration: 1, UserDeclined: 2 } as const;
export const DataSignErrorCode = { ProofGeneration: 1, AddressNotPK: 2, UserDeclined: 3 } as const;
export const TxSendErrorCode = { Refused: 1, Failure: 2 } as const;

/** Thrown to dapps. CIP-30 errors are `{ code, info }`; `message` mirrors `info` for console readability. */
export class Cip30Error extends Error {
  constructor(
    public readonly code: number,
    public readonly info: string,
  ) {
    super(info);
    this.name = "Cip30Error";
  }
}

type Kind = "api" | "signTx" | "signData" | "submitTx";

/** Markers from @clip-wallet/chains-cardano's user messages (PROOF_GENERATION_MESSAGE, ADDRESS_NOT_PK_MESSAGE …). */
const PROOF = /can't sign all of this transaction|isn't this account's|doesn't need your signature/i;
const NOT_PK = /isn't controlled by a key/i;

export function toCip30Error(err: unknown, kind: Kind): Cip30Error {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "number" ? e.code : RpcErrorCode.Internal;
  const info = typeof e.message === "string" ? e.message : "Something went wrong in the wallet.";
  if (code === RpcErrorCode.UserRejected) {
    if (kind === "signTx") return new Cip30Error(TxSignErrorCode.UserDeclined, info);
    if (kind === "signData") return new Cip30Error(DataSignErrorCode.UserDeclined, info);
    if (kind === "submitTx") return new Cip30Error(TxSendErrorCode.Refused, info);
    return new Cip30Error(APIErrorCode.Refused, info);
  }
  if (code === RpcErrorCode.Unauthorized || code === RpcErrorCode.Disconnected) return new Cip30Error(APIErrorCode.Refused, info);
  if (code === RpcErrorCode.InvalidParams || code === RpcErrorCode.UnsupportedMethod) return new Cip30Error(APIErrorCode.InvalidRequest, info);
  if (kind === "signTx" && PROOF.test(info)) return new Cip30Error(TxSignErrorCode.ProofGeneration, info);
  if (kind === "signData" && NOT_PK.test(info)) return new Cip30Error(DataSignErrorCode.AddressNotPK, info);
  if (kind === "signData" && PROOF.test(info)) return new Cip30Error(DataSignErrorCode.ProofGeneration, info);
  if (kind === "submitTx") return new Cip30Error(TxSendErrorCode.Failure, info);
  return new Cip30Error(APIErrorCode.InternalError, info);
}

export interface Cip30Paginate {
  page: number;
  limit: number;
}

export interface Cip30Api {
  getExtensions(): Promise<{ cip: number }[]>;
  getNetworkId(): Promise<number>;
  getUtxos(amount?: string, paginate?: Cip30Paginate): Promise<string[] | null>;
  getCollateral(params?: { amount?: string | number }): Promise<string[] | null>;
  getBalance(): Promise<string>;
  getUsedAddresses(paginate?: Cip30Paginate): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  signData(addr: string, payload: string): Promise<{ signature: string; key: string }>;
  submitTx(tx: string): Promise<string>;
  experimental: { getCollateral(params?: { amount?: string | number }): Promise<string[] | null> };
}

export interface Cip30Wallet {
  readonly apiVersion: string;
  readonly name: string;
  readonly icon: string;
  readonly supportedExtensions: { cip: number }[];
  enable(opts?: { extensions?: { cip: number }[] }): Promise<Cip30Api>;
  isEnabled(): Promise<boolean>;
}

const isHexStr = (s: unknown): s is string => typeof s === "string" && s.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(s);

function checkPaginate(p: unknown): Cip30Paginate | undefined {
  if (p === undefined || p === null) return undefined;
  const { page, limit } = p as Partial<Cip30Paginate>;
  if (!Number.isInteger(page) || !Number.isInteger(limit) || (page as number) < 0 || (limit as number) <= 0) {
    throw new Cip30Error(APIErrorCode.InvalidRequest, "paginate must be { page, limit } with page ≥ 0 and limit > 0.");
  }
  return { page: page as number, limit: limit as number };
}

/** The wallet key under `window.cardano`: lower-case name, letters and digits only ("Clip Wallet" → "clipwallet"). */
export function cardanoWalletKey(identity: WalletIdentity): string {
  return identity.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "clipwallet";
}

export class ClipCardanoWallet implements Cip30Wallet {
  readonly apiVersion = "1";
  readonly name: string;
  readonly icon: string;
  readonly supportedExtensions: { cip: number }[] = [];
  #transport: InpageTransport;
  /** Bumped when the wallet's account changes or the site is disconnected: old API objects then fail with AccountChange / Refused. */
  #epoch = 0;
  #revoked = false;
  #stop: () => void;

  constructor(identity: WalletIdentity, transport: InpageTransport) {
    this.name = identity.name;
    this.icon = identity.icon;
    this.#transport = transport;
    this.#stop = transport.onEvent((family, event) => {
      if (family !== "cardano") return;
      if (event === "accountsChanged" || event === "disconnect") this.#epoch++;
      if (event === "disconnect") this.#revoked = true;
    });
    // Wallet objects are plain data for dapps: bind methods so `const { enable } = cardano.clipwallet` works.
    this.enable = this.enable.bind(this);
    this.isEnabled = this.isEnabled.bind(this);
  }

  async isEnabled(): Promise<boolean> {
    try {
      const res = await this.#transport.request("cardano", METHOD_WS_STATE);
      return Array.isArray(res) && res.length > 0;
    } catch {
      return false;
    }
  }

  async enable(opts?: { extensions?: { cip: number }[] }): Promise<Cip30Api> {
    const extensions = Array.isArray(opts?.extensions) ? opts!.extensions.filter((e) => e && Number.isInteger(e.cip)) : [];
    try {
      const res = await this.#transport.request("cardano", CIP30_METHODS.enable, { extensions });
      if (!Array.isArray(res) || res.length === 0) throw new Cip30Error(APIErrorCode.Refused, "No Cardano account is connected.");
    } catch (e) {
      throw e instanceof Cip30Error ? e : toCip30Error(e, "api");
    }
    this.#revoked = false;
    return this.#api(this.#epoch);
  }

  #api(epoch: number): Cip30Api {
    const call = async <T>(method: string, params: unknown, kind: Kind = "api"): Promise<T> => {
      if (this.#revoked) throw new Cip30Error(APIErrorCode.Refused, "The wallet disconnected this site. Call enable() again.");
      if (epoch !== this.#epoch) throw new Cip30Error(APIErrorCode.AccountChange, "The wallet's account changed. Call enable() again.");
      try {
        return (await this.#transport.request("cardano", method, params)) as T;
      } catch (e) {
        throw toCip30Error(e, kind);
      }
    };
    const collateral = (params?: { amount?: string | number }) => call<string[] | null>(CIP30_METHODS.getCollateral, [params ?? {}]);
    return Object.freeze({
      getExtensions: async () => [],
      getNetworkId: () => call<number>(CIP30_METHODS.getNetworkId, []),
      getUtxos: async (amount?: string, paginate?: Cip30Paginate) => {
        if (amount !== undefined && amount !== null && !isHexStr(amount)) throw new Cip30Error(APIErrorCode.InvalidRequest, "amount must be CBOR hex.");
        return call<string[] | null>(CIP30_METHODS.getUtxos, [amount ?? null, checkPaginate(paginate) ?? null]);
      },
      getCollateral: collateral,
      getBalance: () => call<string>(CIP30_METHODS.getBalance, []),
      getUsedAddresses: async (paginate?: Cip30Paginate) => call<string[]>(CIP30_METHODS.getUsedAddresses, [checkPaginate(paginate) ?? null]),
      getUnusedAddresses: () => call<string[]>(CIP30_METHODS.getUnusedAddresses, []),
      getChangeAddress: () => call<string>(CIP30_METHODS.getChangeAddress, []),
      getRewardAddresses: () => call<string[]>(CIP30_METHODS.getRewardAddresses, []),
      signTx: async (tx: string, partialSign = false) => {
        if (!isHexStr(tx) || tx.length === 0) throw new Cip30Error(APIErrorCode.InvalidRequest, "tx must be CBOR hex.");
        return call<string>(CIP30_METHODS.signTx, [tx, partialSign === true], "signTx");
      },
      signData: async (addr: string, payload: string) => {
        if (typeof addr !== "string" || !addr) throw new Cip30Error(APIErrorCode.InvalidRequest, "addr must be an address (hex or bech32).");
        if (!isHexStr(payload)) throw new Cip30Error(APIErrorCode.InvalidRequest, "payload must be hex.");
        return call<{ signature: string; key: string }>(CIP30_METHODS.signData, [addr, payload], "signData");
      },
      submitTx: async (tx: string) => {
        if (!isHexStr(tx) || tx.length === 0) throw new Cip30Error(APIErrorCode.InvalidRequest, "tx must be CBOR hex.");
        return call<string>(CIP30_METHODS.submitTx, [tx], "submitTx");
      },
      experimental: Object.freeze({ getCollateral: collateral }),
    });
  }

  destroy(): void {
    this.#stop();
  }
}

/**
 * Installs the wallet at `window.cardano[key]` (creating the shared `window.cardano` namespace if absent).
 * Never overwrites another wallet's key. Returns undefined when the key is taken.
 */
export function installCardano(
  win: Window,
  identity: WalletIdentity,
  transport: InpageTransport,
  opts: { walletKey?: string } = {},
): { wallet: ClipCardanoWallet; key: string; destroy(): void } | undefined {
  const key = opts.walletKey ?? cardanoWalletKey(identity);
  const w = win as unknown as { cardano?: Record<string, unknown> };
  if (!w.cardano || typeof w.cardano !== "object") {
    Object.defineProperty(win, "cardano", { value: {}, writable: false, configurable: true, enumerable: true });
  }
  const ns = w.cardano!;
  if (key in ns) return undefined;
  const wallet = new ClipCardanoWallet(identity, transport);
  Object.defineProperty(ns, key, { value: wallet, writable: false, configurable: true, enumerable: true });
  return {
    wallet,
    key,
    destroy() {
      wallet.destroy();
      if (ns[key] === wallet) delete ns[key];
    },
  };
}
