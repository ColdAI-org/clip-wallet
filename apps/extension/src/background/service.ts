/**
 * The wallet background service. Owns the vault instance, chain modules, approvals queue, permissions,
 * portfolio cache, activity and prefs. Pages talk to it only through the zod-validated bus (main.ts);
 * 1Mask and WalletConnect talk to it through DappHost. Nothing here returns key material, except
 * revealPhrase for the onboarding screen.
 */
import type { Account, AssetRef, ChainContext, DappRequest, DecodedRequest, Family, Network, Nft, TokenBalance, Warning } from "@clip-wallet/core";
import { ClipError, FAMILIES as CORE_FAMILIES, WALLET_ORIGIN, isWalletOrigin, type ChainModule } from "@clip-wallet/core";
import type {
  ActivityEntry,
  ActivityLeg,
  ApprovalView,
  DappInfo,
  NetworkView,
  PortfolioView,
  Prefs,
  ReceiveTarget,
  RecipientResolution,
  SessionView,
  WalletState,
} from "@clip-wallet/ui";
import { hashSignablePayload } from "@clip-wallet/vault";
import type { Request, ResponseMap } from "../shared/messages";
import type { KV } from "../shared/storage";
import type { DappHost, Dependencies, PermissionStoreLike } from "./wiring";
import type { CardanoModule, CardanoReadMethod } from "@clip-wallet/chains-cardano";
import { CARDANO_METHODS_ALLOWED } from "@clip-wallet/1mask/background";
import type { LazyChainModule } from "./wiring";
import { PasskeyCeremonies, type CeremonyMeta } from "./passkey-proxy";
import { PlatformService, type PlatformRequest } from "./platform";
import type { Signature, SignablePayload } from "@clip-wallet/core";
import { HardwareErrors, MAX_APPROVAL_TTL_MS, type HardwareAccount } from "@clip-wallet/hardware/core";
import { hardwareAccountView } from "../shared/hardware-job";
import { HardwareSignHost, inProgress } from "./hardware-host";
import { isFeatureRequest, type FeatureRequest } from "@clip-wallet/features/messages";
import type { FeaturesService } from "@clip-wallet/features";
import { isSocialRequest, SocialService, type SocialRequest } from "@clip-wallet/social";
// Light entry points only: the security package itself loads chain SDKs (it runs in the host, attached later).
import { hideKey } from "@clip-wallet/security/hide";
import { isSecurityRequest, type SecurityRequest } from "@clip-wallet/security/messages";
import type { RecipientLog, SecurityService } from "@clip-wallet/security";
import { toInsightInput, withPluginInsights } from "@clip-wallet/plugins";
import { SocialSignInService, type SocialSignInRequest } from "@clip-wallet/engine/social-signin";
import { chromeOffscreen, createPlugins, type BackgroundPlugins, type OffscreenApi } from "./plugins";

export const DEFAULT_PREFS: Prefs = {
  advanced: false,
  autoLockMinutes: 15,
  displayCurrency: "USD",
  theme: "system",
  pinned: [],
  hideSmallBalances: false,
  showSpam: false,
  rpcOverrides: {},
};

/** Side effects the service needs from the browser, injected so tests run without one. */
export interface Env {
  /** Opens or focuses the approval popup window. */
  openApprovalWindow(id: string): Promise<void>;
  openTab(route: string): Promise<void>;
  /** Tells open pages to re-fetch. */
  broadcast(): void;
  /** (Re)arms the auto-lock alarm. */
  armAutoLock(minutes: number): void;
  passkey(): CeremonyMeta;
  walletName: string;
  /**
   * Google / Apple sign-in for backups: chrome.identity.launchWebAuthFlow and its redirect URL
   * (https://<extension id>.chromiumapp.org/backup). Absent = the buttons stay hidden.
   */
  identity?: { launchWebAuthFlow(url: string): Promise<string | undefined>; returnUrl: string };
  /** The offscreen document that runs plugins. Default: chrome.offscreen; null = no plugins (tests, Firefox). */
  pluginHost?: OffscreenApi | null;
}

interface Permission {
  id: string;
  origin: string;
  family: Family;
  via: "injected" | "walletconnect";
  accountIds: string[];
  networkIds: string[];
  connectedAt: number;
  name?: string;
}

