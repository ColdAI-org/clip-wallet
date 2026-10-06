/**
 * Social services (contacts, Clip handles, notifications, Discover) for any host: the extension's service
 * worker and the mobile app build them the same way. Holds no keys: contacts are sealed by the vault's
 * app-data API, handle actions go through `enqueue` (the normal approval path), and notifications read public
 * data only (the account cache the wallet writes after unlock), so they work while the wallet is locked.
 *
 * @module
 */
import type { Account, AssetRef, ChainContext, ChainModule, DappRequest, Family, Msg, Network } from "@clip-wallet/core";
import { resolveLocale, type LocaleCode } from "@clip-wallet/i18n";
import { ClipHandlesBackend } from "@clip-wallet/names";
import { SocialService, publicSnapshot, type Notifier, type TokenRiskSource } from "@clip-wallet/social";
import type { KV } from "./kv.js";

/** KV keys this module reads from the wallet (written by WalletEngine / the extension service). */
const ACCOUNTS_KEY = "clip/accounts";
const ACTIVITY_KEY = "clip/activity";
const PREFS_KEY = "clip/prefs";

export interface SocialHostDeps {
  networks: Network[];
  assets: AssetRef[];
  chains: Partial<Record<Family, ChainModule>>;
  /** Extension: chain modules load lazily; await this before using `chains`. */
  loadChains?: () => Promise<void>;
  kv: KV;
  /** ClipVault's app-data API. Absent (or a vault without it) → contacts in plain storage. */
  vault?: {
    sealAppData?(ns: string, plaintext: string): Promise<{ nonce: string; ct: string }>;
    openAppData?(ns: string, box: { nonce: string; ct: string }): Promise<string>;
  };
  ctx(networkId: string): Promise<ChainContext>;
  enqueue(request: DappRequest, appName: string): Promise<{ id: string }>;
  /** Approvals waiting now (empty when locked). */
  approvals(): Promise<{ id: string; app: string; title: string; titleMsg?: Msg }[]>;
  prices: { usd(assetKey: string): number | undefined; fx(currency: string): number };
  notifier: Notifier;
  /** The device's preferred languages (navigator.languages / expo-localization). */
  deviceLanguages(): readonly string[];
  walletName: string;
  fetch?: typeof fetch;
  /** ClipHandles on Hedera: the deployed contract (EVM address for reads, 0.0.x for writes). Unset = handles off. */
  handles?: { address?: string; contractId?: string; ledger?: "mainnet" | "testnet"; rpcUrl?: string };
  /** The security stream's token lists, when present. */
  risk?: TokenRiskSource;
  coingeckoDemoKey?: string;
  /** CoinGecko id per asset key (@clip-wallet/features COINGECKO_IDS): lets Discover recognise wallet assets. */
  coingeckoIds?: Record<string, string>;
}

export function createSocial(d: SocialHostDeps): SocialService {
  const f = d.fetch ?? globalThis.fetch.bind(globalThis);
  const validators: Partial<Record<Family, (a: string) => boolean>> = {};
  const families = [...new Set(d.networks.map((n) => n.family))];
  const ensureChains = async () => {
    await d.loadChains?.();
    for (const fam of families) {
      const m = d.chains[fam];
      if (m && !validators[fam]) validators[fam] = (a) => m.isAddress(a);
    }
  };
  // Validators fill in as chain modules load (lazy in the extension).
  void ensureChains().catch(() => undefined);
  const hedera = d.networks.find((n) => n.family === "hedera");
  const backend = new ClipHandlesBackend({
    ledger: d.handles?.ledger ?? (hedera?.testnet === false ? "mainnet" : "testnet"),
    ...(d.handles?.address ? { address: d.handles.address } : {}),
    ...(d.handles?.rpcUrl ? { rpcUrl: d.handles.rpcUrl } : {}),
    isAddress: validators,
    networks: d.networks,
    fetch: f,
  });
  const vault = d.vault;
  const cipher =
    vault?.sealAppData && vault.openAppData
      ? { seal: (p: string) => vault.sealAppData!("contacts", p), open: (b: { nonce: string; ct: string }) => vault.openAppData!("contacts", b) }
      : undefined;

  return new SocialService({
    kv: d.kv,
    ...(cipher ? { cipher } : {}),
    validators,
    networks: d.networks,
    assets: d.assets,
    async ownAddresses() {
      await ensureChains();
      const accounts = (await d.kv.get<Account[]>(ACCOUNTS_KEY)) ?? [];
      const seen = new Set<Family>();
      return accounts.filter((a) => !seen.has(a.family) && seen.add(a.family)).map((a) => ({ family: a.family, address: a.address }));
    },
    async hederaCtx() {
      if (!hedera) throw new Error("no hedera network");
      return d.ctx(hedera.id);
    },
    enqueue: (r, app) => d.enqueue(r, app),
    handles: { backend, ...(d.handles?.contractId ? { contract: { contractId: d.handles.contractId } } : {}) },
    notifier: d.notifier,
    async snapshot() {
      await ensureChains();
      return publicSnapshot({
        networks: d.networks,
        chains: d.chains,
        accounts: () => d.kv.get<Account[]>(ACCOUNTS_KEY),
        activity: async () => (await d.kv.get<{ id: string; title: string; titleMsg?: Msg; status: "done" | "pending" | "failed"; kind: string }[]>(ACTIVITY_KEY)) ?? [],
        approvals: () => d.approvals().catch(() => []),
        usd: (k) => d.prices.usd(k),
        fx: (c) => d.prices.fx(c),
        fetch: f,
      });
    },
    async locale(): Promise<LocaleCode> {
      const prefs = await d.kv.get<{ locale?: string }>(PREFS_KEY);
      return resolveLocale(prefs?.locale, d.deviceLanguages());
    },
    fetch: f,
    ...(d.risk ? { risk: d.risk } : {}),
    ...(d.coingeckoIds ? { coingeckoIds: d.coingeckoIds } : {}),
    ...(d.coingeckoDemoKey ? { coingeckoDemoKey: d.coingeckoDemoKey } : {}),
    walletName: d.walletName,
  });
}
