import type { Family, Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import { ProviderRpcError, RpcErrorCode } from "../shared/errors.js";
import {
  COSMOS_FAMILIES,
  COSMOS_INJECTED,
  type CosmosChainInfoWithoutEndpoints,
  type CosmosFamily,
  type CosmosKeyWire,
  chainInfoWithoutEndpoints,
  cosmosChainOf,
  b64FromBytes,
  bytesFromB64,
} from "../shared/cosmos.js";
import { bytesOfHex } from "../shared/cosmos-bech32.js";
import { Emitter } from "./emitter.js";
import { DEFAULT_GLOBAL_KEY, exposeOnGlobal, type InjectedOptions } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Keplr-compatible Cosmos provider at `window.clipwallet.cosmos` (never `window.keplr`: Clip announces its own
 * identity). Method names, arguments and results follow Keplr's `Keplr` interface (@keplr-wallet/types 0.13.41
 * src/wallet/keplr.ts; https://docs.keplr.app/api/guide/enable-connection, get-key, sign-a-message, sign-arbitrary,
 * broadcast-tx, suggest-chain, https://docs.keplr.app/api/use-with/cosmjs), so a dapp written for Keplr works by
 * swapping `window.keplr` for this object. Offline signers follow @keplr-wallet/provider 0.13.41 src/cosmjs.ts
 * (chain-id and signer checks before signing; getAccounts reports algo "secp256k1", as Keplr does).
 *
 * Every chain id maps to one Clip family by the wallet's network list ("cosmos:<chain-id>"), so permissions,
 * accounts and approvals are per family; the background re-checks everything. Holds no secrets.
 *
 * Account changes: `on("keystorechange", …)` and a window event `<globalKey>_keystorechange` (Keplr's documented
 * equivalent is `keplr_keystorechange`, https://docs.keplr.app/api/guide/custom-event; Clip doesn't fire Keplr's).
 */

/** Keplr Key (types/src/wallet/keplr.ts L29-42). */
export interface CosmosKey {
  readonly name: string;
  readonly algo: string;
  readonly pubKey: Uint8Array;
  readonly address: Uint8Array;
  readonly bech32Address: string;
  readonly ethereumHexAddress: string;
  readonly isNanoLedger: boolean;
  readonly isKeystone: boolean;
}

export interface KeplrSignOptions {
  readonly preferNoSetFee?: boolean;
  readonly preferNoSetMemo?: boolean;
  readonly disableBalanceCheck?: boolean;
}

export interface StdSignature {
  readonly pub_key: { readonly type: string; readonly value: string };
  readonly signature: string;
}

/** cosmjs StdSignDoc (amino JSON). */
export interface StdSignDoc {
  readonly chain_id: string;
  readonly account_number: string;
  readonly sequence: string;
  readonly timeout_height?: string;
  readonly fee: { readonly amount: readonly { denom: string; amount: string }[]; readonly gas: string; readonly payer?: string; readonly granter?: string };
  readonly msgs: readonly { type: string; value: unknown }[];
  readonly memo: string;
}

/** Account number as Keplr passes it (a `long` Long), a bigint (cosmjs ≥ 0.32 / cosmjs-types), a number or a string. */
type AccountNumber = { toString(): string } | bigint | number | string | null | undefined;

export interface DirectSignDoc {
  bodyBytes?: Uint8Array | null;
  authInfoBytes?: Uint8Array | null;
  chainId?: string | null;
  accountNumber?: AccountNumber;
}

export interface AccountData {
  readonly address: string;
  readonly algo: "secp256k1";
  readonly pubkey: Uint8Array;
}

export type BroadcastMode = "block" | "sync" | "async";

const enc = new TextEncoder();

function plainError(message: string, code: number = RpcErrorCode.InvalidParams): ProviderRpcError {
  return new ProviderRpcError(code, message);
}

export class ClipCosmosProvider {
  readonly isClipWallet = true;
  readonly name: string;
  readonly icon: string;
  /** Keplr fields: version, mode, defaultOptions (pages may change defaultOptions, as with Keplr). */
  readonly version = "0.12.0";
  readonly mode = "extension" as const;
  defaultOptions: { sign?: KeplrSignOptions } = {};

  readonly #identity: WalletIdentity;
  readonly #networks: Network[];
  readonly #transport: InpageTransport;
  readonly #events = new Emitter();
  readonly #keys = new Map<string, CosmosKey>();
  readonly #fire: () => void;

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport, fire: () => void) {
    this.#identity = identity;
    this.name = identity.name;
    this.icon = identity.icon;
    this.#networks = networks.filter((n) => (COSMOS_FAMILIES as readonly string[]).includes(n.family));
    this.#transport = transport;
    this.#fire = fire;
    transport.onEvent((family, event) => {
      if (!(COSMOS_FAMILIES as readonly Family[]).includes(family)) return;
      if (event !== "accountsChanged" && event !== "disconnect") return;
      for (const chainId of [...this.#keys.keys()]) if (this.#familyOf(chainId) === family) this.#keys.delete(chainId);
      this.#events.emit("keystorechange");
      this.#fire();
    });
  }

  #familyOf(chainId: string): CosmosFamily {
    if (typeof chainId !== "string" || !chainId) throw plainError("chain id not set");
    const net = this.#networks.find((n) => n.id === `cosmos:${chainId}`);
    if (!net || !cosmosChainOf(chainId)) throw plainError(`There is no chain info for ${chainId}`, RpcErrorCode.UnrecognizedChain);
    return net.family as CosmosFamily;
  }

  #request(chainId: string, method: string, params?: unknown): Promise<unknown> {
    return this.#transport.request(this.#familyOf(chainId), method, params, `cosmos:${chainId}`);
  }

  /** Keplr enable(chainIds): one connect approval per family not yet connected. */
  async enable(chainIds: string | string[]): Promise<void> {
    const ids = typeof chainIds === "string" ? [chainIds] : chainIds;
    if (!Array.isArray(ids) || ids.length === 0) throw plainError("chain id not set");
    const byFamily = new Map<CosmosFamily, string[]>();
    for (const id of ids) {
      const f = this.#familyOf(id);
      byFamily.set(f, [...(byFamily.get(f) ?? []), id]);
    }
    for (const [, list] of byFamily) {
      const first = list[0]!;
      const have = (await this.#request(first, COSMOS_INJECTED.accounts)) as unknown[];
      if (!Array.isArray(have) || have.length === 0) await this.#request(first, COSMOS_INJECTED.enable, { chainIds: list });
    }
  }

  /** Keplr disable(chainIds?): forgets this site's permission for those chains' families (all when omitted). */
  async disable(chainIds?: string | string[]): Promise<void> {
    const ids = chainIds === undefined ? undefined : typeof chainIds === "string" ? [chainIds] : chainIds;
    const families = new Set<CosmosFamily>();
    if (ids) for (const id of ids) families.add(this.#familyOf(id));
    else for (const n of this.#networks) families.add(n.family as CosmosFamily);
    for (const f of families) {
      const chainId = this.#networks.find((n) => n.family === f)!.id.slice("cosmos:".length);
      await this.#request(chainId, COSMOS_INJECTED.disable);
    }
    this.#keys.clear();
  }

  async getKey(chainId: string): Promise<CosmosKey> {
    const k = (await this.#request(chainId, COSMOS_INJECTED.getKey)) as CosmosKeyWire;
    const key: CosmosKey = Object.freeze({
      name: this.#identity.name,
      algo: k.algo,
      pubKey: bytesOfHex(k.pubKey),
      address: bytesOfHex(k.address),
      bech32Address: k.bech32Address,
      ethereumHexAddress: k.ethereumHexAddress,
      isNanoLedger: false,
      isKeystone: false,
    });
    this.#keys.set(chainId, key);
    return key;
  }

  async signDirect(chainId: string, signer: string, signDoc: DirectSignDoc, _signOptions?: KeplrSignOptions): Promise<{ signed: DirectSignDoc & { bodyBytes: Uint8Array; authInfoBytes: Uint8Array; chainId: string }; signature: StdSignature }> {
    if (!signDoc || typeof signDoc !== "object") throw plainError("Expected a sign doc.");
    const accountNumber = signDoc.accountNumber === null || signDoc.accountNumber === undefined ? "0" : String(signDoc.accountNumber);
    const wire = {
      bodyBytes: b64FromBytes(signDoc.bodyBytes ?? new Uint8Array()),
      authInfoBytes: b64FromBytes(signDoc.authInfoBytes ?? new Uint8Array()),
      chainId: signDoc.chainId ?? "",
      accountNumber,
    };
    const res = (await this.#request(chainId, COSMOS_INJECTED.signDirect, { signerAddress: signer, signDoc: wire })) as {
      signed: { bodyBytes: string; authInfoBytes: string; chainId: string; accountNumber: string };
      signature: StdSignature;
    };
    // The account number keeps the caller's own type (Long, bigint…): Clip never changes the doc it signs.
    return {
      signed: { ...signDoc, bodyBytes: bytesFromB64(res.signed.bodyBytes), authInfoBytes: bytesFromB64(res.signed.authInfoBytes), chainId: res.signed.chainId },
      signature: res.signature,
    };
  }

  async signAmino(chainId: string, signer: string, signDoc: StdSignDoc, _signOptions?: KeplrSignOptions): Promise<{ signed: StdSignDoc; signature: StdSignature }> {
    return (await this.#request(chainId, COSMOS_INJECTED.signAmino, { signerAddress: signer, signDoc })) as { signed: StdSignDoc; signature: StdSignature };
  }

  /** ADR-36 (Keplr signArbitrary): a string is signed as its UTF-8 bytes. */
  async signArbitrary(chainId: string, signer: string, data: string | Uint8Array): Promise<StdSignature> {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    if (!(bytes instanceof Uint8Array)) throw plainError("Expected a string or bytes.");
    return (await this.#request(chainId, COSMOS_INJECTED.signArbitrary, { signer, data: b64FromBytes(bytes), isString: typeof data === "string" })) as StdSignature;
  }

  async verifyArbitrary(chainId: string, signer: string, data: string | Uint8Array, signature: StdSignature): Promise<boolean> {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    return (await this.#request(chainId, COSMOS_INJECTED.verifyArbitrary, { signer, data: b64FromBytes(bytes), signature })) === true;
  }

  /** Keplr sendTx: broadcasts signed tx bytes; resolves to the tx hash bytes. */
  async sendTx(chainId: string, tx: Uint8Array, mode: BroadcastMode): Promise<Uint8Array> {
    if (!(tx instanceof Uint8Array)) throw plainError("Expected the signed transaction bytes.");
    const res = (await this.#request(chainId, COSMOS_INJECTED.sendTx, { tx: b64FromBytes(tx), mode })) as { txhash: string };
    return bytesOfHex(res.txhash);
  }

  getOfflineSigner(chainId: string, signOptions?: KeplrSignOptions) {
    return new ClipOfflineSigner(this, chainId, signOptions);
  }

  getOfflineSignerOnlyAmino(chainId: string, signOptions?: KeplrSignOptions) {
    return new ClipOfflineSignerOnlyAmino(this, chainId, signOptions);
  }

  /** Clip has no Ledger accounts here, so this is always the direct + amino signer (Keplr returns it unless isNanoLedger). */
  async getOfflineSignerAuto(chainId: string, signOptions?: KeplrSignOptions) {
    await this.getKey(chainId);
    return new ClipOfflineSigner(this, chainId, signOptions);
  }

  /** Chains this wallet ships, without endpoints (Keplr ChainInfoWithoutEndpoints). */
  async getChainInfosWithoutEndpoints(): Promise<CosmosChainInfoWithoutEndpoints[]> {
    return this.#networks.flatMap((n) => {
      const info = chainInfoWithoutEndpoints(n.id.slice("cosmos:".length));
      return info ? [info] : [];
    });
  }

  async getChainInfoWithoutEndpoints(chainId: string): Promise<CosmosChainInfoWithoutEndpoints> {
    this.#familyOf(chainId);
    return chainInfoWithoutEndpoints(chainId)!;
  }

  /** Clip only works with the chains it ships: a known chain resolves, anything else is refused in plain words. */
  async experimentalSuggestChain(chainInfo: { chainId?: unknown }): Promise<void> {
    const id = chainInfo && typeof chainInfo.chainId === "string" ? chainInfo.chainId : "";
    if (id && this.#networks.some((n) => n.id === `cosmos:${id}`)) return;
    throw plainError(`${this.#identity.name} doesn't support ${id || "this chain"} and can't add chains from websites.`, RpcErrorCode.UnsupportedMethod);
  }

  on(event: "keystorechange", listener: () => void): () => void {
    this.#events.on(event, listener);
    return () => this.#events.removeListener(event, listener);
  }

  off(event: "keystorechange", listener: () => void): void {
    this.#events.removeListener(event, listener);
  }
}

/** cosmjs OfflineAminoSigner over the provider (Keplr CosmJSOfflineSignerOnlyAmino). */
export class ClipOfflineSignerOnlyAmino {
  constructor(
    protected readonly provider: ClipCosmosProvider,
    readonly chainId: string,
    protected readonly signOptions?: KeplrSignOptions,
  ) {}

  async getAccounts(): Promise<AccountData[]> {
    const key = await this.provider.getKey(this.chainId);
    return [{ address: key.bech32Address, algo: "secp256k1", pubkey: key.pubKey }];
  }

  async signAmino(signerAddress: string, signDoc: StdSignDoc) {
    if (this.chainId !== signDoc.chain_id) throw new Error("Unmatched chain id with the offline signer");
    const key = await this.provider.getKey(signDoc.chain_id);
    if (key.bech32Address !== signerAddress) throw new Error("Unknown signer address");
    return this.provider.signAmino(this.chainId, signerAddress, signDoc, this.signOptions);
  }

  /** Legacy cosmjs name. */
  sign(signerAddress: string, signDoc: StdSignDoc) {
    return this.signAmino(signerAddress, signDoc);
  }
}

/** cosmjs OfflineDirectSigner & OfflineAminoSigner (Keplr CosmJSOfflineSigner). */
export class ClipOfflineSigner extends ClipOfflineSignerOnlyAmino {
  async signDirect(signerAddress: string, signDoc: DirectSignDoc & { chainId: string }) {
    if (this.chainId !== signDoc.chainId) throw new Error("Unmatched chain id with the offline signer");
    const key = await this.provider.getKey(signDoc.chainId);
    if (key.bech32Address !== signerAddress) throw new Error("Unknown signer address");
    return this.provider.signDirect(this.chainId, signerAddress, signDoc, this.signOptions);
  }
}

export function installCosmosProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions = {},
): { provider: ClipCosmosProvider; stop(): void } {
  const globalKey = opts.globalKey ?? DEFAULT_GLOBAL_KEY;
  const fire = () => {
    try {
      const E = (win as unknown as { Event?: typeof Event }).Event ?? Event;
      win.dispatchEvent(new E(`${globalKey}_keystorechange`));
    } catch {
      /* no Event constructor (tests) */
    }
  };
  const provider = new ClipCosmosProvider(identity, networks, transport, fire);
  const stop = exposeOnGlobal(win, globalKey, "cosmos", provider, identity);
  return { provider, stop };
}
