/**
 * Clip Wallet for NEAR Wallet Selector (@near-wallet-selector/core v10), as an injected-wallet module:
 *
 *   import { setupWalletSelector } from "@near-wallet-selector/core";
 *   import { setupClipWallet } from "@clip-wallet/kit-modules/near";
 *   const selector = await setupWalletSelector({ network: "testnet", modules: [setupClipWallet()] });
 *
 * It talks to the provider 1Mask injects at `window.clipwallet.near` (packages/1mask/src/inpage/near.ts).
 * Module shape: `WalletModuleFactory<InjectedWallet>` from @near-wallet-selector/core
 * (src/lib/wallet/wallet.types.d.ts). Actions are sent as wallet-selector `InternalAction` JSON (NAJ
 * `Action` objects are converted with the core's own `najActionToInternal`); bytes travel base64 as
 * `argsBase64` / `codeBase64`.
 */
import type {
  Account,
  InjectedWallet,
  Action,
  SignMessageParams,
  WalletBehaviourFactory,
  WalletModuleFactory,
} from "@near-wallet-selector/core";
import { najActionToInternal } from "@near-wallet-selector/core";
import { PublicKey } from "@near-js/crypto";
import { CLIP_WALLET_GLOBAL } from "../index.js";
import { CLIP_ICON, announcedIdentity, b64, fromB64 } from "../shared.js";

export const CLIP_WALLET_NEAR_ID = "clip-wallet";

/** The injected provider (structural copy of 1Mask's ClipNearProvider surface). */
export interface ClipNearInjected {
  isClipWallet: true;
  name: string;
  icon: string;
  supportedNetworks: string[];
  accounts: { accountId: string; publicKey?: string }[];
  signIn(input: { networkId?: string; contractId?: string; methodNames?: string[] }): Promise<{ accountId: string; publicKey?: string }[]>;
  signOut(): Promise<void>;
  getAccounts(): Promise<{ accountId: string; publicKey?: string }[]>;
  signAndSendTransaction(tx: { signerId?: string; receiverId: string; actions: WireAction[]; networkId?: string }): Promise<unknown>;
  signAndSendTransactions(input: { transactions: { signerId?: string; receiverId: string; actions: WireAction[] }[]; networkId?: string }): Promise<unknown[]>;
  signMessage(input: { message: string; recipient: string; nonce: string; callbackUrl?: string; state?: string; networkId?: string }): Promise<{
    accountId: string;
    publicKey: string;
    signature: string;
    state?: string;
  }>;
  on(event: "accountsChanged" | "disconnect", cb: (...args: any[]) => void): () => void;
}

interface TxParams {
  signerId?: string;
  receiverId?: string;
  actions: Action[];
}

export interface WireAction {
  type: string;
  params?: Record<string, unknown>;
}

export interface ClipWalletNearParams {
  iconUrl?: string;
  /** Where "Get Clip Wallet" links when it isn't installed. */
  downloadUrl?: string;
  deprecated?: boolean;
  /** Kit-built wallets inject under their own global. Default "clipwallet". */
  globalKey?: string;
}

const str = (v: unknown) => (typeof v === "bigint" || typeof v === "number" ? v.toString() : (v as string));

/** wallet-selector InternalAction or near-api-js Action → JSON the wallet accepts. */
export function toWireAction(action: unknown): WireAction {
  const a = action as { type?: unknown; params?: Record<string, unknown> };
  const internal = (typeof a.type === "string" ? a : najActionToInternal(action as never)) as { type: string; params?: Record<string, unknown> };
  const params = { ...(internal.params ?? {}) };
  switch (internal.type) {
    case "FunctionCall": {
      const args = params.args;
      delete params.args;
      if (args instanceof Uint8Array) params.argsBase64 = b64(args);
      else params.args = args ?? {};
      params.gas = str(params.gas);
      params.deposit = str(params.deposit);
      break;
    }
    case "DeployContract": {
      const code = params.code;
      delete params.code;
      if (code instanceof Uint8Array) params.codeBase64 = b64(code);
      break;
    }
    case "Transfer":
      params.deposit = str(params.deposit);
      break;
    case "Stake":
      params.stake = str(params.stake);
      params.publicKey = String(params.publicKey);
      break;
    case "AddKey":
    case "DeleteKey":
      params.publicKey = String(params.publicKey);
      break;
  }
  return Object.keys(params).length ? { type: internal.type, params } : { type: internal.type };
}

function providerAt(globalKey: string): ClipNearInjected | undefined {
  if (typeof window === "undefined") return undefined;
  const p = (window as unknown as Record<string, { near?: ClipNearInjected } | undefined>)[globalKey]?.near;
  return p && p.isClipWallet ? p : undefined;
}

const unsupported = (what: string) => async (): Promise<never> => {
  throw new Error(`Clip Wallet doesn't support ${what}. Use signAndSendTransaction(s) — Clip signs and sends in one approved step.`);
};

