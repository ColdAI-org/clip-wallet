/**
 * Bitcoin Wallet Standard feature types.
 *
 * Mirrors the shapes published by `@exodus/bitcoin-wallet-standard-features` (bitcoin:connect,
 * Apache-2.0) and `@metamask/bitcoin-wallet-standard@1.3.0` (bitcoin:connect, bitcoin:disconnect,
 * bitcoin:events, bitcoin:signTransaction, bitcoin:signAndSendTransaction, bitcoin:signMessage and
 * the "sats-connect:" provider feature, MIT). Declared locally so the page bundle does not pull in a
 * vendor client. Keep in sync with those packages.
 */
import type { IdentifierString, Wallet, WalletAccount } from "@wallet-standard/base";

export const BitcoinConnect = "bitcoin:connect";
export const BitcoinDisconnect = "bitcoin:disconnect";
export const BitcoinEvents = "bitcoin:events";
export const BitcoinSignTransaction = "bitcoin:signTransaction";
export const BitcoinSignAndSendTransaction = "bitcoin:signAndSendTransaction";
export const BitcoinSignMessage = "bitcoin:signMessage";
export const BitcoinSatsConnect = "sats-connect:";

export type BitcoinAddressPurpose = "ordinals" | "payment";

export interface BitcoinConnectInput {
  readonly purposes: BitcoinAddressPurpose[];
}
export interface BitcoinConnectOutput {
  readonly accounts: readonly WalletAccount[];
}

export type BitcoinSigHashFlag =
  | "ALL"
  | "NONE"
  | "SINGLE"
  | "ALL|ANYONECANPAY"
  | "NONE|ANYONECANPAY"
  | "SINGLE|ANYONECANPAY";

export interface InputToSign {
  readonly account: WalletAccount;
  readonly signingIndexes: number[];
  readonly sigHash?: BitcoinSigHashFlag;
}

export interface BitcoinSignTransactionInput {
  readonly psbt: Uint8Array;
  readonly inputsToSign: InputToSign[];
  readonly chain?: IdentifierString;
}
export interface BitcoinSignTransactionOutput {
  readonly signedPsbt: Uint8Array;
}
export interface BitcoinSignAndSendTransactionInput extends BitcoinSignTransactionInput {
  readonly chain: IdentifierString;
}
export interface BitcoinSignAndSendTransactionOutput {
  readonly txId: string;
}
export interface BitcoinSignMessageInput {
  readonly account: WalletAccount;
  readonly message: Uint8Array;
}
export interface BitcoinSignMessageOutput {
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
}

export interface BitcoinEventsListeners {
  change(properties: { chains?: Wallet["chains"]; features?: Wallet["features"]; accounts?: Wallet["accounts"] }): void;
}

/** JSON-RPC 2.0 envelope sats-connect v4 expects back from `provider.request`. */
export type SatsConnectResponse =
  | { jsonrpc: "2.0"; id: string | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | null; error: { code: number; message: string } };

/** Subset of sats-connect v4 `BitcoinProvider` that 1Mask implements (the `request` path). */
export interface SatsConnectProvider {
  request(method: string, params?: unknown, providerId?: string): Promise<SatsConnectResponse>;
}

export type ClipBitcoinFeatures = {
  readonly [BitcoinConnect]: {
    readonly version: "1.0.0";
    readonly connect: (input: BitcoinConnectInput) => Promise<BitcoinConnectOutput>;
  };
  readonly [BitcoinDisconnect]: { readonly version: "1.0.0"; readonly disconnect: () => Promise<void> };
  readonly [BitcoinEvents]: {
    readonly version: "1.0.0";
    readonly on: (event: "change", listener: BitcoinEventsListeners["change"]) => () => void;
  };
  readonly [BitcoinSignTransaction]: {
    readonly version: "1.0.0";
    readonly signTransaction: (
      ...inputs: readonly BitcoinSignTransactionInput[]
    ) => Promise<readonly BitcoinSignTransactionOutput[]>;
  };
  readonly [BitcoinSignAndSendTransaction]: {
    readonly version: "1.0.0";
    readonly signAndSendTransaction: (
      ...inputs: readonly BitcoinSignAndSendTransactionInput[]
    ) => Promise<readonly BitcoinSignAndSendTransactionOutput[]>;
  };
  readonly [BitcoinSignMessage]: {
    readonly version: "1.0.0";
    readonly signMessage: (...inputs: readonly BitcoinSignMessageInput[]) => Promise<readonly BitcoinSignMessageOutput[]>;
  };
  readonly [BitcoinSatsConnect]: { readonly provider: SatsConnectProvider };
};