interface Pending {
  view: ApprovalView;
  request?: DappRequest;
  connect?: { origin: string; family: Family; via: "injected" | "walletconnect"; account: Account };
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const K = {
  prefs: "clip/prefs",
  accounts: "clip/accounts",
  permissions: "clip/permissions",
  activity: "clip/activity",
  recipients: "clip/recipients",
  activeHw: "clip/hardware/active",
} as const;

/** Ledger app the user must open, per family. */
const LEDGER_APP: Record<string, string> = { evm: "Ethereum", solana: "Solana", bitcoin: "Bitcoin", hedera: "Hedera" };

const CACHE_TTL_MS = 30_000;
const NETWORK_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
const APPROVAL_TTL_MS = 2 * 60_000;
const FAMILIES: readonly Family[] = CORE_FAMILIES;

function parseUnits(value: string, decimals: number): bigint {
  const [w = "0", f = ""] = value.split(".");
  if (f.length > decimals) throw new ClipError(`That amount has too many decimal places.`, "send/precision");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

function human(amount: bigint, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

function domainOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}

export class WalletService implements DappHost {
  private accounts = new Map<Family, Account>();
  private approvals = new Map<string, Pending>();
  private cache = new Map<string, { at: number; balances: TokenBalance[]; nfts?: Nft[] }>();
  private ceremonies: PasskeyCeremonies;
  private features?: Pick<FeaturesService, "handle" | "refine">;
  /** Hardware signing: the approval window drives the device, this checks what comes back. */
  private readonly hw: HardwareSignHost;
  /** Contacts, Clip handles, notifications, Discover (social stream). */
  private social?: Pick<SocialService, "handle" | "refine" | "onLock">;
  /** Settings → Security plus the scam/poisoning checks on every approval (security stream). */
  private security?: Pick<SecurityService, "handle" | "refine" | "assessSite" | "threat" | "cleanup">;
  private recipients?: RecipientLog;
  /** Clip Plugins (Advanced mode + the Plugins switch); see ./plugins.ts. */
  readonly plugins: BackgroundPlugins;
  /** "Continue with Google" / "Sign in with Apple" for passkey backups. */
  private readonly socialSignIn: SocialSignInService;
  /** Passkey backup, phrase-backup flag, multiple accounts (per-site active account), name lookups. */
  readonly platform: PlatformService;

  constructor(
    readonly deps: Dependencies,
    private readonly kv: KV,
    private readonly env: Env,
  ) {
    this.ceremonies = new PasskeyCeremonies(() => env.passkey());
    this.hw = new HardwareSignHost(() => this.deps.hardware, () => env.broadcast());
    this.plugins = createPlugins(kv, () => this.prefs(), env.pluginHost === undefined ? chromeOffscreen() : env.pluginHost);
    deps.pluginNames.lookup = (n) => this.plugins.resolveName(n);
    deps.pluginNames.suffixes = () => this.plugins.suffixes();
    this.socialSignIn = new SocialSignInService({
      backup: deps.backup ? (session) => deps.backup!(session) : null,
      kv,
      ...(env.identity ? { launchWebAuthFlow: env.identity.launchWebAuthFlow, returnUrl: env.identity.returnUrl } : {}),
      changed: () => env.broadcast(),
    });
    const names = deps.names;
    this.platform = new PlatformService({
      vault: deps.vault,
      kv,
      ceremonies: this.ceremonies,
      ceremonyMeta: () => env.passkey(),
      backup: deps.backup,
      families: () => [...new Set(deps.networks.map((n) => n.family))],
      hederaAccountId: (account) => {
        const network = deps.networks.find((n) => n.family === "hedera");
        return network ? deps.hederaAccountId({ network, account, fetch: globalThis.fetch.bind(globalThis) }) : Promise.resolve(undefined);
      },
      ...(names.reverse ? { names: { reverse: (a, f, n) => names.reverse!(a, f, n) } } : {}),
      changed: () => {
        this.accounts.clear();
        this.cache.clear();
        this.deps.dapps.accountsChanged?.();
        env.broadcast();
      },
      onRestored: () => this.afterUnlock(),
    });
  }

  start() {
    this.deps.dapps.start(this);
    this.deps.walletConnect.start(this);
    void this.plugins.sync().catch(() => undefined);
  }

  /* ------------------------------------------------------------------ features (staking, swap, buy, trade, explore) */

  attachSocial(s: Pick<SocialService, "handle" | "refine" | "onLock">) {
    this.social = s;
  }
  /** Public facts for the social host: approvals waiting now (for notifications). */
  socialApprovals(): { id: string; app: string; title: string }[] {
    return [...this.approvals.values()].map((p) => ({ id: p.view.id, app: p.view.dapp.name, title: p.view.decoded?.title ?? p.view.dapp.name }));
  }

  attachSecurity(s: Pick<SecurityService, "handle" | "refine" | "assessSite" | "threat" | "cleanup">, recipients?: RecipientLog) {
    this.security = s;
    this.recipients = recipients;
  }
  /** Collectibles for the security service's spam cleanup. */
  securityNfts(): Promise<Nft[]> {
    return this.collectibles();
  }
  /** WalletConnect: a site on a loaded phishing list (sync; uses only the lists already in memory). */
  isKnownScam(origin: string): boolean {
    return this.security?.threat.isKnownScam(origin) ?? false;
  }

  attachFeatures(f: Pick<FeaturesService, "handle" | "refine">) {
    this.features = f;
  }
  featureCtx(networkId: string): Promise<ChainContext> {
    return this.ctx(networkId);
  }
  async featureBalances(): Promise<TokenBalance[]> {
    return (await this.portfolio()).balances;
  }
  /** Wallet-built request (staking, swap, trade) → the normal approval queue. */
  enqueueWalletRequest(request: DappRequest, appName: string) {
    return this.enqueueTransaction(request, { name: appName, origin: WALLET_ORIGIN, domain: appName, verified: true });
  }
  async decodeForFeatures(request: DappRequest): Promise<DecodedRequest> {
    const network = this.network(request.networkId);
    return this.module(network.family).decode(request, await this.ctx(network.id, request.origin));
  }

  /* ------------------------------------------------------------------ bus entry */

  async handle<T extends Request["type"]>(msg: Extract<Request, { type: T }>): Promise<ResponseMap[T]> {
    const m = msg as Request;
    const status = await this.deps.vault.status();
    if (status === "unlocked") this.env.armAutoLock((await this.prefs()).autoLockMinutes);
    const r = await this.dispatch(m, status);
    return r as ResponseMap[T];
  }

  private requireUnlocked(status: string) {
    if (status !== "unlocked") throw new ClipError("Your wallet is locked. Unlock it to continue.", "vault/locked");
  }

  private async dispatch(m: Request, status: "empty" | "locked" | "unlocked"): Promise<unknown> {
    // Platform messages check their own lock state (restore runs while the vault is empty).
    if (this.platform.handles(m.type)) return this.platform.handle(m as PlatformRequest);
    // Backup sign-in identifies whose backups these are (restore also runs while the vault is empty).
    if (this.socialSignIn.handles(m.type)) return this.socialSignIn.handle(m as SocialSignInRequest);
    switch (m.type) {
      case "getState":
        return this.state(status);
      case "setPrefs":
        return this.setPrefs(m.patch);
      case "createWallet":
        await this.deps.vault.create(m.password);
        await this.afterUnlock();
        return;
      case "revealPhrase":
        return this.deps.vault.revealPhrase(m.password);
      case "importWallet":
        await this.deps.vault.importPhrase(m.phrase, m.password);
        await this.afterUnlock();
        return;
      case "unlock":
        await this.deps.vault.unlock(m.password);
        await this.afterUnlock();
        return;
      case "lock":
        await this.lock();
        return;
      case "passkeyBegin":
        if (m.begin.op === "enroll") {
          this.requireUnlocked(status);
          const password = m.begin.password;
          return this.ceremonies.begin("enroll", (prf) => this.deps.vault.enrollPasskey(password, prf));
        }
        return this.ceremonies.begin("unlock", async (prf) => {
          await this.deps.vault.unlockWithPasskey(prf);
          await this.afterUnlock();
        });
      case "passkeyFinish": {
        const { id, ...rest } = m.result;
        await this.ceremonies.finish(id, rest as { credentialId: string; prfOutput: string } | { error: string });
        this.env.broadcast();
        return;
      }
      case "passkeyRemove": {
        for (const p of await this.deps.vault.listPasskeys()) await this.deps.vault.removePasskey(p.credentialId);
        this.env.broadcast();
        return;
      }
      case "openFullTab":
        await this.env.openTab(m.route ?? "/");
        return;
    }

    if (isSocialRequest(m)) {
      if (!this.social) throw new ClipError("This isn't available in this build.", "social/off");
      // Notification settings and Discover work while locked; contacts and handles need the vault.
      if (!SocialService.LOCKED_OK.has(m.type)) this.requireUnlocked(status);
      return this.social.handle(m as SocialRequest);
    }
    this.requireUnlocked(status);
    if (isFeatureRequest(m)) {
      if (!this.features) throw new ClipError("This isn't available in this build.", "features/off");
      return this.features.handle(m as FeatureRequest);
    }
    if (isSecurityRequest(m)) {
      if (!this.security) throw new ClipError("This isn't available in this build.", "security/off");
      return this.security.handle(m as SecurityRequest);
    }
    if (this.plugins.service.handles(m.type)) return this.plugins.service.handle(m);
    switch (m.type) {
      case "getPortfolio":
        return this.portfolio(!!m.refresh);
      case "getCollectibles":
        return this.collectibles();
      case "getActivity":
        return this.activity();
      case "resolveRecipient":
        return this.resolveRecipient(m.input, m.assetKey);
      case "rememberRecipientNetwork": {
        const map = (await this.kv.get<Record<string, string>>(K.recipients)) ?? {};
        map[`${m.address.toLowerCase()}|${m.assetKey}`] = m.networkId;
        await this.kv.set(K.recipients, map);
        return;
      }
      case "send":
        return this.send(m);
      case "getReceiveTargets":
        return this.receiveTargets(m.assetKey);
      case "listApprovals":
        return [...this.approvals.values()].map((p) => p.view).sort((a, b) => a.createdAt - b.createdAt);
      case "getApproval":
        return this.approvals.get(m.id)?.view ?? null;
      case "approve":
        return this.approve(m.id, !!m.allowBlind);
      case "reject":
        return this.reject(m.id);
      case "listSessions":
        return this.sessions();
      case "disconnect":
        return this.disconnect(m.id);
      case "pairWalletConnect":
        return this.deps.walletConnect.pair(m.uri);
      case "hwAddAccounts": {
        // Found by the page that ran the device; the keyring checks each record against its id.
        const picked = m.accounts as HardwareAccount[];
        await this.deps.hardware.addAccounts(picked);
        // The first account added for a family becomes the one the wallet uses for it.
        const active = await this.activeHw();
        for (const a of picked) if (!active[a.family]) active[a.family] = a.id;
        await this.kv.set(K.activeHw, active);
        await this.afterUnlock();
        return;
      }
      case "hwListAccounts": {
        const active = await this.activeHw();
        return (await this.deps.hardware.accounts()).map((a) => ({ ...hardwareAccountView(a), active: active[a.family] === a.id }));
      }
      case "hwRenameAccount":
        await this.deps.hardware.updateAccount(m.id, { label: m.label || undefined });
        this.env.broadcast();
        return;
      case "hwForgetDevice": {
        // The page forgets a Keystone's synced keys (its own storage); this removes the accounts.
        await this.deps.hardware.removeDevice(m.kind, m.fingerprint);
        const active = await this.activeHw();
        for (const [f, hwId] of Object.entries(active)) if (hwId && !(await this.deps.hardware.account(hwId))) delete active[f as Family];
        await this.kv.set(K.activeHw, active);
        await this.afterUnlock();
        return;
      }
      case "hwSetActive": {
        const active = await this.activeHw();
        if (m.accountId) {
          const a = await this.deps.hardware.account(m.accountId);
          if (!a || a.family !== m.family) throw HardwareErrors.unknownAccount();
          active[m.family] = m.accountId;
        } else delete active[m.family];
        await this.kv.set(K.activeHw, active);
        await this.afterUnlock();
        return;
      }
      case "hwCancel":
        this.hw.cancel(m.id); // approve() throws "Cancelled"; the window drops the device step when the job goes
        return;
      case "hwSignJobs":
        return this.hw.jobs();
      case "hwSignResult":
        return this.hw.result(m.id, m.jobId, m.signature);
      case "hwSignFailed":
        return this.hw.failed(m.id, m.jobId, m.code, m.message);
      case "devSimulateRequest":
        if (!this.deps.mocks) throw new ClipError("Not available in this build.", "dev/disabled");
        return this.simulate(m.kind);
    }
  }

  /* ------------------------------------------------------------------ state, prefs, lock */

  async prefs(): Promise<Prefs> {
    return { ...DEFAULT_PREFS, ...((await this.kv.get<Partial<Prefs>>(K.prefs)) ?? {}) };
  }

  private async setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
    const next = { ...(await this.prefs()), ...patch };
    await this.kv.set(K.prefs, next);
    if (patch.displayCurrency || patch.rpcOverrides) this.cache.clear();
    if (patch.autoLockMinutes) this.env.armAutoLock(next.autoLockMinutes);
    // Advanced mode gates plugins: turning it off stops them all.
    if (patch.advanced !== undefined) void this.plugins.sync().catch(() => undefined);
    this.env.broadcast();
    return next;
  }

  private async state(status: "empty" | "locked" | "unlocked"): Promise<WalletState> {
    const passkeys = status === "empty" ? [] : await this.deps.vault.listPasskeys();
    return {
      status,
      prefs: await this.prefs(),
      passkey: { enrolled: passkeys.length > 0 },
      pendingApprovals: status === "unlocked" ? this.approvals.size : 0,
      mocks: this.deps.mocks,
    };
  }

  async lock() {
    await this.deps.vault.lock();
    this.social?.onLock();
    this.accounts.clear();
    this.deps.dapps.accountsChanged?.();
    this.deps.hardware.lock();
    this.hw.cancelAll();
    this.env.broadcast();
  }

  /** Derives account 0 for every enabled family (public data only) and caches it. */
  private async afterUnlock() {
    const families = [...new Set(this.deps.networks.map((n) => n.family))];
    this.accounts.clear();
    for (const f of families) this.accounts.set(f, await this.walletAccount(f));
    const hedera = this.deps.networks.find((n) => n.family === "hedera");
    const hAcct = this.accounts.get("hedera");
    if (hedera && hAcct) {
      // Best effort: a brand-new alias has no 0.0.x until it first receives HBAR.
      const id = await withTimeout(this.deps.hederaAccountId({ network: hedera, account: hAcct, fetch: globalThis.fetch.bind(globalThis) }), 5000).catch(() => undefined);
      if (id) hAcct.hederaAccountId = id;
    }
    this.deps.dapps.accountsChanged?.();
    await this.kv.set(K.accounts, [...this.accounts.values()]);
    this.env.armAutoLock((await this.prefs()).autoLockMinutes);
    this.env.broadcast();
  }

  /** The account a site sees (its own choice in Settings → Accounts, else the wallet default). */
  private async siteAccount(family: Family, origin: string): Promise<Account> {
    try {
      // A site's own choice wins; otherwise it sees the wallet's account (hardware or phrase).
      return (await this.platform.siteChoice(family, origin)) ? await this.platform.activeAccount(family, origin) : await this.account(family);
    } catch (e) {
      // An origin that isn't a URL (some WalletConnect peers) can't have its own choice: use the default.
      if (e instanceof ClipError && e.code === "accounts/bad-origin") return this.account(family);
      throw e;
    }
  }

  private async activeHw(): Promise<Partial<Record<Family, string>>> {
    return (await this.kv.get<Partial<Record<Family, string>>>(K.activeHw)) ?? {};
  }

  /**
   * The wallet's account for a family: a hardware account picked for it (Settings → Hardware wallets) replaces
   * the phrase account; otherwise the Settings → Accounts default (account 0 until chosen).
   */
  private async walletAccount(family: Family): Promise<Account> {
    const hwId = (await this.activeHw())[family];
    const hw = hwId ? await this.deps.hardware.account(hwId) : undefined;
    return hw ?? this.platform.activeAccount(family);
  }

  private async account(family: Family): Promise<Account> {
    let a = this.accounts.get(family);
    if (!a) {
      a = await this.walletAccount(family);
      this.accounts.set(family, a);
    }
    return a;
  }

  private module(family: Family): ChainModule {
    const m = this.deps.chains[family];
    if (!m) throw new ClipError("This kind of account isn't available in this version yet.", "family-unavailable");
    return m;
  }

  private network(id: string): Network {
    // Request-only networks (Hedera's EVM for settle claims) sign and decode but are never listed or scanned.
    const n = this.deps.networks.find((x) => x.id === id) ?? this.deps.requestNetworks?.find((x) => x.id === id);
    if (!n) throw new ClipError("That network isn't available in this wallet.", "network/unknown");
    return n;
  }

  /** `origin` (a dapp request): sign with the account that site sees; otherwise the wallet's active account. */
  private async ctx(networkId: string, origin?: string): Promise<ChainContext> {
    const network = this.network(networkId);
    const override = (await this.prefs()).rpcOverrides[networkId];
    const account = origin && !isWalletOrigin(origin) ? await this.siteAccount(network.family, origin) : await this.account(network.family);
    const base: ChainContext = {
      network: override ? { ...network, rpcUrls: [override, ...network.rpcUrls] } : network,
      account,
      fetch: globalThis.fetch.bind(globalThis),
    };
    if (network.family !== "bitcoin" || this.deps.hardware.owns(account.id)) return base;
    // Bitcoin change addresses (vault-v2): the same list goes to buildTransfer/decode/prepare/finalize.
    return {
      ...base,
      changeAddresses: await this.deps.vault.listChange("bitcoin", account.index),
      freshChangeAddress: () => this.deps.vault.freshChange("bitcoin", account.index),
    };
  }

  /* ------------------------------------------------------------------ portfolio */

  private networkView(n: Network): NetworkView {
    return { id: n.id, family: n.family, name: n.name, chainId: n.chainId, testnet: n.testnet, explorerUrl: n.explorerUrl, rpcUrl: n.rpcUrls[0] };
  }

  private async fiat(asset: AssetRef, amount: bigint): Promise<number | undefined> {
    const usd = this.deps.prices.usd(asset.key);
    if (usd === undefined || asset.spam) return asset.spam ? 0 : undefined;
    const fx = this.deps.prices.fx((await this.prefs()).displayCurrency);
    return (Number(amount) / 10 ** asset.decimals) * usd * fx;
  }

  async portfolio(refresh = false): Promise<PortfolioView> {
    const stale: string[] = [];
    const out: TokenBalance[] = [];
    await Promise.all(
      this.deps.networks.map(async (n) => {
        const hit = this.cache.get(n.id);
        if (hit && !refresh && Date.now() - hit.at < CACHE_TTL_MS) {
          out.push(...hit.balances);
          return;
        }
        try {
          const raw = await withTimeout(this.module(n.family).getBalances(await this.ctx(n.id)), NETWORK_TIMEOUT_MS);
          const balances = await Promise.all(raw.map(async (b) => ({ ...b, fiatValue: await this.fiat(b.asset, BigInt(b.amount)) })));
          this.cache.set(n.id, { at: Date.now(), balances, nfts: hit?.nfts });
          out.push(...balances);
        } catch {
          stale.push(n.id);
          if (hit) out.push(...hit.balances);
        }
      }),
    );
    // Settings → Security → Clean up: tokens the user hid stay out of the portfolio.
    const hidden = (await this.security?.cleanup.hidden().catch(() => undefined)) ?? new Set<string>();
    const balances = hidden.size ? out.filter((b) => !b.asset.address || !hidden.has(hideKey(b.asset.networkId, b.asset.address))) : out;
    return {
      balances,
      assets: this.deps.assets,
      networks: this.deps.networks.map((n) => this.networkView(n)),
      currency: (await this.prefs()).displayCurrency,
      updatedAt: Date.now(),
      stale,
    };
  }

  private async collectibles(): Promise<Nft[]> {
    const all = await Promise.all(
      this.deps.networks.map(async (n) => {
        try {
          return await withTimeout(this.module(n.family).getNfts(await this.ctx(n.id)), NETWORK_TIMEOUT_MS);
        } catch {
          return this.cache.get(n.id)?.nfts ?? [];
        }
      }),
    );
    // Hidden NFTs: by collection + token id, or by mint alone (Solana).
    const hidden = (await this.security?.cleanup.hidden().catch(() => undefined)) ?? new Set<string>();
    const nfts = all.flat();
    return hidden.size
      ? nfts.filter((n) => !hidden.has(hideKey(n.networkId, n.collection.address, n.tokenId)) && !hidden.has(hideKey(n.networkId, n.tokenId)))
      : nfts;
  }

  private async activity(): Promise<ActivityEntry[]> {
    const stored = await this.kv.get<ActivityEntry[]>(K.activity);
    if (stored) return stored;
    await this.kv.set(K.activity, this.deps.seedActivity);
    return this.deps.seedActivity;
  }

  private async addActivity(e: ActivityEntry) {
    const list = await this.activity();
    await this.kv.set(K.activity, [e, ...list].slice(0, 200));
  }

  /* ------------------------------------------------------------------ send / receive */

  async resolveRecipient(input: string, assetKey: string): Promise<RecipientResolution> {
    let address = input.trim();
    let displayName: string | undefined;
    // ENS (.eth and subdomains), SNS (.sol), Hedera names (.hbar, .boo, .cream), Clip handles (@alex, alex.clip).
    const looksLikeName =
      /^[^\s/:]+\.(eth|sol|hbar|boo|cream|clip)$/i.test(address) || /^@[a-z0-9-]{3,32}$/i.test(address) || this.deps.names.serviceFor?.(address) === "plugin";
    let implied: string[] = [];
    let addressOn: Record<string, string> = {};
    if (looksLikeName) {
      let hit: Awaited<ReturnType<Dependencies["names"]["resolve"]>>;
      try {
        hit = await this.deps.names.resolve(address);
      } catch {
        return { kind: "invalid", message: `We couldn't look up ${address} right now. Try again, or paste their address.` };
      }
      if (!hit) return { kind: "invalid", message: `We couldn't find ${address}. Check the spelling, or paste their address.` };
      // A Clip handle publishes one address per family: use the one for this asset's family.
      const forAsset = hit.byFamily ? this.handleAddressFor(hit.byFamily, assetKey) : hit.address;
      if (!forAsset) return { kind: "invalid", message: `${hit.displayName} hasn't published an address that can receive this.` };
      address = forAsset;
      displayName = hit.displayName;
      implied = hit.networkIds ?? [];
      addressOn = hit.addressOn ?? {};
    }
    await this.deps.loadChains();
    const carrying = this.deps.networks.filter((n) => this.deps.assets.some((a) => a.key === assetKey && a.networkId === n.id));
    const recognised = FAMILIES.filter((f) => !!this.deps.chains[f]?.isAddress(address));
    if (recognised.length === 0) return { kind: "invalid", message: "That doesn't look like an address. Check it and try again." };
    const all = recognised.flatMap((f) => this.module(f).networksForAddress(address, carrying.filter((n) => n.family === f)));
    // A name that points at specific networks narrows the choice (no prompt when only one is left).
    const narrowed = implied.length ? all.filter((n) => implied.includes(n.id)) : all;
    const candidates = narrowed.length ? narrowed : all;
    const on = (id: string) => addressOn[id] ?? address;
    const symbol = this.deps.assets.find((a) => a.key === assetKey)?.symbol ?? "this";
    if (candidates.length === 0) return { kind: "invalid", message: `That address can't receive ${symbol}. Ask them for a different address.` };
    if (candidates.length === 1) return { kind: "resolved", address: on(candidates[0]!.id), displayName, networkId: candidates[0]!.id };

    const remembered = ((await this.kv.get<Record<string, string>>(K.recipients)) ?? {})[`${address.toLowerCase()}|${assetKey}`];
    if (remembered && candidates.some((c) => c.id === remembered)) return { kind: "resolved", address: on(remembered), displayName, networkId: remembered };

    const { balances } = await this.portfolio();
    return {
      kind: "ask",
      address,
      displayName,
      candidates: candidates.map((n) => ({
        network: this.networkView(n),
        balance: balances
          .filter((b) => b.asset.key === assetKey && b.asset.networkId === n.id)
          .reduce((t, b) => t + BigInt(b.amount), 0n)
          .toString(),
      })),
    };
  }

  /** A Clip handle's address for the families that carry `assetKey` (first match). */
  private handleAddressFor(byFamily: Partial<Record<Family, string>>, assetKey: string): string | undefined {
    const fams = new Set(this.deps.networks.filter((n) => this.deps.assets.some((a) => a.key === assetKey && a.networkId === n.id)).map((n) => n.family));
    return [...fams].map((f) => byFamily[f]).find((a): a is string => !!a);
  }

  private async send(m: Extract<Request, { type: "send" }>): Promise<string> {
    const asset = this.deps.assets.find((a) => a.key === m.assetKey && a.networkId === m.networkId);
    if (!asset) throw new ClipError("That asset can't be sent there.", "send/asset");
    const network = this.network(m.networkId);
    const mod = this.module(network.family);
    await this.deps.loadChains();
    // Re-check the recipient in the background: never trust the page's network choice blindly. Names are
    // re-resolved here, using the name's own address for this network when it has one (ENS per-chain records).
    let to = m.to;
    if (!mod.isAddress(m.to)) {
      const hit = await this.deps.names.resolve(m.to).catch(() => null);
      to = hit ? (hit.addressOn?.[m.networkId] ?? hit.byFamily?.[network.family] ?? hit.address) : "";
    }
    if (!to || !mod.isAddress(to)) throw new ClipError("That doesn't look like an address. Check it and try again.", "send/address");
    const amount = parseUnits(m.amount, asset.decimals);
    if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "send/amount");
    const ctx = await this.ctx(network.id);
    const request = await mod.buildTransfer({ asset, to, amount: amount.toString() }, ctx);
    const { id, promise } = await this.enqueueTransaction(request, {
      name: this.env.walletName,
      origin: WALLET_ORIGIN,
      domain: `to ${short(to)}`,
      verified: true,
    }, { recipient: to });
    promise.catch(() => undefined);
    return id;
  }

