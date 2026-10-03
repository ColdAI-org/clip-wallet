import type { Network } from "@clip-wallet/core";
import {
  type AnyRawTransaction,
  AccountAddress,
  AccountAuthenticator,
  Deserializer,
  Ed25519PublicKey,
  Ed25519Signature,
  Network as AptosNetwork,
  SigningScheme,
} from "@aptos-labs/ts-sdk";
import {
  AccountInfo,
  AptosConnectNamespace,
  AptosDisconnectNamespace,
  AptosGetAccountNamespace,
  AptosGetNetworkNamespace,
  AptosOnAccountChangeNamespace,
  AptosOnNetworkChangeNamespace,
  AptosSignAndSubmitTransactionNamespace,
  AptosSignMessageNamespace,
  AptosSignTransactionNamespace,
  AptosWalletError,
  AptosWalletErrorCode,
  type AptosFeatures,
  type AptosSignAndSubmitTransactionInput,
  type AptosSignAndSubmitTransactionOutput,
  type AptosSignMessageInput,
  type AptosSignMessageOutput,
  type AptosWallet,
  type AptosWalletAccount,
  type NetworkInfo,
  type UserResponse,
  UserResponseStatus,
} from "@aptos-labs/wallet-standard";
import type { IdentifierArray, WalletIcon } from "@wallet-standard/base";
import type { WalletIdentity } from "../shared/config.js";
import { base64ToBytes, bytesToBase64, hexToBytes } from "../shared/bytes.js";
import { RpcErrorCode, rpcError } from "../shared/errors.js";
import { METHOD_WS_STATE, type ExposedAccount } from "../shared/protocol.js";
import type { InpageTransport } from "./transport.js";

/** Local (no prompt) method the Aptos wallet uses to read the site's selected network: answers `{ networkId }`. */
export const METHOD_APTOS_NETWORK = "1mask_getNetwork";

/** DappRequest method names the background allowlists for family "aptos" (see docs/phase2/integration/move.md). */
export const APTOS_CONNECT_METHODS = [AptosConnectNamespace] as const;
export const APTOS_LOCAL_METHODS = [METHOD_WS_STATE, METHOD_APTOS_NETWORK, AptosDisconnectNamespace] as const;
export const APTOS_SIGNING_METHODS = [AptosSignTransactionNamespace, AptosSignAndSubmitTransactionNamespace, AptosSignMessageNamespace] as const;

export const APTOS_FEATURES = [
  AptosConnectNamespace,
  AptosDisconnectNamespace,
  AptosGetAccountNamespace,
  AptosGetNetworkNamespace,
  AptosOnAccountChangeNamespace,
  AptosOnNetworkChangeNamespace,
  AptosSignTransactionNamespace,
  AptosSignAndSubmitTransactionNamespace,
  AptosSignMessageNamespace,
] as const;

/**
 * Registry NetworkId (CAIP-2 `aptos:<chain id>`, or `aptos:devnet`) ↔ AIP-62 chain and NetworkInfo.
 * Devnet's numeric chain id changes on every reset, so `aptos:network` reports 0 for it (the dapp reads it from its node).
 */
const APTOS_REGISTRY: Record<string, { chain: `aptos:${string}`; name: AptosNetwork; chainId: number }> = {
  "aptos:1": { chain: "aptos:mainnet", name: AptosNetwork.MAINNET, chainId: 1 },
  "aptos:2": { chain: "aptos:testnet", name: AptosNetwork.TESTNET, chainId: 2 },
  "aptos:devnet": { chain: "aptos:devnet", name: AptosNetwork.DEVNET, chainId: 0 },
};

export function aptosChain(net: Network): `aptos:${string}` | undefined {
  return net.family === "aptos" ? APTOS_REGISTRY[net.id]?.chain : undefined;
}

/** Wire-safe copy of a dapp's entry-function arguments (bigint → string, bytes → { $bytes: 0x… }, SDK values → plain). */
export function toWireArg(a: unknown): unknown {
  if (a == null || typeof a === "string" || typeof a === "number" || typeof a === "boolean") return a;
  if (typeof a === "bigint") return a.toString();
  if (a instanceof Uint8Array) return { $bytes: `0x${Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("")}` };
  if (Array.isArray(a)) return a.map(toWireArg);
  if (a instanceof AccountAddress) return a.toString();
  const o = a as { values?: unknown; value?: unknown; toUint8Array?: () => Uint8Array };
  if (Array.isArray(o.values)) return o.values.map(toWireArg); // MoveVector / MoveOption
  if (o.value !== undefined) return toWireArg(o.value); // U8…U256, Bool, MoveString, FixedBytes
  throw new AptosWalletError(AptosWalletErrorCode.Unsupported, "Clip Wallet can't pass this argument type yet.");
}

