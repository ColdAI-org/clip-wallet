/**
 * WalletEngine: the wallet's orchestration, environment-agnostic. A reimplementation of the extension's
 * background service (apps/extension/src/background/service.ts) on injected seams so the same logic runs in
 * an MV3 service worker, a React Native app (Hermes) or a test:
 *
 *   storage  KV (public data) + the host-constructed vault (ciphertext via its own VaultStorage)
 *   crypto   env.randomUUID + deps.hashPayload (the vault's hashSignablePayload)
 *   network  env.fetch
 *   UI       env.openApproval / env.broadcast / env.armAutoLock
 *
 * Owns approvals, permissions, the portfolio cache, activity and prefs. Never returns key material,
 * except revealPhrase for the onboarding screen.
 */
import type { Account, AssetRef, ChainContext, DappRequest, DecodedRequest, Family, Network, Nft, TokenBalance, Warning } from "@clip-wallet/core";
import { ClipError, type ChainModule } from "@clip-wallet/core";
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
import { CARDANO_METHODS_ALLOWED, type RouterPort } from "@clip-wallet/1mask/background";
import type { CardanoModule, CardanoReadMethod } from "@clip-wallet/chains-cardano";
import { isFeatureRequest, type FeatureRequest } from "@clip-wallet/features/messages";
import type { FeaturesService } from "@clip-wallet/features";
import { PlatformService, type PlatformRequest } from "./platform.js";
import type { KV } from "./kv.js";
import { EngineRequest, type EngineResponseMap } from "./messages.js";
import { PasskeyCeremonies } from "./passkey-ceremonies.js";
import type { DappHost, Dependencies, EngineEnv, PasskeyInfoLike, PermissionStoreLike, PrfProvider } from "./types.js";

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

export const KV_KEYS = {
  prefs: "clip/prefs",
  accounts: "clip/accounts",
  permissions: "clip/permissions",
  activity: "clip/activity",
  recipients: "clip/recipients",
} as const;
const K = KV_KEYS;

const CACHE_TTL_MS = 30_000;
const NETWORK_TIMEOUT_MS = 10_000;
export const APPROVAL_TTL_MS = 2 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error("timeout")), ms)))]).finally(() => clearTimeout(t));
}

