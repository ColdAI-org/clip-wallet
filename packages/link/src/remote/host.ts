/**
 * Wraps a wallet's DappHost (the extension's WalletService) so that, while "Use Clip Desktop" or "Use my phone"
 * is on, every dapp connect and signing request goes to the paired device instead of the local vault. Reads
 * (RPC, chain reads, scam checks, preferred network) stay local: they need no keys.
 *
 * Wiring (extension background, before service.start()):
 *   deps.dapps = withRemoteSigner(deps.dapps, link.remoteHost)  — see docs/r1/integration/connect.md
 */
import type { Account, DappRequest, Family, Warning } from "@clip-wallet/core";
import type { LinkKV } from "../sync/client.js";
import type { RemoteSigner } from "./client.js";

/** Structural copy of @clip-wallet/engine's DappHost (kept here so link doesn't depend on the engine). */
export interface DappHostLike {
  approveConnect(p: { origin: string; family: Family; networkId: string; via: "injected" | "walletconnect"; name?: string; iconUrl?: string; warnings?: Warning[] }): Promise<boolean>;
  request(req: DappRequest, dapp?: { name?: string; iconUrl?: string; warnings?: Warning[] }): Promise<unknown>;
  accountsFor(origin: string, family: Family): Promise<Account[]>;
  preferredNetwork(family: Family): string | undefined;
  cachedAccount(family: Family): Account | undefined;
  permissions: { has(origin: string, family: Family): Promise<boolean>; grant(origin: string, family: Family): Promise<void>; revoke(origin: string, family: Family): Promise<void>; origins(): Promise<string[]> };
  rpc(networkId: string, method: string, params: unknown): Promise<unknown>;
  chainRead(req: DappRequest): Promise<unknown>;
  isUnlocked(): Promise<boolean>;
  cancel(requestId: string): void;
  isKnownScam?(origin: string): boolean;
}

export interface DappConnectorLike {
  start(host: DappHostLike): void;
  attachPort?(port: unknown, senderOrigin?: string): void;
  disconnected(origin: string): void;
  accountsChanged?(): void;
}

interface Grant {
  origin: string;
  family: Family;
  accounts: Account[];
  at: number;
}

export const REMOTE_GRANTS_KEY = "clip/link/remote-grants";

/** Apps connected through the other device, remembered on this device (public data only). */
export class RemoteGrants {
  constructor(private readonly kv: LinkKV) {}
  async all(): Promise<Grant[]> {
    return (await this.kv.get<Grant[]>(REMOTE_GRANTS_KEY)) ?? [];
  }
  async get(origin: string, family: Family): Promise<Grant | undefined> {
    return (await this.all()).find((g) => g.origin === origin && g.family === family);
  }
  async set(g: Grant) {
    const rest = (await this.all()).filter((x) => !(x.origin === g.origin && x.family === g.family));
    await this.kv.set(REMOTE_GRANTS_KEY, [...rest, g].slice(-200));
  }
  async remove(origin: string, family?: Family) {
    await this.kv.set(REMOTE_GRANTS_KEY, (await this.all()).filter((x) => !(x.origin === origin && (!family || x.family === family))));
  }
  async clear() {
    await this.kv.remove(REMOTE_GRANTS_KEY);
  }
}

export interface RemoteMode {
  /** True while the person chose to sign on another device. */
  active(): boolean;
  signer(): RemoteSigner | undefined;
  grants: RemoteGrants;
}

/** A DappHost that routes to the remote signer while remote mode is on, else to `local`. */
export function remoteDappHost(local: DappHostLike, mode: RemoteMode): DappHostLike {
  const cached = new Map<Family, Account>();
  const permissions: DappHostLike["permissions"] = {
    has: async (o, f) => (mode.active() ? !!(await mode.grants.get(o, f)) : local.permissions.has(o, f)),
    grant: async (o, f) => (mode.active() ? undefined : local.permissions.grant(o, f)),
    revoke: async (o, f) => (mode.active() ? mode.grants.remove(o, f) : local.permissions.revoke(o, f)),
    origins: async () => (mode.active() ? [...new Set((await mode.grants.all()).map((g) => g.origin))] : local.permissions.origins()),
  };
  return {
    permissions,
    async approveConnect(p) {
      const s = mode.active() ? mode.signer() : undefined;
      if (!s) return local.approveConnect(p);
      if (p.via === "injected" && (await mode.grants.get(p.origin, p.family))) return true;
      const r = await s.connectApp({ origin: p.origin, family: p.family, networkId: p.networkId, ...(p.name ? { name: p.name } : {}), ...(p.iconUrl ? { iconUrl: p.iconUrl } : {}) });
      if (r.approved && r.accounts.length) {
        await mode.grants.set({ origin: p.origin, family: p.family, accounts: r.accounts, at: Date.now() });
        cached.set(p.family, r.accounts[0]!);
      }
      return r.approved && r.accounts.length > 0;
    },
    async request(req, dapp) {
      const s = mode.active() ? mode.signer() : undefined;
      if (!s) return local.request(req, dapp);
      return s.request(req, { ...(dapp?.name ? { name: dapp.name } : {}), ...(dapp?.iconUrl ? { iconUrl: dapp.iconUrl } : {}) });
    },
    async accountsFor(origin, family) {
      if (!mode.active()) return local.accountsFor(origin, family);
      return (await mode.grants.get(origin, family))?.accounts ?? [];
    },
    preferredNetwork: (f) => local.preferredNetwork(f),
    cachedAccount: (f) => (mode.active() ? cached.get(f) : local.cachedAccount(f)),
    rpc: (n, m, p) => local.rpc(n, m, p),
    chainRead: (r) => local.chainRead(r),
    async isUnlocked() {
      return mode.active() ? true : local.isUnlocked();
    },
    cancel(id) {
      mode.signer()?.cancelRequest(id);
      local.cancel(id);
    },
    ...(local.isKnownScam ? { isKnownScam: (o: string) => local.isKnownScam!(o) } : {}),
  };
}

/** Wraps a 1Mask connector so it gets the remote-aware host. */
export function withRemoteSigner<C extends DappConnectorLike>(connector: C, mode: RemoteMode): C {
  const start = connector.start.bind(connector);
  connector.start = (host: DappHostLike) => start(remoteDappHost(host, mode));
  return connector;
}