  private async receiveTargets(assetKey: string): Promise<ReceiveTarget[]> {
    const byAddress = new Map<string, ReceiveTarget>();
    for (const asset of this.deps.assets.filter((a) => a.key === assetKey && !a.bridged)) {
      const network = this.network(asset.networkId);
      const acct = await this.account(network.family);
      const t = byAddress.get(acct.address) ?? { asset, address: acct.address, displayAddress: acct.hederaAccountId, networks: [] };
      t.networks.push(this.networkView(network));
      byAddress.set(acct.address, t);
    }
    return [...byAddress.values()];
  }

  /* ------------------------------------------------------------------ approvals */

  private dappInfo(origin: string, name?: string, iconUrl?: string): DappInfo {
    const reg = this.deps.registry.lookup(origin);
    return { name: reg.verified ? reg.name : name ?? reg.name, origin, domain: domainOf(origin), verified: reg.verified, iconUrl: reg.iconUrl ?? iconUrl };
  }

  private async enqueueTransaction(
    request: DappRequest,
    dapp: DappInfo,
    extra: { recipient?: string; warnings?: Warning[] } = {},
  ): Promise<{ id: string; promise: Promise<unknown> }> {
    const network = this.network(request.networkId);
    const ctx = await this.ctx(network.id, request.origin);
    let decoded: DecodedRequest;
    try {
      decoded = await this.module(network.family).decode(request, ctx);
    } catch {
      decoded = {
        requestId: request.id,
        title: "Unreadable request",
        lines: [],
        balanceChanges: [],
        simulated: false,
        blind: true,
        warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this request." }],
        networkId: network.id,
      };
    }
    decoded = this.features?.refine(request, decoded) ?? decoded;
    decoded = this.social?.refine(request, decoded) ?? decoded;
    // Scam lists, address poisoning, new contracts, Blockaid when on. Never throws, never drops the module's warnings.
    if (this.security) {
      decoded = await this.security.refine(request, decoded, network, ctx.account.hederaAccountId ?? ctx.account.address, {
        recipients: extra.recipient ? [extra.recipient] : [],
      });
    }
    if (decoded.fee) decoded.fee.fiatValue ??= await this.fiat(decoded.fee.asset, BigInt(decoded.fee.amount));
    let fiatValue: number | undefined;
    for (const c of decoded.balanceChanges) {
      if (!c.delta.startsWith("-")) continue;
      const v = await this.fiat(c.asset, BigInt(c.delta.slice(1)));
      if (v !== undefined) fiatValue = (fiatValue ?? 0) + v;
    }
    if (extra.warnings?.length) decoded.warnings = [...decoded.warnings, ...extra.warnings];
    if (!this.deps.registry.lookup(request.origin).verified && !isWalletOrigin(request.origin) && !decoded.warnings.some((w) => w.code === "domain-mismatch")) {
      decoded.warnings.push({ level: "caution", code: "domain-mismatch", message: `${domainOf(request.origin)} isn't a site ${this.env.walletName} recognises. Only continue if you opened it yourself.` });
    }
    // Plugin notes ("from <plugin>") ride beside the wallet's own analysis, never inside it; never for blind requests.
    const insights = decoded.blind ? [] : await this.plugins.insights(toInsightInput(decoded, request.origin, ctx.account.address)).catch(() => []);
    decoded = withPluginInsights(decoded, insights);
    if (extra.recipient) decoded.lines = [{ label: "To", value: short(extra.recipient) }, ...decoded.lines];
    const { balances } = await this.portfolio();
    const plan = decoded.blind ? undefined : await this.deps.route.plan({ request, decoded, balances, networks: this.deps.networks, account: ctx.account.address });

    const id = crypto.randomUUID();
    const view: ApprovalView = {
      id,
      kind: "transaction",
      createdAt: Date.now(),
      dapp,
      network: this.networkView(network),
      via: isWalletOrigin(request.origin) ? "wallet" : request.via,
      decoded,
      fiatValue,
      plan,
      raw: JSON.stringify({ method: request.method, params: request.params }, null, 2).slice(0, 4000),
      ...(extra.recipient ? { recipient: { address: extra.recipient, family: network.family } } : {}),
    };
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.approvals.set(id, { view, request, resolve, reject });
    // Real sends feed the look-alike check (security's RecipientLog), once they go through.
    if (extra.recipient && this.recipients) {
      const out = decoded.balanceChanges.find((c) => c.delta.startsWith("-"));
      const recipients = this.recipients;
      promise
        .then(() => recipients.record({ family: network.family, networkId: network.id, counterparty: extra.recipient!, amount: out ? out.delta.slice(1) : "1", assetKey: out?.asset.key, timestamp: Date.now() }))
        .catch(() => undefined);
    }
    this.env.broadcast();
    return { id, promise };
  }