function rejected<T>(err: unknown): UserResponse<T> {
  if ((err as { code?: number } | null)?.code === RpcErrorCode.UserRejected) return { status: UserResponseStatus.REJECTED };
  throw err;
}

/** AIP-62 wallets carry a website URL. Default: the domain behind the rdns ("org.coldai.clipwallet" → https://coldai.org). */
function defaultUrl(rdns: string): string {
  const parts = rdns.split(".");
  return `https://${(parts.length > 2 ? parts.slice(0, -1) : parts).reverse().join(".")}`;
}

/**
 * AIP-62 Aptos wallet (@aptos-labs/wallet-standard). Results are UserResponse objects: a user rejection (4001)
 * comes back as `{ status: "Rejected" }`, anything else throws. Transactions travel as BCS (base64) of the
 * SimpleTransaction / MultiAgentTransaction; DappRequest params are `{ inputs: [{ account, ... }] }`.
 */
export class ClipAptosWallet implements AptosWallet {
  readonly version = "1.0.0" as const;
  readonly name: string;
  readonly icon: WalletIcon;
  readonly url: string;
  readonly chains: IdentifierArray;
  readonly #transport: InpageTransport;
  #accounts: AptosWalletAccount[] = [];
  #info: AccountInfo[] = [];
  #accountListeners = new Set<(a: AccountInfo) => void>();
  #networkListeners = new Set<(n: NetworkInfo) => void>();
  #stop: () => void;

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport, opts: { url?: string } = {}) {
    this.name = identity.name;
    this.icon = identity.icon;
    this.url = opts.url ?? defaultUrl(identity.rdns);
    this.chains = networks.map(aptosChain).filter((c): c is `aptos:${string}` => !!c);
    this.#transport = transport;
    this.#stop = transport.onEvent((family, event, data) => {
      if (family !== "aptos") return;
      if (event === "accountsChanged") this.#setAccounts(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      if (event === "disconnect") this.#setAccounts([]);
      if (event === "chainChanged" && typeof data === "string") {
        const n = this.#networkInfo(data);
        if (n) for (const l of [...this.#networkListeners]) this.#safe(() => l(n));
      }
    });
  }

  get accounts(): readonly AptosWalletAccount[] {
    return this.#accounts.slice();
  }

  get features(): AptosFeatures {
    return {
      [AptosConnectNamespace]: { version: "1.0.0", connect: this.#connect },
      [AptosDisconnectNamespace]: { version: "1.0.0", disconnect: this.#disconnect },
      [AptosGetAccountNamespace]: { version: "1.0.0", account: this.#account },
      [AptosGetNetworkNamespace]: { version: "1.0.0", network: this.#network },
      [AptosOnAccountChangeNamespace]: { version: "1.0.0", onAccountChange: this.#onAccountChange },
      [AptosOnNetworkChangeNamespace]: { version: "1.0.0", onNetworkChange: this.#onNetworkChange },
      [AptosSignTransactionNamespace]: { version: "1.0.0", signTransaction: this.#signTransaction },
      [AptosSignAndSubmitTransactionNamespace]: { version: "1.1.0", signAndSubmitTransaction: this.#signAndSubmitTransaction },
      [AptosSignMessageNamespace]: { version: "1.0.0", signMessage: this.#signMessage },
    };
  }

  /** Stop listening to the transport (installOneMask's destroy). */
  destroy(): void {
    this.#stop();
  }

  #safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* a dapp listener throwing must not break others */
    }
  }

  #networkInfo(networkId: string): NetworkInfo | undefined {
    const r = APTOS_REGISTRY[networkId];
    return r ? { name: r.name, chainId: r.chainId } : undefined;
  }

  #setAccounts(list: ExposedAccount[]): void {
    const valid = list.filter((a) => a && typeof a.address === "string" && typeof a.publicKey === "string");
    const changed = valid.length !== this.#info.length || valid.some((a, i) => this.#info[i]?.address.toString() !== AccountAddress.from(a.address).toString());
    this.#info = valid.map((a) => new AccountInfo({ address: a.address, publicKey: new Ed25519PublicKey(a.publicKey!) }));
    this.#accounts = valid.map((a) => ({
      address: AccountAddress.from(a.address).toStringLong(),
      publicKey: hexToBytes(a.publicKey!),
      chains: this.chains,
      features: [AptosSignTransactionNamespace, AptosSignAndSubmitTransactionNamespace, AptosSignMessageNamespace],
      signingScheme: SigningScheme.Ed25519,
    }));
    if (changed && this.#info[0]) {
      const first = this.#info[0];
      for (const l of [...this.#accountListeners]) this.#safe(() => l(first));
    }
  }

  #own(): AccountInfo {
    const a = this.#info[0];
    if (!a) throw new AptosWalletError(AptosWalletErrorCode.Unauthorized);
    return a;
  }

  #connect = async (silent?: boolean): Promise<UserResponse<AccountInfo>> => {
    try {
      const res = await this.#transport.request("aptos", silent ? METHOD_WS_STATE : AptosConnectNamespace);
      this.#setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []);
      const a = this.#info[0];
      return a ? { status: UserResponseStatus.APPROVED, args: a } : { status: UserResponseStatus.REJECTED };
    } catch (e) {
      return rejected(e);
    }
  };

  #disconnect = async (): Promise<void> => {
    await this.#transport.request("aptos", AptosDisconnectNamespace);
    this.#setAccounts([]);
  };

  #account = async (): Promise<AccountInfo> => this.#own();

  #network = async (): Promise<NetworkInfo> => {
    const res = (await this.#transport.request("aptos", METHOD_APTOS_NETWORK)) as { networkId?: string } | null;
    const n = res?.networkId ? this.#networkInfo(res.networkId) : undefined;
    if (!n) throw rpcError.chainDisconnected();
    return n;
  };

  #onAccountChange = async (cb: (a: AccountInfo) => void): Promise<void> => {
    this.#accountListeners.add(cb);
  };

  #onNetworkChange = async (cb: (n: NetworkInfo) => void): Promise<void> => {
    this.#networkListeners.add(cb);
  };

  #signTransaction = async (transaction: AnyRawTransaction, asFeePayer?: boolean): Promise<UserResponse<AccountAuthenticator>> => {
    const me = this.#own();
    if (!transaction || typeof (transaction as { bcsToBytes?: unknown }).bcsToBytes !== "function" || !transaction.rawTransaction) {
      throw new AptosWalletError(AptosWalletErrorCode.Unsupported, "Pass a SimpleTransaction or MultiAgentTransaction.");
    }
    const multiAgent = Array.isArray(transaction.secondarySignerAddresses);
    try {
      const res = (await this.#transport.request("aptos", AptosSignTransactionNamespace, {
        inputs: [{ account: me.address.toStringLong(), transaction: bytesToBase64(transaction.bcsToBytes()), multiAgent, asFeePayer: asFeePayer === true }],
      })) as { authenticator: string; feePayerAddress?: string };
      // As the SDK does when signing as fee payer: the transaction now names this account as its fee payer.
      if (asFeePayer && res.feePayerAddress) transaction.feePayerAddress = AccountAddress.from(res.feePayerAddress);
      return { status: UserResponseStatus.APPROVED, args: AccountAuthenticator.deserialize(new Deserializer(base64ToBytes(res.authenticator))) };
    } catch (e) {
      return rejected(e);
    }
  };

  #signAndSubmitTransaction = async (input: AptosSignAndSubmitTransactionInput): Promise<UserResponse<AptosSignAndSubmitTransactionOutput>> => {
    const me = this.#own();
    const p = input?.payload as { function?: unknown; typeArguments?: unknown[]; functionArguments?: unknown[]; bytecode?: unknown } | undefined;
    if (!p || typeof p.function !== "string" || p.bytecode !== undefined) {
      throw new AptosWalletError(AptosWalletErrorCode.Unsupported, "Clip Wallet sends entry-function payloads only.");
    }
    const wire: Record<string, unknown> = {
      account: me.address.toStringLong(),
      payload: {
        function: p.function,
        typeArguments: (p.typeArguments ?? []).map((t) => String(t)),
        functionArguments: (p.functionArguments ?? []).map(toWireArg),
      },
    };
    if (typeof input.maxGasAmount === "number") wire.maxGasAmount = input.maxGasAmount;
    if (typeof input.gasUnitPrice === "number") wire.gasUnitPrice = input.gasUnitPrice;
    try {
      const res = (await this.#transport.request("aptos", AptosSignAndSubmitTransactionNamespace, { inputs: [wire] })) as { hash: `0x${string}` };
      return { status: UserResponseStatus.APPROVED, args: { hash: res.hash } };
    } catch (e) {
      return rejected(e);
    }
  };

  #signMessage = async (input: AptosSignMessageInput): Promise<UserResponse<AptosSignMessageOutput>> => {
    const me = this.#own();
    if (!input || typeof input.message !== "string" || typeof input.nonce !== "string") throw rpcError.invalidParams("signMessage needs message and nonce.");
    try {
      const res = (await this.#transport.request("aptos", AptosSignMessageNamespace, {
        inputs: [
          {
            account: me.address.toStringLong(),
            message: input.message,
            nonce: input.nonce,
            address: input.address === true,
            application: input.application === true,
            chainId: input.chainId === true,
          },
        ],
      })) as Omit<AptosSignMessageOutput, "signature"> & { signature: string };
      return { status: UserResponseStatus.APPROVED, args: { ...res, signature: new Ed25519Signature(res.signature) } };
    } catch (e) {
      return rejected(e);
    }
  };
}
