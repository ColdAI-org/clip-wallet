import type { Family } from "@clip-wallet/core";
import type { WalletIdentity } from "../shared/config.js";
import type { ExposedAccount } from "../shared/protocol.js";
import { Emitter } from "./emitter.js";
import type { InpageTransport } from "./transport.js";

/**
 * Shared plumbing for the injected NEAR, Stellar and Algorand providers (no cross-wallet discovery
 * standard exists for them, so each is exposed on one namespaced global: `window.clipwallet.<family>`,
 * or `window[<globalKey>].<family>` for kit-built wallets). Tezos uses the Beacon postMessage protocol
 * instead (tezos.ts). Holds no secrets: every call goes to the background router.
 */

/** Default global the providers hang off. Kit-built wallets pass their own key. */
export const DEFAULT_GLOBAL_KEY = "clipwallet";

export interface InjectedOptions {
  /** Global object name: `window[globalKey].<family>`. Default "clipwallet". */
  globalKey?: string;
}

/**
 * Global roots 1Mask created itself (window.clipwallet). The NEAR/Stellar/Algorand providers and the TON
 * Connect bridge share one root, whichever installs first; another wallet's global is never extended by TON.
 */
export const OWN_GLOBAL_ROOTS = new WeakSet<object>();

/** Puts `provider` at window[globalKey][family] (non-writable, so a page script can't swap it silently). */
export function exposeOnGlobal(win: Window, globalKey: string, family: Family, provider: object, identity: WalletIdentity): () => void {
  const w = win as unknown as Record<string, unknown>;
  let root = w[globalKey] as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") {
    root = Object.create(null) as Record<string, unknown>;
    OWN_GLOBAL_ROOTS.add(root);
    Object.defineProperty(win, globalKey, { value: root, configurable: true, enumerable: false, writable: false });
  }
  if (OWN_GLOBAL_ROOTS.has(root) && !Object.prototype.hasOwnProperty.call(root, "info")) {
    Object.defineProperty(root, "info", { value: Object.freeze({ name: identity.name, icon: identity.icon, rdns: identity.rdns }), enumerable: true });
  }
  Object.defineProperty(root, family, { value: provider, configurable: true, enumerable: true, writable: false });
  return () => {
    try {
      delete root![family];
    } catch {
      /* ignore */
    }
  };
}

/** Account cache + accountsChanged/disconnect events for one family. */
export class InjectedFamilyBase {
  protected readonly events = new Emitter();
  protected accountsCache: ExposedAccount[] = [];

  constructor(
    protected readonly family: Family,
    protected readonly transport: InpageTransport,
  ) {
    transport.onEvent((f, event, data) => {
      if (f !== family) return;
      if (event === "accountsChanged") this.setAccounts(Array.isArray(data) ? (data as ExposedAccount[]) : []);
      if (event === "disconnect") {
        this.setAccounts([]);
        this.events.emit("disconnect");
      }
    });
  }

  protected setAccounts(next: ExposedAccount[]): void {
    const clean = next.filter((a) => a && typeof a.address === "string");
    const changed = clean.length !== this.accountsCache.length || clean.some((a, i) => a.address !== this.accountsCache[i]?.address);
    this.accountsCache = clean;
    if (changed) this.events.emit("accountsChanged", this.publicAccounts());
  }

  /** What listeners and getters see; families override to reshape accounts. */
  protected publicAccounts(): unknown {
    return this.accountsCache.map((a) => a.address);
  }

  protected request(method: string, params?: unknown, chain?: string): Promise<unknown> {
    return this.transport.request(this.family, method, params, chain);
  }

  on(event: string, listener: (...args: any[]) => void): () => void {
    this.events.on(event, listener);
    return () => this.events.removeListener(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.events.removeListener(event, listener);
  }
}

/* ------------------------------------------------------------------ encodings (no deps in the page bundle) */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)]! + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

export function base64UrlNoPad(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