  private async enqueueConnect(p: { origin: string; family: Family; networkId: string; via: "injected" | "walletconnect"; name?: string; iconUrl?: string; warnings?: Warning[] }) {
    const account = await this.siteAccount(p.family, p.origin);
    const id = crypto.randomUUID();
    const network = this.network(p.networkId);
    // WalletConnect Verify's warnings plus the phishing lists (and Blockaid's site scan when on).
    const siteWarnings = [...(p.warnings ?? []), ...((await this.security?.assessSite(p.origin).catch(() => [])) ?? [])];
    const view: ApprovalView = {
      id,
      kind: "connect",
      createdAt: Date.now(),
      dapp: this.dappInfo(p.origin, p.name, p.iconUrl),
      network: this.networkView(network),
      via: p.via,
      connect: {
        accountLabel: "wallet address",
        address: account.hederaAccountId ?? account.address,
        permissions: ["See your address and what you hold", "Ask you to approve payments and signatures"],
        warnings: siteWarnings,
      },
    };
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.approvals.set(id, { view, connect: { origin: p.origin, family: p.family, via: p.via, account }, resolve, reject });
    this.env.broadcast();
    return { id, promise: promise as Promise<Account[]> };
  }

  private async approve(id: string, allowBlind: boolean): Promise<void> {
    const p = this.approvals.get(id);
    if (!p) throw new ClipError("This request is no longer waiting. It may have expired.", "approval/gone");

    if (p.connect) {
      const perms = (await this.kv.get<Permission[]>(K.permissions)) ?? [];
      const existing = perms.filter((x) => !(x.origin === p.connect!.origin && x.family === p.connect!.family));
      existing.push({
        id: crypto.randomUUID(),
        origin: p.connect.origin,
        family: p.connect.family,
        via: p.connect.via,
        accountIds: [p.connect.account.id],
        networkIds: [p.view.network.id],
        connectedAt: Date.now(),
        name: p.view.dapp.name,
      });
      await this.kv.set(K.permissions, existing);
      this.approvals.delete(id);
      await this.addActivity({ id, title: `Connected to ${p.view.dapp.name}`, kind: "connect", app: { name: p.view.dapp.name, origin: p.view.dapp.origin }, timestamp: Date.now(), status: "done", legs: [] });
      p.resolve([p.connect.account]);
      this.env.broadcast();
      return;
    }

    const req = p.request!;
    const decoded = p.view.decoded!;
    if (p.view.plan?.problem) throw new ClipError(p.view.plan.problem, "approval/not-payable");
    if (decoded.blind && !((await this.prefs()).advanced && allowBlind)) {
      throw new ClipError(
        "This request can't be read, so it was blocked. Only Advanced mode can override that.",
        "approval/blind-blocked",
      );
    }
    const network = this.network(req.networkId);
    const mod = this.module(network.family);
    const ctx = await this.ctx(network.id, req.origin);
    let result: unknown;
    const hw = this.deps.hardware.owns(ctx.account.id);
    // A second Approve while the device is busy must not revoke the approval the device is signing.
    if (hw && this.hw.isRunning(id)) throw inProgress();
    try {
      const payloads = await mod.prepare(req, ctx, id);
      // A device step (finding the Ledger, scanning QR codes) can take longer than a vault signature.
      if (hw) this.deps.hardware.registerApproval(id, payloads, MAX_APPROVAL_TTL_MS);
      else this.deps.vault.registerApproval(id, payloads.map((x) => hashSignablePayload(x)), APPROVAL_TTL_MS);
      const sigs = [];
      for (const payload of payloads) sigs.push(hw ? await this.signOnDevice(p, payload) : await this.deps.vault.sign(payload));
      result = await mod.finalize(req, sigs, ctx);
    } catch (e) {
      if (hw) this.deps.hardware.revokeApproval(id);
      else this.deps.vault.revokeApproval(id);
      throw e instanceof ClipError ? e : new ClipError("That didn't go through. Nothing left your balance.", "approval/failed", e);
    }
    this.approvals.delete(id);
    this.cache.clear();
    await this.addActivity(this.activityFor(p.view, result));
    p.resolve(result);
    this.env.broadcast();
  }

