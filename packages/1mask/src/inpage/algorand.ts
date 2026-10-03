import type { Network } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import { toRpcErrorShape } from "../shared/errors.js";
import { ALGORAND_GENESIS, ALGORAND_INJECTED, algorandChainFromGenesisHash } from "../shared/p2-methods.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { DEFAULT_GLOBAL_KEY, InjectedFamilyBase, exposeOnGlobal, type InjectedOptions } from "./injected-base.js";
import type { InpageTransport } from "./transport.js";

/**
 * Injected Algorand provider at `window.clipwallet.algorand`.
 *
 *  - `signTxns(WalletTransaction[])` is ARC-0001 (Final): base64 msgpack in, `(string | null)[]` out.
 *  - `enable` / `signAndPostTxns` / `disable` follow ARC-0006 / ARC-0008 (both Deprecated, but still what
 *    injected Algorand wallets such as Exodus expose and what TxnLab use-wallet's injected adapters call).
 *  - Errors carry ARC-0001 status codes: 4001 rejected, 4100 unauthorized, 4200 unsupported, 4202 not
 *    enabled, 4300 invalid input.
 * @clip-wallet/kit-modules/algorand wraps it as a use-wallet v5 adapter.
 */

/** ARC-0001 WalletTransaction. */
export interface AlgorandWalletTransaction {
  txn: string;
  authAddr?: string;
  msig?: { version: number; threshold: number; addrs: string[] };
  signers?: string[];
  stxn?: string;
  message?: string;
  groupMessage?: string;
}

export interface AlgorandEnableOpts {
  genesisID?: string;
  genesisHash?: string;
  accounts?: string[];
}

export interface AlgorandEnableResult {
  genesisID: string;
  genesisHash: string;
  accounts: string[];
}

/** ARC-0001 SignTxnsError. */
export class AlgorandProviderError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "SignTxnsError";
  }
}

const ARC1 = { rejected: 4001, unauthorized: 4100, unsupported: 4200, tooMany: 4201, uninitialized: 4202, invalid: 4300 } as const;

function toArc1(err: unknown): AlgorandProviderError {
  if (err instanceof AlgorandProviderError) return err;
  const e = toRpcErrorShape(err);
  const code =
    e.code === 4001 ? ARC1.rejected : e.code === 4100 ? ARC1.unauthorized : e.code === 4200 ? ARC1.unsupported : e.code === -32602 ? ARC1.invalid : e.code;
  return new AlgorandProviderError(code, e.message, e.data);
}

export class ClipAlgorandProvider extends InjectedFamilyBase {
  readonly isClipWallet = true;
  readonly name: string;
  readonly icon: string;
  readonly #networks: Map<string, { genesisID: string; genesisHash: string }>;
  #enabled: { chain: string; genesisID: string; genesisHash: string } | undefined;

