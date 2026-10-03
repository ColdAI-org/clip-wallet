import type { Family } from "@clip-wallet/core";
import type { IdentifierArray, Wallet, WalletAccount, WalletIcon } from "@wallet-standard/base";
import type { StandardEventsChangeProperties, StandardEventsListeners } from "@wallet-standard/features";
import { ReadonlyWalletAccount } from "@wallet-standard/wallet";
import type { WalletIdentity } from "../shared/config.js";
import { hexToBytes } from "../shared/bytes.js";
import { rpcError } from "../shared/errors.js";
import { METHOD_WS_STATE, type ExposedAccount } from "../shared/protocol.js";
import type { InpageTransport } from "./transport.js";

type ChangeListener = StandardEventsListeners["change"];

/**
 * Shared plumbing for the Solana and Bitcoin Wallet Standard wallets: account cache, change events,
 * transport. Subclasses add their family's features.
 */
export abstract class StandardWalletBase implements Wallet {
  readonly version = "1.0.0" as const;
  readonly name: string;
  readonly icon: WalletIcon;
  readonly chains: IdentifierArray;
  protected readonly transport: InpageTransport;
  protected abstract readonly family: Family;
  /** Feature names advertised on each WalletAccount. */
  protected abstract readonly accountFeatures: IdentifierArray;
  #accounts: ReadonlyWalletAccount[] = [];
  #listeners = new Set<ChangeListener>();

  constructor(identity: WalletIdentity, chains: IdentifierArray, transport: InpageTransport) {
    this.name = identity.name;
    this.icon = identity.icon;
    this.chains = chains;
    this.transport = transport;
  }

  abstract get features(): Wallet["features"];

  get accounts(): readonly WalletAccount[] {
    return this.#accounts.slice();
  }

  /** Must be called by subclasses after construction (family is abstract). */
  protected listen(): void {
    this.transport.onEvent((family, event, data) => {
      if (family !== this.family) return;
      if (event === "accountsChanged") this.setAccounts(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      if (event === "disconnect") this.setAccounts([]);
    });
  }

  protected on: (event: "change", listener: ChangeListener) => () => void = (event, listener) => {
    if (event !== "change") return () => {};
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  protected emitChange(props: StandardEventsChangeProperties): void {
    for (const l of [...this.#listeners]) {
      try {
        l(props);
      } catch {
        /* ignore dapp listener errors */
      }
    }
  }

  protected setAccounts(exposed: ExposedAccount[]): readonly WalletAccount[] {
    const next = exposed
      .filter((a) => a && typeof a.address === "string")
      .map((a) => {
        const existing = this.#accounts.find((x) => x.address === a.address);
        if (existing) return existing;
        return new ReadonlyWalletAccount({
          address: a.address,
          publicKey: a.publicKey ? hexToBytes(a.publicKey) : new Uint8Array(),
          chains: this.chains,
          features: this.accountFeatures,
        });
      });
    const changed =
      next.length !== this.#accounts.length || next.some((a, i) => a.address !== this.#accounts[i]?.address);
    this.#accounts = next;
    if (changed) this.emitChange({ accounts: this.accounts });
    return this.accounts;
  }

  /** Silent: returns already-permitted accounts, never prompts. */
  protected async silentAccounts(): Promise<readonly WalletAccount[]> {
    const res = await this.transport.request(this.family, METHOD_WS_STATE);
    return this.setAccounts(Array.isArray(res) ? (res as ExposedAccount[]) : []);
  }

  protected ownAccount(account: WalletAccount | undefined): ReadonlyWalletAccount {
    const own = account && this.#accounts.find((a) => a.address === account.address);
    if (!own) throw rpcError.unauthorized("That account is not connected to this site.");
    return own;
  }

  protected ownAddress(address: string | undefined): string {
    if (!address || !this.#accounts.some((a) => a.address === address)) {
      throw rpcError.unauthorized("That account is not connected to this site.");
    }
    return address;
  }
}