  /** Hardware sign: the approval window runs the device (it shows the step), the host verifies the answer. */
  private async signOnDevice(p: Pending, payload: SignablePayload): Promise<Signature> {
    const acct = await this.deps.hardware.account(payload.accountId);
    if (!acct) throw HardwareErrors.unknownAccount();
    if (acct.hardware.kind === "ledger") p.view.hardware = { kind: "ledger", stage: "confirm", app: LEDGER_APP[acct.family] ?? "right" };
    this.env.broadcast();
    // The window does the device I/O; make sure one is open (approve can come from the popup).
    void this.env.openApprovalWindow(payload.approvalId).catch(() => undefined);
    try {
      return await this.hw.sign(payload, { request: p.request!, decoded: p.view.decoded! });
    } finally {
      p.view.hardware = undefined;
      this.env.broadcast();
    }
  }

  private activityFor(view: ApprovalView, result: unknown): ActivityEntry {
    const d = view.decoded!;
    const rest = d.title.replace(/^(Pay|Send) /, "");
    const title = d.title.startsWith("Pay ")
      ? `Paid ${view.dapp.name} ${rest}`
      : d.title.startsWith("Send ")
        ? `Sent ${rest} ${view.dapp.domain}`
        : d.title.startsWith("Sign in to")
          ? d.title.replace(/^Sign in/, "Signed in")
          : `Approved: ${d.title}`;
    const txHash = result && typeof result === "object" && "txHash" in result ? String((result as { txHash: unknown }).txHash) : undefined;
    const legs: ActivityLeg[] = (view.plan?.steps ?? []).map((s) => ({
      title: s.kind === "funding" ? s.title.replace(/^Move/, "Moved") : s.kind === "gas" ? s.title : title,
      networkId: view.network.id,
      status: "done",
      txHash: s.kind === "action" ? txHash : undefined,
    }));
    return {
      id: view.id,
      title,
      kind: d.title.startsWith("Pay ") ? "pay" : d.title.startsWith("Send ") ? "send" : "sign",
      app: view.via === "wallet" ? undefined : { name: view.dapp.name, origin: view.dapp.origin },
      fiatValue: view.fiatValue !== undefined ? -view.fiatValue : undefined,
      timestamp: Date.now(),
      status: "done",
      legs: legs.length > 1 ? legs : [],
    };
  }