const ClipWalletBehaviour: WalletBehaviourFactory<InjectedWallet, { clip: ClipNearInjected }> = async ({ options, store, emitter, clip: provider }) => {
  const networkId = options.network.networkId;
  const toAccounts = (list: { accountId: string; publicKey?: string }[]): Account[] =>
    list.map((a) => (a.publicKey ? { accountId: a.accountId, publicKey: a.publicKey } : { accountId: a.accountId }));

  provider.on("accountsChanged", (list: { accountId: string; publicKey?: string }[]) => emitter.emit("accountsChanged", { accounts: toAccounts(list) }));
  provider.on("disconnect", () => emitter.emit("signedOut", null));

  const receiver = (receiverId?: string) => {
    const r = receiverId ?? store.getState().contract?.contractId;
    if (!r) throw new Error("No receiverId given and no contract was set when signing in.");
    return r;
  };

  const signMessage = async ({ message, recipient, nonce, callbackUrl, state }: SignMessageParams) => {
    const input: Parameters<ClipNearInjected["signMessage"]>[0] = { message, recipient, nonce: b64(nonce), networkId };
    if (callbackUrl !== undefined) input.callbackUrl = callbackUrl;
    if (state !== undefined) input.state = state;
    return provider.signMessage(input);
  };

  const behaviour = {
    async signIn({ contractId, methodNames }: { contractId?: string; methodNames?: string[] }) {
      const input: { networkId: string; contractId?: string; methodNames?: string[] } = { networkId };
      if (contractId) input.contractId = contractId;
      if (methodNames) input.methodNames = methodNames;
      return toAccounts(await provider.signIn(input));
    },
    async signOut() {
      await provider.signOut();
    },
    async getAccounts() {
      return toAccounts(await provider.getAccounts());
    },
    async verifyOwner(): Promise<never> {
      throw new Error("verifyOwner is deprecated. Use signMessage (NEP-413).");
    },
    signMessage,
    async signAndSendTransaction({ signerId, receiverId, actions }: TxParams) {
      const tx: Parameters<ClipNearInjected["signAndSendTransaction"]>[0] = { receiverId: receiver(receiverId), actions: actions.map(toWireAction), networkId };
      if (signerId) tx.signerId = signerId;
      return provider.signAndSendTransaction(tx);
    },
    async signAndSendTransactions({ transactions }: { transactions: TxParams[] }) {
      return provider.signAndSendTransactions({
        networkId,
        transactions: transactions.map((t) => {
          const out: { signerId?: string; receiverId: string; actions: WireAction[] } = { receiverId: receiver(t.receiverId), actions: t.actions.map(toWireAction) };
          if (t.signerId) out.signerId = t.signerId;
          return out;
        }),
      });
    },
    /** @near-js/signers Signer: the connected account's key. */
    async getPublicKey() {
      const key = provider.accounts[0]?.publicKey;
      if (!key) throw new Error("Connect Clip Wallet first.");
      return PublicKey.fromString(key);
    },
    /** @near-js/signers Signer: NEP-413 through the same approval as signMessage. */
    async signNep413Message(message: string, accountId: string, recipient: string, nonce: Uint8Array, callbackUrl?: string) {
      const input: Parameters<ClipNearInjected["signMessage"]>[0] = { message, recipient, nonce: b64(nonce), networkId };
      if (callbackUrl !== undefined) input.callbackUrl = callbackUrl;
      const signed = await provider.signMessage(input);
      if (signed.accountId !== accountId) throw new Error(`Clip Wallet signed as ${signed.accountId}, not ${accountId}.`);
      return { accountId: signed.accountId, publicKey: PublicKey.fromString(signed.publicKey), signature: fromB64(signed.signature) };
    },
    signTransaction: unsupported("returning signed transactions"),
    signDelegateAction: unsupported("meta-transactions (delegate actions)"),
    createSignedTransaction: unsupported("returning signed transactions"),
  };
  return behaviour as unknown as Omit<InjectedWallet, "id" | "type" | "metadata">;
};

export function setupClipWallet(params: ClipWalletNearParams = {}): WalletModuleFactory<InjectedWallet> {
  const globalKey = params.globalKey ?? CLIP_WALLET_GLOBAL;
  return async ({ options }) => {
    const provider = providerAt(globalKey);
    const announced = announcedIdentity(globalKey);
    const available = !!provider && provider.supportedNetworks.includes(options.network.networkId);
    return {
      id: CLIP_WALLET_NEAR_ID,
      type: "injected",
      metadata: {
        name: provider?.name ?? announced.name ?? "Clip Wallet",
        description: "Non-custodial wallet for every CLPR network.",
        iconUrl: params.iconUrl ?? provider?.icon ?? announced.icon ?? CLIP_ICON,
        downloadUrl: params.downloadUrl ?? "https://coldai.org/clip-wallet",
        deprecated: params.deprecated ?? false,
        available,
      },
      init: (config) => ClipWalletBehaviour({ ...config, clip: providerAt(globalKey)! }),
    };
  };
}
