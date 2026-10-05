/**
 * Polkadot injected-extension connector (@polkadot/extension-inject types):
 *
 *   window.injectedWeb3[name] = { version, enable(originName) → Injected }
 *   Injected = { accounts: { get(anyType?), subscribe(cb) }, metadata: { get(), provide() }, signer: { signPayload, signRaw } }
 *
 * Signatures come back as SignerResult { id, signature (MultiSignature hex, 0x01… for sr25519), signedTransaction? }.
 * `metadata.provide` is refused (false): Clip Wallet reads metadata from the network itself, never from a dapp.
 */
import type { WalletIdentity } from "../shared/config.js";
import { rpcError } from "../shared/errors.js";
import { METHOD_WS_STATE, type ExposedAccount } from "../shared/protocol.js";
import type { InpageTransport } from "./transport.js";

export const SUBSTRATE_INPAGE_METHODS = {
  enable: "substrate_enable",
  disconnect: "substrate_disconnect",
  signPayload: "substrate_signPayload",
  signRaw: "substrate_signRaw",
} as const;

export interface InjectedAccount {
  address: string;
  genesisHash?: string | null;
  name?: string;
  type?: "sr25519" | "ed25519" | "ecdsa" | "ethereum";
}

export interface SignerResult {
  id: number;
  signature: `0x${string}`;
  signedTransaction?: `0x${string}`;
}

export interface SignerPayloadRaw {
  address: string;
  data: string;
  type: "bytes" | "payload";
}

export interface Injected {
  accounts: {
    get(anyType?: boolean): Promise<InjectedAccount[]>;
    subscribe(cb: (accounts: InjectedAccount[]) => void | Promise<void>): () => void;
  };
  metadata: { get(): Promise<{ genesisHash: string; specVersion: number }[]>; provide(def: unknown): Promise<boolean> };
  signer: {
    signPayload(payload: Record<string, unknown>): Promise<SignerResult>;
    signRaw(raw: SignerPayloadRaw): Promise<SignerResult>;
  };
}

export interface InjectedWindowProvider {
  version: string;
  enable(originName: string): Promise<Injected>;
}

/** Key under `window.injectedWeb3` ("Clip Wallet" → "clip-wallet"); dapps list extensions by this name. */
export function substrateExtensionName(identity: WalletIdentity): string {
  return identity.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip-wallet";
}

/** CAIP-2 hint from a 0x genesis hash (polkadot:<first 32 hex chars>), as the background's registry keys it. */
export function caip2FromGenesis(genesisHash: unknown): string | undefined {
  return typeof genesisHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(genesisHash) ? `polkadot:${genesisHash.slice(2, 34).toLowerCase()}` : undefined;
}

export class ClipSubstrateProvider implements InjectedWindowProvider {
  readonly version: string;
  #transport: InpageTransport;
  #name: string;
  #nextId = 0;
  #accounts: InjectedAccount[] = [];
  #subs = new Set<(a: InjectedAccount[]) => void | Promise<void>>();
  #stop: () => void;

  constructor(identity: WalletIdentity, transport: InpageTransport, version = "1.0.0") {
    this.version = version;
    this.#name = identity.name;
    this.#transport = transport;
    this.#stop = transport.onEvent((family, event, data) => {
      if (family !== "substrate") return;
      if (event === "accountsChanged") this.#set(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      if (event === "disconnect") this.#set([]);
    });
    this.enable = this.enable.bind(this);
  }

  #set(list: ExposedAccount[]): InjectedAccount[] {
    const next = list
      .filter((a) => a && typeof a.address === "string")
      .map((a) => ({ address: a.address, genesisHash: null, name: this.#name, type: "sr25519" as const }));
    const changed = next.length !== this.#accounts.length || next.some((a, i) => a.address !== this.#accounts[i]?.address);
    this.#accounts = next;
    if (changed) {
      for (const cb of [...this.#subs]) {
        try {
          void Promise.resolve(cb(next.slice())).catch(() => {});
        } catch {
          /* dapp listener error */
        }
      }
    }
    return next;
  }

  async #silent(): Promise<InjectedAccount[]> {
    const res = await this.#transport.request("substrate", METHOD_WS_STATE);
    return this.#set(Array.isArray(res) ? (res as ExposedAccount[]) : []);
  }

  async enable(originName: string): Promise<Injected> {
    const res = await this.#transport.request("substrate", SUBSTRATE_INPAGE_METHODS.enable, { originName: String(originName ?? "").slice(0, 128) });
    this.#set(Array.isArray(res) ? (res as ExposedAccount[]) : []);
    const own = (address: unknown) => {
      if (typeof address !== "string" || !address) throw rpcError.invalidParams("address is required.");
    };
    return Object.freeze({
      accounts: Object.freeze({
        get: async () => this.#silent(),
        subscribe: (cb: (a: InjectedAccount[]) => void | Promise<void>) => {
          this.#subs.add(cb);
          void this.#silent().then((a) => cb(a.slice()), () => {});
          return () => void this.#subs.delete(cb);
        },
      }),
      metadata: Object.freeze({ get: async () => [], provide: async () => false }),
      signer: Object.freeze({
        signPayload: async (payload: Record<string, unknown>): Promise<SignerResult> => {
          if (!payload || typeof payload !== "object") throw rpcError.invalidParams("payload is required.");
          own(payload.address);
          const r = (await this.#transport.request("substrate", SUBSTRATE_INPAGE_METHODS.signPayload, payload, caip2FromGenesis(payload.genesisHash))) as {
            signature: `0x${string}`;
            signedTransaction?: `0x${string}`;
          };
          return { id: ++this.#nextId, ...r };
        },
        signRaw: async (raw: SignerPayloadRaw): Promise<SignerResult> => {
          if (!raw || typeof raw.data !== "string") throw rpcError.invalidParams("data is required.");
          own(raw.address);
          const r = (await this.#transport.request("substrate", SUBSTRATE_INPAGE_METHODS.signRaw, { address: raw.address, data: raw.data, type: raw.type ?? "bytes" })) as {
            signature: `0x${string}`;
          };
          return { id: ++this.#nextId, signature: r.signature };
        },
      }),
    });
  }

  destroy(): void {
    this.#stop();
    this.#subs.clear();
  }
}

/** Installs `window.injectedWeb3[name]`. Never replaces another extension's entry. */
export function installSubstrate(
  win: Window,
  identity: WalletIdentity,
  transport: InpageTransport,
  opts: { name?: string; version?: string } = {},
): { provider: ClipSubstrateProvider; name: string; destroy(): void } | undefined {
  const name = opts.name ?? substrateExtensionName(identity);
  const w = win as unknown as { injectedWeb3?: Record<string, unknown> };
  if (!w.injectedWeb3 || typeof w.injectedWeb3 !== "object") {
    // Writable, like every other extension's: @polkadot/extension-dapp runs `win.injectedWeb3 = win.injectedWeb3 || {}`
    // in strict mode on import, which throws on a read-only property (found by the compat suite, docs/compat.md).
    Object.defineProperty(win, "injectedWeb3", { value: {}, writable: true, configurable: true, enumerable: true });
  }
  const ns = w.injectedWeb3!;
  if (name in ns) return undefined;
  const provider = new ClipSubstrateProvider(identity, transport, opts.version);
  Object.defineProperty(ns, name, { value: provider, writable: false, configurable: true, enumerable: true });
  return {
    provider,
    name,
    destroy() {
      provider.destroy();
      if (ns[name] === provider) delete ns[name];
    },
  };
}