  constructor(identity: WalletIdentity, networks: Network[], transport: InpageTransport) {
    super("algorand", transport);
    this.name = identity.name;
    this.icon = identity.icon;
    this.#networks = new Map(
      networks
        .filter((n) => n.family === "algorand" && ALGORAND_GENESIS[n.id])
        .map((n) => [n.id, ALGORAND_GENESIS[n.id]!] as const),
    );
    this.events.on("disconnect", () => (this.#enabled = undefined));
  }

  get isConnected(): boolean {
    return !!this.#enabled && this.accountsCache.length > 0;
  }

  get accounts(): string[] {
    return this.accountsCache.map((a) => a.address);
  }

  #pick(opts: AlgorandEnableOpts): { chain: string; genesisID: string; genesisHash: string } {
    const entries = [...this.#networks.entries()];
    const match = entries.find(
      ([, g]) => (opts.genesisHash === undefined || g.genesisHash === opts.genesisHash) && (opts.genesisID === undefined || g.genesisID === opts.genesisID),
    );
    if (!match) {
      const what = opts.genesisID ?? opts.genesisHash ?? "Algorand";
      throw new AlgorandProviderError(ARC1.unsupported, `Clip Wallet doesn't support the ${what} network.`);
    }
    return { chain: match[0], ...match[1] };
  }

  /** ARC-0006 enable. Prompts once per site; `accounts` (if given) must all be this wallet's. */
  async enable(opts: AlgorandEnableOpts = {}): Promise<AlgorandEnableResult> {
    try {
      const net = this.#pick(opts);
      let list = (await this.request(ALGORAND_INJECTED.accounts, undefined, net.chain)) as ExposedAccount[];
      if (!Array.isArray(list) || list.length === 0) list = (await this.request(ALGORAND_INJECTED.connect, {}, net.chain)) as ExposedAccount[];
      this.setAccounts(Array.isArray(list) ? list : []);
      const accounts = this.accounts;
      const missing = (opts.accounts ?? []).filter((a) => !accounts.includes(a));
      if (missing.length) throw new AlgorandProviderError(ARC1.rejected, "Some requested accounts aren't in this wallet.", { accounts: missing });
      this.#enabled = net;
      const ordered = [...(opts.accounts ?? []), ...accounts.filter((a) => !(opts.accounts ?? []).includes(a))];
      return { genesisID: net.genesisID, genesisHash: net.genesisHash, accounts: ordered };
    } catch (err) {
      throw toArc1(err);
    }
  }

  async disable(): Promise<void> {
    await this.request(ALGORAND_INJECTED.disconnect);
    this.#enabled = undefined;
    this.setAccounts([]);
  }

  #requireEnabled() {
    if (!this.#enabled) throw new AlgorandProviderError(ARC1.uninitialized, "Call enable() first.");
    return this.#enabled;
  }

  #validate(txns: unknown): AlgorandWalletTransaction[] {
    // WalletConnect wraps the group in another array; accept [[...]] too.
    const flat = Array.isArray(txns) && txns.length === 1 && Array.isArray(txns[0]) ? (txns[0] as unknown[]) : txns;
    if (!Array.isArray(flat) || flat.length === 0) throw new AlgorandProviderError(ARC1.invalid, "Expected an array of WalletTransaction.");
    if (flat.length > 16 * 16) throw new AlgorandProviderError(ARC1.tooMany, "Too many transactions in one request.");
    for (const t of flat) {
      if (!t || typeof t !== "object" || typeof (t as { txn?: unknown }).txn !== "string") {
        throw new AlgorandProviderError(ARC1.invalid, "Each WalletTransaction needs a base64 `txn`.");
      }
    }
    return flat as AlgorandWalletTransaction[];
  }

  /** ARC-0001 signTxns. */
  async signTxns(txns: AlgorandWalletTransaction[] | AlgorandWalletTransaction[][]): Promise<(string | null)[]> {
    try {
      const net = this.#requireEnabled();
      const list = this.#validate(txns);
      return (await this.request(ALGORAND_INJECTED.signTxn, list, net.chain)) as (string | null)[];
    } catch (err) {
      throw toArc1(err);
    }
  }

  /** ARC-0008 signAndPostTxns. */
  async signAndPostTxns(txns: AlgorandWalletTransaction[] | AlgorandWalletTransaction[][]): Promise<{ txnIDs: string[] }> {
    try {
      const net = this.#requireEnabled();
      const list = this.#validate(txns);
      const res = (await this.request(ALGORAND_INJECTED.signAndPostTxn, list, net.chain)) as { txId?: string; txIds?: string[] };
      return { txnIDs: res.txIds ?? (res.txId ? [res.txId] : []) };
    } catch (err) {
      throw toArc1(err);
    }
  }

  /** ARC-0007 postTxns is not offered: posting already-signed transactions needs no wallet. */
  async postTxns(): Promise<never> {
    throw new AlgorandProviderError(ARC1.unsupported, "Post signed transactions with your own algod client.");
  }

  /** The CAIP-2 id the provider is enabled on (for debugging and the kit module). */
  get chain(): string | undefined {
    return this.#enabled?.chain;
  }
}

/** Exposed for tests / kit modules that hold a genesis hash. */
export { algorandChainFromGenesisHash };

export function installAlgorandProvider(
  win: Window,
  identity: WalletIdentity,
  networks: Network[],
  transport: InpageTransport,
  opts: InjectedOptions = {},
): { provider: ClipAlgorandProvider; stop(): void } {
  const provider = new ClipAlgorandProvider(identity, networks, transport);
  const stop = exposeOnGlobal(win, opts.globalKey ?? DEFAULT_GLOBAL_KEY, "algorand", provider, identity);
  return { provider, stop };
}