function parseUnits(value: string, decimals: number): bigint {
  const [w = "0", f = ""] = value.split(".");
  if (f.length > decimals) throw new ClipError(`That amount has too many decimal places.`, "send/precision");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
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

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export class WalletEngine implements DappHost {
  private accounts = new Map<Family, Account>();
  private approvals = new Map<string, Pending>();
  private cache = new Map<string, { at: number; balances: TokenBalance[]; nfts?: Nft[] }>();
  private ceremonies: PasskeyCeremonies;
  private readonly now: () => number;
  private features?: Pick<FeaturesService, "handle" | "refine">;
  /** Passkey backup, phrase-backup flag, multiple accounts (per-site active account), name lookups. */
  readonly platform: PlatformService;

  constructor(
    readonly deps: Dependencies,
    private readonly kv: KV,
    private readonly env: EngineEnv,
  ) {
    this.now = env.now ?? (() => Date.now());
    this.ceremonies = new PasskeyCeremonies(
      () => env.passkey?.() ?? { rpId: null, rpName: env.walletName, mode: "native", bridgeUrl: "" },
      () => env.randomUUID(),
      randomBytes,
    );
    const names = deps.names;
    this.platform = new PlatformService({
      vault: deps.vault,
      kv,
      ceremonies: this.ceremonies,
      ceremonyMeta: () => env.passkey?.() ?? { rpId: null, rpName: env.walletName, mode: "native", bridgeUrl: "" },
      backup: deps.backup ?? null,
      families: () => this.families,
      hederaAccountId: (account) => {
        const network = deps.networks.find((n) => n.family === "hedera");
        return network ? deps.hederaAccountId({ network, account, fetch: env.fetch }) : Promise.resolve(undefined);
      },
      ...(names.reverse ? { names: { reverse: (a, f, n) => names.reverse!(a, f, n) } } : {}),
      changed: () => {
        this.accounts.clear();
        this.cache.clear();
        this.deps.dapps.accountsChanged?.();
        env.broadcast();
      },
      onRestored: () => this.afterUnlock(),
      now: this.now,
    });
  }

  /* ------------------------------------------------------------------ features (staking, swap, buy, trade, explore) */

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
    return this.enqueueTransaction(request, { name: appName, origin: "wallet", domain: appName, verified: true });
  }
  async decodeForFeatures(request: DappRequest): Promise<DecodedRequest> {
    const network = this.network(request.networkId);
    return this.module(network.family).decode(request, await this.ctx(network.id, request.origin));
  }

  start() {
    this.deps.dapps.start(this);
    this.deps.walletConnect.start(this);
  }

  /** Families this wallet derives accounts for (from its enabled networks). */
  get families(): Family[] {
    return [...new Set(this.deps.networks.map((n) => n.family))];
  }

  get walletConnectEnabled(): boolean {
    return this.deps.walletConnect.enabled;
  }

  /** Wire an injected-provider port (extension content script, mobile WebView bridge). */
  attachDappPort(port: RouterPort, senderOrigin: string) {
    this.deps.dapps.attachPort?.(port, senderOrigin);
  }

  /* ------------------------------------------------------------------ untrusted entry (bus) */

  /** Validates an untrusted message (zod) and runs it. Throws ClipError with a plain userMessage. */
  async handleUntrusted(msg: unknown): Promise<unknown> {
    const parsed = EngineRequest.safeParse(msg);
    if (!parsed.success) throw new ClipError("Something went wrong. Please try again.", "bus/invalid");
    return this.handle(parsed.data);
  }

  async handle<T extends EngineRequest["type"]>(msg: Extract<EngineRequest, { type: T }>): Promise<EngineResponseMap[T]> {
    const m = msg as EngineRequest;
    const status = await this.deps.vault.status();
    if (status === "unlocked") this.env.armAutoLock((await this.prefs()).autoLockMinutes);
    return (await this.dispatch(m, status)) as EngineResponseMap[T];
  }

  private requireUnlocked(status: string) {
    if (status !== "unlocked") throw new ClipError("Your wallet is locked. Unlock it to continue.", "vault/locked");
  }

  private async dispatch(m: EngineRequest, status: "empty" | "locked" | "unlocked"): Promise<unknown> {
    // Platform messages check their own lock state (restore runs while the vault is empty).
    if (this.platform.handles(m.type)) return this.platform.handle(m as PlatformRequest);
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
      case "passkeyRemove":
        await this.removePasskeys();
        return;
      case "openFullTab":
        await this.env.openRoute?.(m.route ?? "/");
        return;
    }

    this.requireUnlocked(status);
    if (isFeatureRequest(m)) {
      if (!this.features) throw new ClipError("This isn't available in this build.", "features/off");
      return this.features.handle(m as FeatureRequest);
    }
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
    }
  }

  /* ------------------------------------------------------------------ passkeys in the same context (mobile) */

  /**
   * Enrol a PRF provider that runs in this JS context (react-native-passkey, or the biometric device key).
   * The vault re-checks the password, then wraps its key under the PRF output.
   */
  async enrollPasskeyWith(password: string, prf: PrfProvider): Promise<PasskeyInfoLike> {
    this.requireUnlocked(await this.deps.vault.status());
    const info = await this.deps.vault.enrollPasskey(password, prf);
    this.env.broadcast();
    return info;
  }

  async listPasskeys(): Promise<PasskeyInfoLike[]> {
    return (await this.deps.vault.status()) === "empty" ? [] : this.deps.vault.listPasskeys();
  }

  async removePasskey(credentialId: Uint8Array): Promise<void> {
    await this.deps.vault.removePasskey(credentialId);
    this.env.broadcast();
  }

  async unlockWithPasskeyWith(prf: PrfProvider, credentialId?: Uint8Array): Promise<void> {
    await this.deps.vault.unlockWithPasskey(prf, credentialId);
    await this.afterUnlock();
  }

  async removePasskeys(): Promise<void> {
    for (const p of await this.deps.vault.listPasskeys()) await this.deps.vault.removePasskey(p.credentialId);
    this.env.broadcast();
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
    this.accounts.clear();
    for (const [id, p] of this.approvals) {
      this.approvals.delete(id);
      p.reject(new ClipError("Your wallet locked before you answered. Try again.", "vault/locked"));
    }
    this.deps.dapps.accountsChanged?.();
    this.env.broadcast();
  }

  /** Derives account 0 for every enabled family (public data only) and caches it. */
  private async afterUnlock() {
    this.accounts.clear();
    for (const f of this.families) this.accounts.set(f, await this.platform.activeAccount(f));
    const hedera = this.deps.networks.find((n) => n.family === "hedera");
    const hAcct = this.accounts.get("hedera");
    if (hedera && hAcct) {
      const id = await withTimeout(this.deps.hederaAccountId({ network: hedera, account: hAcct, fetch: this.env.fetch }), 5000).catch(() => undefined);
      if (id) hAcct.hederaAccountId = id;
    }
    this.deps.dapps.accountsChanged?.();
    await this.kv.set(K.accounts, [...this.accounts.values()]);
    this.env.armAutoLock((await this.prefs()).autoLockMinutes);
    this.env.broadcast();
  }

  /** The wallet's account for a family (Settings → Accounts default; account 0 until chosen). */
  private async account(family: Family): Promise<Account> {
    let a = this.accounts.get(family);
    if (!a) {
      a = await this.platform.activeAccount(family);
      this.accounts.set(family, a);
    }
    return a;
  }

  /** The account a site sees: its own choice in Settings → Accounts, else the wallet's account. */
  private async siteAccount(family: Family, origin: string): Promise<Account> {
    try {
      return (await this.platform.siteChoice(family, origin)) ? await this.platform.activeAccount(family, origin) : await this.account(family);
    } catch (e) {
      // An origin that isn't a URL (some WalletConnect peers) can't have its own choice: use the default.
      if (e instanceof ClipError && e.code === "accounts/bad-origin") return this.account(family);
      throw e;
    }
  }

  private module(family: Family): ChainModule {
    const m = this.deps.chains[family];
    if (!m) throw new ClipError("This kind of account isn't available in this version yet.", "family-unavailable");
    return m;
  }

  private network(id: string): Network {
    const n = this.deps.networks.find((x) => x.id === id);
    if (!n) throw new ClipError("That network isn't available in this wallet.", "network/unknown");
    return n;
  }

  /** `origin` (a dapp request): sign with the account that site sees; otherwise the wallet's account. */
  private async ctx(networkId: string, origin?: string): Promise<ChainContext> {
    const network = this.network(networkId);
    const override = (await this.prefs()).rpcOverrides[networkId];
    const account = origin && origin !== "wallet" ? await this.siteAccount(network.family, origin) : await this.account(network.family);
    const base: ChainContext = {
      network: override ? { ...network, rpcUrls: [override, ...network.rpcUrls] } : network,
      account,
      fetch: this.env.fetch,
    };
    if (network.family !== "bitcoin") return base;
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
        if (hit && !refresh && this.now() - hit.at < CACHE_TTL_MS) {
          out.push(...hit.balances);
          return;
        }
        try {
          const raw = await withTimeout(this.module(n.family).getBalances(await this.ctx(n.id)), NETWORK_TIMEOUT_MS);
          const balances = await Promise.all(raw.map(async (b) => ({ ...b, fiatValue: await this.fiat(b.asset, BigInt(b.amount)) })));
          this.cache.set(n.id, { at: this.now(), balances, nfts: hit?.nfts });
          out.push(...balances);
        } catch {
          stale.push(n.id);
          if (hit) out.push(...hit.balances);
        }
      }),
    );
    return {
      balances: out,
      assets: this.deps.assets,
      networks: this.deps.networks.map((n) => this.networkView(n)),
      currency: (await this.prefs()).displayCurrency,
      updatedAt: this.now(),
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
    return all.flat();
  }

  private async activity(): Promise<ActivityEntry[]> {
    const stored = await this.kv.get<ActivityEntry[]>(K.activity);
    if (stored) return stored;
    const seed = this.deps.seedActivity ?? [];
    await this.kv.set(K.activity, seed);
    return seed;
  }

  private async addActivity(e: ActivityEntry) {
    const list = await this.activity();
    await this.kv.set(K.activity, [e, ...list].slice(0, 200));
  }

  /* ------------------------------------------------------------------ send / receive */

  async resolveRecipient(input: string, assetKey: string): Promise<RecipientResolution> {
    let address = input.trim();
    let displayName: string | undefined;
    // ENS (.eth and subdomains), SNS (.sol), Hedera names (.hbar, .boo, .cream).
    const looksLikeName = /^[^\s/:]+\.(eth|sol|hbar|boo|cream)$/i.test(address);
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
      address = hit.address;
      displayName = hit.displayName;
      implied = hit.networkIds ?? [];
      addressOn = hit.addressOn ?? {};
    }
    const carrying = this.deps.networks.filter((n) => this.deps.assets.some((a) => a.key === assetKey && a.networkId === n.id));
    const recognised = this.families.filter((f) => this.deps.chains[f]?.isAddress(address));
    if (recognised.length === 0) return { kind: "invalid", message: "That doesn't look like an address. Check it and try again." };
    const all = recognised.flatMap((f) => this.module(f).networksForAddress(address, carrying.filter((n) => n.family === f)));
    // A name that points at specific networks narrows the choice (no prompt when only one is left).
    const narrowed = implied.length ? all.filter((n) => implied.includes(n.id)) : all;
    const candidates = narrowed.length ? narrowed : all;
    const on = (nid: string) => addressOn[nid] ?? address;
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

  private async send(m: Extract<EngineRequest, { type: "send" }>): Promise<string> {
    const asset = this.deps.assets.find((a) => a.key === m.assetKey && a.networkId === m.networkId);
    if (!asset) throw new ClipError("That asset can't be sent there.", "send/asset");
    const network = this.network(m.networkId);
    const mod = this.module(network.family);
    // Re-check the recipient here: never trust the screen's network choice blindly.
    // Names are re-resolved, using the name's own address for this network when it has one (ENS per-chain).
    let to = m.to;
    if (!mod.isAddress(to)) {
      const hit = await this.deps.names.resolve(to).catch(() => null);
      const resolved = hit ? (hit.addressOn?.[m.networkId] ?? hit.address) : "";
      if (!resolved || !mod.isAddress(resolved)) throw new ClipError("That doesn't look like an address. Check it and try again.", "send/address");
      to = resolved;
    }
    const amount = parseUnits(m.amount, asset.decimals);
    if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "send/amount");
    const ctx = await this.ctx(network.id);
    const request = await mod.buildTransfer({ asset, to, amount: amount.toString() }, ctx);
    const { id, promise } = await this.enqueueTransaction(
      request,
      { name: this.env.walletName, origin: "wallet", domain: `to ${short(to)}`, verified: true },
      { recipient: to },
    );
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

  private deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
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
        warnings: [{ level: "danger", code: "blind-signing", message: `${this.env.walletName} can't read this request.` }],
        networkId: network.id,
      };
    }
    decoded = this.features?.refine(request, decoded) ?? decoded;
    if (decoded.fee) decoded.fee.fiatValue ??= await this.fiat(decoded.fee.asset, BigInt(decoded.fee.amount));
    let fiatValue: number | undefined;
    for (const c of decoded.balanceChanges) {
      if (!c.delta.startsWith("-")) continue;
      const v = await this.fiat(c.asset, BigInt(c.delta.slice(1)));
      if (v !== undefined) fiatValue = (fiatValue ?? 0) + v;
    }
    if (extra.warnings?.length) decoded.warnings = [...decoded.warnings, ...extra.warnings];
    if (!this.deps.registry.lookup(request.origin).verified && request.origin !== "wallet" && !decoded.warnings.some((w) => w.code === "domain-mismatch")) {
      decoded.warnings.push({ level: "caution", code: "domain-mismatch", message: `${domainOf(request.origin)} isn't a site ${this.env.walletName} recognises. Only continue if you opened it yourself.` });
    }
    if (extra.recipient) decoded.lines = [{ label: "To", value: short(extra.recipient) }, ...decoded.lines];
    const { balances } = await this.portfolio();
    const plan = decoded.blind ? undefined : await this.deps.route.plan({ request, decoded, balances, networks: this.deps.networks });

    const id = this.env.randomUUID();
    const view: ApprovalView = {
      id,
      kind: "transaction",
      createdAt: this.now(),
      dapp,
      network: this.networkView(network),
      via: request.origin === "wallet" ? "wallet" : request.via,
      decoded,
      fiatValue,
      plan,
      raw: JSON.stringify({ method: request.method, params: request.params }, null, 2).slice(0, 4000),
    };
    const d = this.deferred<unknown>();
    this.approvals.set(id, { view, request, resolve: d.resolve, reject: d.reject });
    this.env.broadcast();
    return { id, promise: d.promise };
  }

  private async enqueueConnect(p: { origin: string; family: Family; networkId: string; via: "injected" | "walletconnect"; name?: string; iconUrl?: string; warnings?: Warning[] }) {
    const account = await this.siteAccount(p.family, p.origin);
    const id = this.env.randomUUID();
    const network = this.network(p.networkId);
    const view: ApprovalView = {
      id,
      kind: "connect",
      createdAt: this.now(),
      dapp: this.dappInfo(p.origin, p.name, p.iconUrl),
      network: this.networkView(network),
      via: p.via,
      connect: {
        accountLabel: "wallet address",
        address: account.hederaAccountId ?? account.address,
        permissions: ["See your address and what you hold", "Ask you to approve payments and signatures"],
      },
    };
    const d = this.deferred<unknown>();
    this.approvals.set(id, { view, connect: { origin: p.origin, family: p.family, via: p.via, account }, resolve: d.resolve, reject: d.reject });
    this.env.broadcast();
    return { id, promise: d.promise as Promise<Account[]> };
  }

  private async approve(id: string, allowBlind: boolean): Promise<void> {
    const p = this.approvals.get(id);
    if (!p) throw new ClipError("This request is no longer waiting. It may have expired.", "approval/gone");

    if (p.connect) {
      const perms = (await this.kv.get<Permission[]>(K.permissions)) ?? [];
      const existing = perms.filter((x) => !(x.origin === p.connect!.origin && x.family === p.connect!.family));
      existing.push({
        id: this.env.randomUUID(),
        origin: p.connect.origin,
        family: p.connect.family,
        via: p.connect.via,
        accountIds: [p.connect.account.id],
        networkIds: [p.view.network.id],
        connectedAt: this.now(),
        name: p.view.dapp.name,
      });
      await this.kv.set(K.permissions, existing);
      this.approvals.delete(id);
      await this.addActivity({ id, title: `Connected to ${p.view.dapp.name}`, kind: "connect", app: { name: p.view.dapp.name, origin: p.view.dapp.origin }, timestamp: this.now(), status: "done", legs: [] });
      p.resolve([p.connect.account]);
      this.env.broadcast();
      return;
    }

    const req = p.request!;
    const decoded = p.view.decoded!;
    if (p.view.plan?.problem) throw new ClipError(p.view.plan.problem, "approval/not-payable");
    if (decoded.blind && !((await this.prefs()).advanced && allowBlind)) {
      throw new ClipError("This request can't be read, so it was blocked. Only Advanced mode can override that.", "approval/blind-blocked");
    }
    const network = this.network(req.networkId);
    const mod = this.module(network.family);
    const ctx = await this.ctx(network.id, req.origin);
    let result: unknown;
    try {
      const payloads = await mod.prepare(req, ctx, id);
      this.deps.vault.registerApproval(id, payloads.map((x) => this.deps.hashPayload(x)), APPROVAL_TTL_MS);
      const sigs = [];
      for (const payload of payloads) sigs.push(await this.deps.vault.sign(payload));
      result = await mod.finalize(req, sigs, ctx);
    } catch (e) {
      this.deps.vault.revokeApproval(id);
      throw e instanceof ClipError ? e : new ClipError("That didn't go through. Nothing left your balance.", "approval/failed", e);
    }
    this.approvals.delete(id);
    this.cache.clear();
    await this.addActivity(this.activityFor(p.view, result));
    p.resolve(result);
    this.env.broadcast();
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
      timestamp: this.now(),
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
      perms.push({ id: this.env.randomUUID(), origin, family, via: "injected", accountIds: acct ? [acct.id] : [], networkIds: [], connectedAt: this.now() });
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
    if (!(await this.isUnlocked())) throw new ClipError("Unlock your wallet, then try connecting again.", "vault/locked");
    const { id, promise } = await this.enqueueConnect(p);
    await this.env.openApproval(id);
    try {
      await promise;
      return true;
    } catch {
      return false;
    }
  }

  async request(req: DappRequest, dapp?: { name?: string; iconUrl?: string; warnings?: Warning[] }): Promise<unknown> {
    if (!(await this.isUnlocked())) throw new ClipError("Unlock your wallet, then try again.", "vault/locked");
    const { id, promise } = await this.enqueueTransaction(req, this.dappInfo(req.origin, dapp?.name, dapp?.iconUrl), { warnings: dapp?.warnings });
    await this.env.openApproval(id);
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

  async chainRead(req: DappRequest): Promise<unknown> {
    const m = this.deps.chains.cardano as CardanoModule | undefined;
    if (req.family !== "cardano" || !m || typeof m.read !== "function" || !(CARDANO_METHODS_ALLOWED.readOnly as readonly string[]).includes(req.method)) {
      throw new ClipError("This request isn't available.", "chain-read/unsupported");
    }
    return m.read(req.method as CardanoReadMethod, req.params, await this.ctx(req.networkId, req.origin));
  }

  async rpc(networkId: string, method: string, params: unknown): Promise<unknown> {
    const ctx = await this.ctx(networkId);
    const url = ctx.network.rpcUrls[0];
    if (!url) throw new ClipError("This network can't answer that right now.", "rpc/no-endpoint");
    const res = await withTimeout(
      this.env.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) }),
      NETWORK_TIMEOUT_MS,
    ).catch(() => {
      throw new ClipError("The network didn't answer. Try again in a moment.", "rpc/unavailable");
    });
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code?: number; message?: string } };
    if (body.error) throw Object.assign(new Error(body.error.message ?? "RPC error"), { code: body.error.code ?? -32603 });
    return body.result;
  }
}
