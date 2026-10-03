import type { Network } from "@clip-wallet/core";
import type { IdentifierArray } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import type { WalletIdentity } from "../shared/config.js";
import { base64ToBytes, bytesToBase64 } from "../shared/bytes.js";
import { rpcError, toRpcErrorShape } from "../shared/errors.js";
import { walletStandardChain } from "../shared/networks.js";
import type { ExposedAccount } from "../shared/protocol.js";
import {
  BitcoinConnect,
  BitcoinDisconnect,
  BitcoinEvents,
  BitcoinSatsConnect,
  BitcoinSignAndSendTransaction,
  BitcoinSignMessage,
  BitcoinSignTransaction,
  type BitcoinAddressPurpose,
  type BitcoinConnectInput,
  type BitcoinConnectOutput,
  type BitcoinSignAndSendTransactionInput,
  type BitcoinSignAndSendTransactionOutput,
  type BitcoinSignMessageInput,
  type BitcoinSignMessageOutput,
  type BitcoinSignTransactionInput,
  type BitcoinSignTransactionOutput,
  type ClipBitcoinFeatures,
  type SatsConnectProvider,
  type SatsConnectResponse,
} from "./bitcoin-features.js";
import { StandardWalletBase } from "./standard-base.js";
import type { InpageTransport } from "./transport.js";

/** Canonical DappRequest methods the background sees for Bitcoin (sats-connect calls are mapped onto these). */
export const BITCOIN_METHODS = {
  connect: BitcoinConnect,
  disconnect: BitcoinDisconnect,
  signTransaction: BitcoinSignTransaction,
  signAndSendTransaction: BitcoinSignAndSendTransaction,
  signMessage: BitcoinSignMessage,
  /** sats-connect `sendTransfer`: the wallet builds the transaction (chains-bitcoin buildTransfer). */
  sendTransfer: "bitcoin:sendTransfer",
} as const;

export const BITCOIN_FEATURES = [
  BitcoinConnect,
  BitcoinDisconnect,
  BitcoinEvents,
  BitcoinSignTransaction,
  BitcoinSignAndSendTransaction,
  BitcoinSignMessage,
  BitcoinSatsConnect,
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
] as const;

type Features = ClipBitcoinFeatures & StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature;

interface WireAccount extends ExposedAccount {
  purpose?: BitcoinAddressPurpose;
  addressType?: string;
}