  private async reject(id: string): Promise<void> {
    const p = this.approvals.get(id);
    if (!p) return;
    this.approvals.delete(id);
    p.reject(new ClipError("You declined this request.", "user-rejected"));
    this.env.broadcast();
  }

  /* ------------------------------------------------------------------ sessions */

  private async sessions(): Promise<SessionView[]> {
    const perms = (await this.kv.get<Permission[]>(K.permissions)) ?? [];
    const injected: SessionView[] = perms.map((p) => ({
      id: p.id,
      dapp: this.dappInfo(p.origin, p.name),
      via: p.via,
      connectedAt: p.connectedAt,
      networkIds: p.networkIds,
    }));
    return [...injected, ...(await this.deps.walletConnect.sessions())].sort((a, b) => b.connectedAt - a.connectedAt);
  }

  private async disconnect(id: string) {
    const perms = (await this.kv.get<Permission[]>(K.permissions)) ?? [];
    const hit = perms.find((p) => p.id === id);
    if (hit) {
      await this.kv.set(K.permissions, perms.filter((p) => p.id !== id));
      this.deps.dapps.disconnected(hit.origin);
    } else {
      await this.deps.walletConnect.disconnect(id);
    }
    this.env.broadcast();
  }

  /* ------------------------------------------------------------------ DappHost (1Mask, WalletConnect) */

