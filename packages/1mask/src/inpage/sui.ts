import type { Network } from "@clip-wallet/core";
import {
  SuiSignAndExecuteTransaction,
  SuiSignPersonalMessage,
  SuiSignTransaction,
  type SuiSignAndExecuteTransactionFeature,
  type SuiSignAndExecuteTransactionInput,
  type SuiSignAndExecuteTransactionOutput,
  type SuiSignPersonalMessageFeature,
  type SuiSignPersonalMessageInput,
  type SuiSignPersonalMessageOutput,
  type SuiSignTransactionFeature,
  type SuiSignTransactionInput,
  type SignedTransaction,
} from "@mysten/wallet-standard";
import type { IdentifierArray } from "@wallet-standard/base";
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
import type { WalletIdentity } from "../shared/config.js";
import { bytesToBase64 } from "../shared/bytes.js";
import { ProviderRpcError, RpcErrorCode, rpcError } from "../shared/errors.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { StandardWalletBase } from "./standard-base.js";
import type { InpageTransport } from "./transport.js";

export type ClipSuiFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SuiSignTransactionFeature &
  SuiSignAndExecuteTransactionFeature &
  SuiSignPersonalMessageFeature;

export const SUI_FEATURES = [
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  SuiSignTransaction,
  SuiSignAndExecuteTransaction,
  SuiSignPersonalMessage,
] as const;

/** DappRequest method names the background allowlists for family "sui" (see docs/phase2/integration/move.md). */
export { SUI_SIGNING_METHODS } from "../shared/move-methods.js";

/**
 * Sui Wallet Standard chains for registry networks. Sui's CAIP-2 ids (`sui:mainnet`, `sui:testnet`, `sui:devnet`)
 * are the Wallet Standard chain ids (@mysten/wallet-standard SUI_CHAINS), so the registry id is used as is.
 */
export function suiChain(net: Network): `sui:${string}` | undefined {
  return net.family === "sui" && /^sui:(mainnet|testnet|devnet|localnet)$/.test(net.id) ? (net.id as `sui:${string}`) : undefined;
}

/**
 * Sui Wallet Standard wallet (@mysten/wallet-standard): sui:signTransaction and sui:signAndExecuteTransaction 2.0.0,
 * sui:signPersonalMessage 1.1.0. Transactions travel as the dapp's `transaction.toJSON()` (the background resolves
 * and builds them, then shows and signs exactly those bytes); messages travel base64. DappRequest params are
 * `{ inputs: [{ account, transaction | message, chain }] }`, like the Solana wallet.
 */
export class ClipSuiWallet extends StandardWalletBase {
  protected readonly family = "sui" as const;
  protected readonly accountFeatures: IdentifierArray = [SuiSignTransaction, SuiSignAndExecuteTransaction, SuiSignPersonalMessage];

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    super(
      identity,
      networks.map(suiChain).filter((c): c is `sui:${string}` => !!c),
      transport,
    );
    this.listen();
  }

  get features(): ClipSuiFeatures {
    return {
      [StandardConnect]: { version: "1.0.0", connect: this.#connect },
      [StandardDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0", on: this.on },
      [SuiSignTransaction]: { version: "2.0.0", signTransaction: this.#signTransaction },
      [SuiSignAndExecuteTransaction]: { version: "2.0.0", signAndExecuteTransaction: this.#signAndExecuteTransaction },
      [SuiSignPersonalMessage]: { version: "1.1.0", signPersonalMessage: this.#signPersonalMessage },
    };
  }

  #connect = async (input?: StandardConnectInput): Promise<StandardConnectOutput> => {
    if (input?.silent) return { accounts: await this.silentAccounts() };
    const res = await this.transport.request("sui", StandardConnect);
    return { accounts: this.setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []) };
  };

  #disconnect = async (): Promise<void> => {
    await this.transport.request("sui", StandardDisconnect);
    this.setAccounts([]);
  };

  #checkChain(chain: string | undefined): void {
    if (chain !== undefined && !this.chains.includes(chain as `${string}:${string}`)) {
      throw rpcError.chainDisconnected(`Clip Wallet does not support ${chain}.`);
    }
  }

  #txInput = async (input: SuiSignTransactionInput) => {
    if (input.signal?.aborted) throw new ProviderRpcError(RpcErrorCode.UserRejected, "The request was cancelled.");
    this.#checkChain(input.chain);
    const account = this.ownAccount(input.account).address;
    const transaction = await input.transaction.toJSON();
    if (typeof transaction !== "string" || !transaction) throw rpcError.invalidParams("The transaction could not be serialised.");
    return { account, transaction, chain: input.chain };
  };

  #signTransaction = async (input: SuiSignTransactionInput): Promise<SignedTransaction> => {
    const wire = await this.#txInput(input);
    const res = (await this.transport.request("sui", SuiSignTransaction, { inputs: [wire] }, input.chain)) as SignedTransaction;
    return { bytes: res.bytes, signature: res.signature };
  };

  #signAndExecuteTransaction = async (input: SuiSignAndExecuteTransactionInput): Promise<SuiSignAndExecuteTransactionOutput> => {
    const wire = await this.#txInput(input);
    const res = (await this.transport.request("sui", SuiSignAndExecuteTransaction, { inputs: [wire] }, input.chain)) as SuiSignAndExecuteTransactionOutput;
    return { bytes: res.bytes, signature: res.signature, digest: res.digest, effects: res.effects };
  };

  #signPersonalMessage = async (input: SuiSignPersonalMessageInput): Promise<SuiSignPersonalMessageOutput> => {
    this.#checkChain(input.chain);
    const wire: Record<string, unknown> = { account: this.ownAccount(input.account).address, message: bytesToBase64(input.message) };
    if (input.chain) wire.chain = input.chain;
    const res = (await this.transport.request("sui", SuiSignPersonalMessage, { inputs: [wire] }, input.chain)) as SuiSignPersonalMessageOutput;
    return { bytes: res.bytes, signature: res.signature };
  };
}