export class ClipBitcoinWallet extends StandardWalletBase {
  protected readonly family = "bitcoin" as const;
  protected readonly accountFeatures: IdentifierArray = [
    BitcoinConnect,
    BitcoinDisconnect,
    BitcoinSignTransaction,
    BitcoinSignAndSendTransaction,
    BitcoinSignMessage,
    BitcoinSatsConnect,
  ];
  #wire: WireAccount[] = [];
  readonly #satsProvider: SatsConnectProvider;

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    const chains = [
      ...new Set(
        networks
          .filter((n) => n.family === "bitcoin")
          .map(walletStandardChain)
          .filter((c): c is `${string}:${string}` => !!c),
      ),
    ];
    super(identity, chains, transport);
    this.listen();
    this.#satsProvider = { request: this.#satsRequest };
  }

  get features(): Features {
    return {
      [BitcoinConnect]: { version: "1.0.0", connect: this.#connect },
      [BitcoinDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [BitcoinEvents]: { version: "1.0.0", on: this.on },
      [BitcoinSignTransaction]: { version: "1.0.0", signTransaction: this.#signTransaction },
      [BitcoinSignAndSendTransaction]: { version: "1.0.0", signAndSendTransaction: this.#signAndSendTransaction },
      [BitcoinSignMessage]: { version: "1.0.0", signMessage: this.#signMessage },
      [BitcoinSatsConnect]: { provider: this.#satsProvider },
      [StandardConnect]: {
        version: "1.0.0",
        connect: async (input) =>
          input?.silent ? { accounts: await this.silentAccounts() } : this.#connect({ purposes: ["payment"] }),
      },
      [StandardDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0", on: this.on },
    };
  }

  async #requestConnect(purposes: BitcoinAddressPurpose[]): Promise<WireAccount[]> {
    const clean = [...new Set(purposes.filter((p) => p === "payment" || p === "ordinals"))];
    if (clean.length === 0) throw rpcError.invalidParams("purposes must include 'payment' or 'ordinals'.");
    const res = await this.transport.request("bitcoin", BitcoinConnect, { purposes: clean });
    this.#wire = Array.isArray(res) ? (res as WireAccount[]) : [];
    this.setAccounts(this.#wire);
    return this.#wire;
  }

  #connect = async (input: BitcoinConnectInput): Promise<BitcoinConnectOutput> => {
    await this.#requestConnect(input?.purposes ?? ["payment"]);
    return { accounts: this.accounts };
  };

  #disconnect = async (): Promise<void> => {
    await this.transport.request("bitcoin", BitcoinDisconnect);
    this.#wire = [];
    this.setAccounts([]);
  };

  #psbtWire(i: BitcoinSignTransactionInput) {
    return {
      psbt: bytesToBase64(i.psbt),
      inputsToSign: i.inputsToSign.map((s) => ({
        address: this.ownAccount(s.account).address,
        signingIndexes: s.signingIndexes,
        sigHash: s.sigHash,
      })),
      chain: i.chain,
    };
  }

  #signTransaction = async (
    ...inputs: readonly BitcoinSignTransactionInput[]
  ): Promise<readonly BitcoinSignTransactionOutput[]> => {
    const res = (await this.transport.request(
      "bitcoin",
      BitcoinSignTransaction,
      { inputs: inputs.map((i) => this.#psbtWire(i)) },
      inputs[0]?.chain,
    )) as { psbt: string }[];
    return res.map((r) => ({ signedPsbt: base64ToBytes(r.psbt) }));
  };

  #signAndSendTransaction = async (
    ...inputs: readonly BitcoinSignAndSendTransactionInput[]
  ): Promise<readonly BitcoinSignAndSendTransactionOutput[]> => {
    const res = (await this.transport.request(
      "bitcoin",
      BitcoinSignAndSendTransaction,
      { inputs: inputs.map((i) => this.#psbtWire(i)) },
      inputs[0]?.chain,
    )) as { txid: string }[];
    return res.map((r) => ({ txId: r.txid }));
  };

  #signMessage = async (...inputs: readonly BitcoinSignMessageInput[]): Promise<readonly BitcoinSignMessageOutput[]> => {
    const res = (await this.transport.request("bitcoin", BitcoinSignMessage, {
      inputs: inputs.map((i) => ({ address: this.ownAccount(i.account).address, message: bytesToBase64(i.message) })),
    })) as { signature: string; signedMessage?: string }[];
    return res.map((r, idx) => ({
      signature: base64ToBytes(r.signature),
      signedMessage: r.signedMessage ? base64ToBytes(r.signedMessage) : inputs[idx]!.message,
    }));
  };

  /* ------------------------------------------------------------ sats-connect v4 `request` */

  #satsRequest = async (method: string, params?: unknown): Promise<SatsConnectResponse> => {
    try {
      return { jsonrpc: "2.0", id: null, result: await this.#sats(method, (params ?? {}) as Record<string, unknown>) };
    } catch (err) {
      const e = toRpcErrorShape(err);
      // sats-connect uses -32000 for user rejection (RpcErrorCode.USER_REJECTION).
      return { jsonrpc: "2.0", id: null, error: { code: e.code === 4001 ? -32000 : e.code, message: e.message } };
    }
  };

  async #sats(method: string, p: Record<string, unknown>): Promise<unknown> {
    const network = () => ({ bitcoin: { name: this.chains.includes("bitcoin:mainnet") ? "Mainnet" : "Testnet" } });
    const toSats = (a: WireAccount) => ({
      address: a.address,
      publicKey: a.publicKey ?? "",
      purpose: a.purpose ?? "payment",
      addressType: a.addressType ?? "p2wpkh",
      walletType: "software",
    });
    switch (method) {
      case "getInfo":
        return {
          version: "1.0.0",
          methods: ["getInfo", "getAddresses", "getAccounts", "wallet_connect", "wallet_disconnect", "signMessage", "signPsbt", "sendTransfer"],
          supports: [],
        };
      case "getAddresses":
      case "getAccounts":
      case "wallet_connect":
      case "wallet_requestPermissions": {
        const purposes = (Array.isArray(p.purposes) ? p.purposes : ["payment"]) as BitcoinAddressPurpose[];
        const accounts = (await this.#requestConnect(purposes)).map(toSats);
        if (method === "wallet_requestPermissions") return true;
        if (method === "getAccounts") return accounts;
        if (method === "getAddresses") return { addresses: accounts, network: network() };
        return { id: "", addresses: accounts, walletType: "software", network: network() };
      }
      case "wallet_disconnect":
      case "wallet_renouncePermissions":
        await this.#disconnect();
        return null;
      case "signMessage": {
        const address = this.ownAddress(typeof p.address === "string" ? p.address : undefined);
        if (typeof p.message !== "string") throw rpcError.invalidParams("message must be a string.");
        const message = bytesToBase64(new TextEncoder().encode(p.message));
        const [r] = (await this.transport.request("bitcoin", BitcoinSignMessage, {
          inputs: [{ address, message, protocol: p.protocol }],
        })) as { signature: string; messageHash?: string; protocol?: string }[];
        return { signature: r!.signature, messageHash: r!.messageHash ?? "", address, protocol: r!.protocol ?? p.protocol };
      }
      case "signPsbt": {
        if (typeof p.psbt !== "string") throw rpcError.invalidParams("psbt must be a base64 string.");
        const signInputs = (p.signInputs ?? {}) as Record<string, number[]>;
        const inputsToSign = Object.entries(signInputs).map(([address, signingIndexes]) => ({
          address: this.ownAddress(address),
          signingIndexes,
        }));
        const broadcast = p.broadcast === true;
        const [r] = (await this.transport.request("bitcoin", broadcast ? BitcoinSignAndSendTransaction : BitcoinSignTransaction, {
          inputs: [{ psbt: p.psbt, inputsToSign }],
        })) as { psbt?: string; txid?: string }[];
        return broadcast ? { psbt: r?.psbt ?? p.psbt, txid: r?.txid } : { psbt: r!.psbt };
      }
      case "sendTransfer": {
        if (!Array.isArray(p.recipients) || p.recipients.length === 0) throw rpcError.invalidParams("recipients required.");
        return this.transport.request("bitcoin", BITCOIN_METHODS.sendTransfer, { recipients: p.recipients });
      }
      default:
        throw rpcError.unsupportedMethod(method);
    }
  }
}