  readonly permissions: PermissionStoreLike = {
    has: async (origin, family) => ((await this.kv.get<Permission[]>(K.permissions)) ?? []).some((p) => p.origin === origin && p.family === family),
    grant: async (origin, family) => {
      const perms = (await this.kv.get<Permission[]>(K.permissions)) ?? [];
      if (perms.some((p) => p.origin === origin && p.family === family)) return;
      const acct = this.accounts.get(family);
      perms.push({ id: crypto.randomUUID(), origin, family, via: "injected", accountIds: acct ? [acct.id] : [], networkIds: [], connectedAt: Date.now() });
      await this.kv.set(K.permissions, perms);
      this.env.broadcast();
    },
    revoke: async (origin, family) => {
      const perms = (await this.kv.get<Permission[]>(K.permissions)) ?? [];
      await this.kv.set(K.permissions, perms.filter((p) => !(p.origin === origin && p.family === family)));
      this.env.broadcast();
    },
    origins: async () => [...new Set(((await this.kv.get<Permission[]>(K.permissions)) ?? []).map((p) => p.origin))],
  };

  async isUnlocked() {
    return (await this.deps.vault.status()) === "unlocked";
  }

  preferredNetwork(family: Family): string | undefined {
    const totals = new Map<string, number>();
    for (const { balances } of this.cache.values()) {
      for (const b of balances) if (!b.asset.spam) totals.set(b.asset.networkId, (totals.get(b.asset.networkId) ?? 0) + (b.fiatValue ?? 0));
    }
    const candidates = this.deps.networks.filter((n) => n.family === family);
    const best = [...candidates].sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))[0];
    if (best && (totals.get(best.id) ?? 0) > 0) return best.id;
    const fallback: Partial<Record<Family, string>> = { evm: "eip155:11155111" };
    return candidates.find((n) => n.id === fallback[family])?.id ?? candidates[0]?.id;
  }

  cachedAccount(family: Family): Account | undefined {
    return this.accounts.get(family);
  }

  async accountsFor(origin: string, family: Family): Promise<Account[]> {
    if (!(await this.permissions.has(origin, family))) return [];
    if (!(await this.isUnlocked())) return [];
    return [await this.siteAccount(family, origin)];
  }

  async approveConnect(p: Parameters<DappHost["approveConnect"]>[0]): Promise<boolean> {
    if (p.via === "injected" && (await this.accountsFor(p.origin, p.family)).length) return true;
    const { id, promise } = await this.enqueueConnect(p);
    await this.env.openApprovalWindow(id);
    try {
      await promise;
      return true;
    } catch {
      return false;
    }
  }

  async request(req: DappRequest, dapp?: { name?: string; iconUrl?: string; warnings?: Warning[] }): Promise<unknown> {
    const { id, promise } = await this.enqueueTransaction(req, this.dappInfo(req.origin, dapp?.name, dapp?.iconUrl), { warnings: dapp?.warnings });
    await this.env.openApprovalWindow(id);
    return promise;
  }

  cancel(requestId: string) {
    for (const [id, p] of this.approvals) {
      if (id === requestId || p.request?.id === requestId) {
        this.approvals.delete(id);
        p.reject(new ClipError("This request timed out. Ask the app to try again.", "approval/timeout"));
        this.env.broadcast();
      }
    }
  }

  async rpc(networkId: string, method: string, params: unknown): Promise<unknown> {
    const ctx = await this.ctx(networkId);
    const url = ctx.network.rpcUrls[0];
    if (!url) throw new ClipError("This network can't answer that right now.", "rpc/no-endpoint");
    const res = await withTimeout(
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) }),
      NETWORK_TIMEOUT_MS,
    ).catch(() => {
      throw new ClipError("The network didn't answer. Try again in a moment.", "rpc/unavailable");
    });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code?: number; message?: string } };
    if (body.error) throw Object.assign(new Error(body.error.message ?? "RPC error"), { code: body.error.code ?? -32603 });
    return body.result;
  }

  async chainRead(req: DappRequest): Promise<unknown> {
    const entry = this.deps.chains.cardano as (CardanoModule | LazyChainModule<CardanoModule>) | undefined;
    if (req.family !== "cardano" || !entry || !(CARDANO_METHODS_ALLOWED.readOnly as readonly string[]).includes(req.method)) {
      throw new ClipError("This request isn't available.", "chain-read/unsupported");
    }
    const m = "load" in entry ? await entry.load() : entry;
    if (typeof m.read !== "function") throw new ClipError("This request isn't available.", "chain-read/unsupported");
    return m.read(req.method as CardanoReadMethod, req.params, await this.ctx(req.networkId, req.origin));
  }

  /* ------------------------------------------------------------------ dev simulator (mock builds) */

  private async simulate(kind: "pay" | "connect" | "blind" | "approval-for-all"): Promise<string> {
    const evm = await this.account("evm");
    const base = "eip155:84532";
    const merchant = "000000000000000000000000c0ffee00000000000000000000000000000000ee".slice(-40);
    const usdc = this.deps.assets.find((a) => a.key === "usdc" && a.networkId === base)!;
    const transfer = (amount: bigint) =>
      `0xa9059cbb${merchant.padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
    const mk = (origin: string, method: string, params: unknown): DappRequest => ({
      id: crypto.randomUUID(),
      origin,
      via: "injected",
      family: "evm",
      networkId: base,
      method,
      params,
    });
    let out: { id: string; promise: Promise<unknown> };
    switch (kind) {
      case "connect":
        out = await this.enqueueConnect({ origin: "https://magiceden.io", family: "evm", networkId: base, via: "injected" });
        break;
      case "pay":
        out = await this.enqueueTransaction(
          mk("https://magiceden.io", "eth_sendTransaction", [{ from: evm.address, to: usdc.address, data: transfer(25_000_000n) }]),
          this.dappInfo("https://magiceden.io"),
        );
        break;
      case "blind":
        out = await this.enqueueTransaction(
          mk("https://app.uniswap.org", "eth_sendTransaction", [{ from: evm.address, to: `0x${merchant}`, data: "0x3593564c0000000000000000000000000000000000000000000000000000000000000060" }]),
          this.dappInfo("https://app.uniswap.org"),
        );
        break;
      case "approval-for-all":
        out = await this.enqueueTransaction(
          mk("https://free-mint-now.example", "eth_sendTransaction", [
            { from: evm.address, to: "0xc11b000000000000000000000000000000000001", data: `0xa22cb465${merchant.padStart(64, "0")}${"1".padStart(64, "0")}` },
          ]),
          this.dappInfo("https://free-mint-now.example", "Free Mint"),
        );
        break;
    }
    out.promise.catch(() => undefined);
    return out.id;
  }
}
