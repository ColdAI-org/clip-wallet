import type { Network } from "@clip-wallet/core";
import {
  SolanaSignAndSendTransaction,
  SolanaSignIn,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignAndSendTransactionInput,
  type SolanaSignAndSendTransactionOutput,
  type SolanaSignInFeature,
  type SolanaSignInInput,
  type SolanaSignInOutput,
  type SolanaSignMessageFeature,
  type SolanaSignMessageInput,
  type SolanaSignMessageOutput,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
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
import { base64ToBytes, bytesToBase64 } from "../shared/bytes.js";
import { rpcError } from "../shared/errors.js";
import { walletStandardChain } from "../shared/networks.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { StandardWalletBase } from "./standard-base.js";
import type { InpageTransport } from "./transport.js";

export type ClipSolanaFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignTransactionFeature &
  SolanaSignAndSendTransactionFeature &
  SolanaSignMessageFeature &
  SolanaSignInFeature;

export const SOLANA_FEATURES = [
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  SolanaSignTransaction,
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignIn,
] as const;

const SUPPORTED_TX_VERSIONS = ["legacy", 0] as const;

/**
 * Solana Wallet Standard wallet. Bytes go to the background base64-encoded; the DappRequest method is
 * the feature name ("solana:signTransaction", ...) and params are `{ inputs: [...] }`.
 */
export class ClipSolanaWallet extends StandardWalletBase {
  protected readonly family = "solana" as const;
  protected readonly accountFeatures: IdentifierArray = [
    SolanaSignTransaction,
    SolanaSignAndSendTransaction,
    SolanaSignMessage,
    SolanaSignIn,
  ];

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    const chains = networks
      .filter((n) => n.family === "solana")
      .map(walletStandardChain)
      .filter((c): c is `${string}:${string}` => !!c);
    super(identity, chains, transport);
    this.listen();
  }

  get features(): ClipSolanaFeatures {
    return {
      [StandardConnect]: { version: "1.0.0", connect: this.#connect },
      [StandardDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0", on: this.on },
      [SolanaSignTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: SUPPORTED_TX_VERSIONS,
        signTransaction: this.#signTransaction,
      },
      [SolanaSignAndSendTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: SUPPORTED_TX_VERSIONS,
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      [SolanaSignMessage]: { version: "1.0.0", signMessage: this.#signMessage },
      [SolanaSignIn]: { version: "1.0.0", signIn: this.#signIn },
    };
  }

  #connect = async (input?: StandardConnectInput): Promise<StandardConnectOutput> => {
    if (input?.silent) return { accounts: await this.silentAccounts() };
    const res = await this.transport.request("solana", StandardConnect);
    return { accounts: this.setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []) };
  };

  #disconnect = async (): Promise<void> => {
    await this.transport.request("solana", StandardDisconnect);
    this.setAccounts([]);
  };

  #checkChain(chain: string | undefined): void {
    if (chain !== undefined && !this.chains.includes(chain as `${string}:${string}`)) {
      throw rpcError.chainDisconnected(`Clip Wallet does not support ${chain}.`);
    }
  }

  #signTransaction = async (...inputs: readonly SolanaSignTransactionInput[]): Promise<readonly SolanaSignTransactionOutput[]> => {
    const wire = inputs.map((i) => {
      this.#checkChain(i.chain);
      return {
        account: this.ownAccount(i.account).address,
        transaction: bytesToBase64(i.transaction),
        chain: i.chain,
        options: i.options,
      };
    });
    const res = (await this.transport.request("solana", SolanaSignTransaction, { inputs: wire }, inputs[0]?.chain)) as {
      signedTransaction: string;
    }[];
    return res.map((r) => ({ signedTransaction: base64ToBytes(r.signedTransaction) }));
  };

  #signAndSendTransaction = async (
    ...inputs: readonly SolanaSignAndSendTransactionInput[]
  ): Promise<readonly SolanaSignAndSendTransactionOutput[]> => {
    const wire = inputs.map((i) => {
      this.#checkChain(i.chain);
      return {
        account: this.ownAccount(i.account).address,
        transaction: bytesToBase64(i.transaction),
        chain: i.chain,
        options: i.options,
      };
    });
    const res = (await this.transport.request(
      "solana",
      SolanaSignAndSendTransaction,
      { inputs: wire },
      inputs[0]?.chain,
    )) as { signature: string }[];
    return res.map((r) => ({ signature: base64ToBytes(r.signature) }));
  };

  #signMessage = async (...inputs: readonly SolanaSignMessageInput[]): Promise<readonly SolanaSignMessageOutput[]> => {
    const wire = inputs.map((i) => ({ account: this.ownAccount(i.account).address, message: bytesToBase64(i.message) }));
    const res = (await this.transport.request("solana", SolanaSignMessage, { inputs: wire })) as {
      signedMessage: string;
      signature: string;
    }[];
    return res.map((r) => ({
      signedMessage: base64ToBytes(r.signedMessage),
      signature: base64ToBytes(r.signature),
      signatureType: "ed25519" as const,
    }));
  };

  /** Sign In With Solana. Connects as part of signing in (the approval screen covers both). */
  #signIn = async (...inputs: readonly SolanaSignInInput[]): Promise<readonly SolanaSignInOutput[]> => {
    const res = (await this.transport.request("solana", SolanaSignIn, { inputs: inputs.map((i) => ({ ...i })) })) as {
      account: ExposedAccount;
      signedMessage: string;
      signature: string;
    }[];
    const accounts = this.setAccounts(dedupe([...this.accounts.map(toExposed), ...res.map((r) => r.account)]));
    return res.map((r) => {
      const account = accounts.find((a) => a.address === r.account.address);
      if (!account) throw rpcError.internal();
      return {
        account,
        signedMessage: base64ToBytes(r.signedMessage),
        signature: base64ToBytes(r.signature),
        signatureType: "ed25519" as const,
      };
    });
  };
}

function toExposed(a: { address: string; publicKey: ArrayLike<number> }): ExposedAccount {
  return { address: a.address, publicKey: Array.from(a.publicKey, (b) => b.toString(16).padStart(2, "0")).join("") };
}

function dedupe(list: ExposedAccount[]): ExposedAccount[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.address) ? false : (seen.add(a.address), true)));
}
