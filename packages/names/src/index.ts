/**
 * @clip-wallet/names — "alice.eth" / "alice.sol" / "alice.hbar" → an address and the network it implies.
 * Used by Send (background resolveRecipient). Reads only; no keys, no signing.
 */
import type { Family, Network, NetworkId } from "@clip-wallet/core";
import { EnsBackend, type EnsClient } from "./ens.js";
import { HnsBackend } from "./hns.js";
import { SnsBackend } from "./sns.js";
import { ClipHandlesBackend, isClipHandle, type ClipHandlesOptions } from "./clip.js";
import type { Backend, NameResolver, NameService, ResolvedName } from "./types.js";

export type { Backend, NameResolver, NameService, ResolvedName } from "./types.js";
export { EnsBackend, ENS_L2_CHAIN_IDS, isEnsName, type EnsClient, type EnsOptions } from "./ens.js";
export { SnsBackend, SNS_PROXY, isSnsName } from "./sns.js";
export { HnsBackend, HNS_RESOLVERS, isHnsName } from "./hns.js";
export {
  ClipHandlesBackend,
  CLIP_HANDLES_ABI,
  CLIP_HANDLES_DEPLOYMENTS,
  RECENT_HANDLE_MS,
  isClipHandle,
  isValidHandle,
  parseHandle,
  type ClipHandlesOptions,
  type HandleRecords,
  type HandlesReader,
} from "./clip.js";

export interface NameResolverOptions {
  fetch?: typeof fetch;
  /** The wallet's enabled networks; used to keep implied networks to ones the wallet has. */
  networks?: Network[];
  ens?: { chain?: "mainnet" | "sepolia"; rpcUrl?: string; client?: EnsClient } | false;
  sns?: { baseUrl?: string } | false;
  /** Hedera ledger to resolve .hbar on. Default: testnet if the wallet has hedera:testnet, else mainnet. */
  hns?: { ledger?: "mainnet" | "testnet" } | false;
  /** Clip handles ("@alex", "alex.clip"). Off (a plain "not switched on" message) until a contract address is known. */
  clip?: Omit<ClipHandlesOptions, "networks" | "fetch" | "now"> | false;
  /** Results are cached this long (ms). Default 60 s; misses are not cached. */
  cacheMs?: number;
  now?: () => number;
}

/** Looks like a name any backend could handle (cheap, no network). */
export function looksLikeName(input: string): boolean {
  if (isClipHandle(input)) return true;
  return /^[^\s/:]+\.[a-z]{2,}$/iu.test(input.trim()) && !/^0x/i.test(input.trim()) && !/^0\.0\.\d+$/.test(input.trim());
}

export class MultiNameResolver implements NameResolver {
  private readonly backends: Backend[];
  private readonly cache = new Map<string, { at: number; value: ResolvedName }>();
  private readonly now: () => number;

  constructor(private readonly opts: NameResolverOptions = {}, backends?: Backend[]) {
    this.now = opts.now ?? Date.now;
    if (backends) {
      this.backends = backends;
      return;
    }
    const list: Backend[] = [];
    const hasHederaTestnet = opts.networks ? opts.networks.some((n) => n.id === "hedera:testnet") : true;
    if (opts.ens !== false) {
      const ensOpts: ConstructorParameters<typeof EnsBackend>[0] = {};
      if (opts.ens?.chain) ensOpts.ensChain = opts.ens.chain;
      if (opts.ens?.rpcUrl) ensOpts.rpcUrl = opts.ens.rpcUrl;
      if (opts.ens?.client) ensOpts.client = opts.ens.client;
      if (opts.fetch) ensOpts.fetch = opts.fetch;
      if (opts.networks) ensOpts.networks = opts.networks;
      list.push(new EnsBackend(ensOpts));
    }
    if (opts.sns !== false) list.push(new SnsBackend({ ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.sns?.baseUrl ? { baseUrl: opts.sns.baseUrl } : {}) }));
    if (opts.hns !== false)
      list.push(new HnsBackend({ ledger: opts.hns?.ledger ?? (hasHederaTestnet ? "testnet" : "mainnet"), ...(opts.fetch ? { fetch: opts.fetch } : {}), now: this.now }));
    if (opts.clip !== false) {
      list.push(
        new ClipHandlesBackend({
          ledger: hasHederaTestnet ? "testnet" : "mainnet",
          ...(opts.clip ?? {}),
          ...(opts.networks ? { networks: opts.networks } : {}),
          ...(opts.fetch ? { fetch: opts.fetch } : {}),
          now: this.now,
        }),
      );
    }
    this.backends = list;
  }

  serviceFor(name: string): NameService | null {
    return this.backends.find((b) => b.handles(name))?.service ?? null;
  }

  async resolve(name: string): Promise<ResolvedName | null> {
    const key = name.trim().toLowerCase();
    const backend = this.backends.find((b) => b.handles(key));
    if (!backend) return null;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < (this.opts.cacheMs ?? 60_000)) return hit.value;
    const value = await backend.resolve(key);
    if (value) this.cache.set(key, { at: this.now(), value });
    return value;
  }

  async reverse(address: string, family: Family, networkId?: NetworkId): Promise<string | null> {
    for (const b of this.backends) {
      if (!b.reverse) continue;
      const n = await b.reverse(address, family, networkId);
      if (n) return n;
    }
    return null;
  }
}

export function createNameResolver(opts: NameResolverOptions = {}): MultiNameResolver {
  return new MultiNameResolver(opts);
}
