/**
 * THE seam. Everything the background needs from the other packages is created here, and nowhere else.
 *
 *   dependency         real (default build)                                  fixture mode (CLIP_MOCKS=1)
 *   -----------------  ----------------------------------------------------  ---------------------------
 *   vault              @clip-wallet/vault ClipVault                          same (always real)
 *   chain modules      @clip-wallet/chains-* (all 14 families)               mocks/mock-chains.ts
 *   networks/assets    chain packages via shared/catalog.ts + clip.config    mocks/networks.ts
 *   1Mask (injected)   @clip-wallet/1mask/background router (real.ts)        same router over the fixture networks
 *   WalletConnect      @clip-wallet/1mask/walletconnect (real.ts)            mocks/mock-dapps.ts
 *   route (funding)    @clip-wallet/route RouteClient (real.ts)              mocks/mock-route.ts
 *   prices             CoinGecko feed (features.ts)                          mocks/fixtures.ts
 *   names              @clip-wallet/names (ENS / SNS / Hedera names)         mocks/fixtures.ts
 *   backup service     @clip-wallet/backup-client if services.backupUrl set  none
 *   dapp registry      curated list (real.ts)                                same
 *
 * Fixture mode drives the UI with realistic balances, collectibles and dapp requests (dev simulator in
 * Settings) for screenshots and UI work. One chain-module instance per family lives for the background's
 * lifetime: modules keep prepare→finalize state keyed by request id.
 */
import type { Account, AssetRef, ChainContext, ChainModule, DappRequest, DecodedRequest, Family, Network, TokenBalance, Warning } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { ActivityEntry, ApprovalPlan, DappInfo, SessionView } from "@clip-wallet/ui";
import type { ClipConfig } from "@clip-wallet/config";
import { ClipVault, type PasskeyInfo, type PasskeyPrf } from "@clip-wallet/vault";
import { createEvmModule } from "@clip-wallet/chains-evm";
import { MIRROR_NODE_URLS, createHederaModule, type HederaModule } from "@clip-wallet/chains-hedera";
import { SettleFunding, settleClientFor, settleSourceNetworks } from "@clip-wallet/route";
import { isMainnetEnabled } from "@clip-wallet/config";
import { createSolanaModule } from "@clip-wallet/chains-solana";
import { createBitcoinModule } from "@clip-wallet/chains-bitcoin";
import type { CardanoModule } from "@clip-wallet/chains-cardano";
import type { createStarknetModule } from "@clip-wallet/chains-starknet";
import type { createTonModule } from "@clip-wallet/chains-ton";
import type { RouterPort } from "@clip-wallet/1mask/background";
import type { KV } from "../shared/storage";
import { vaultStorageOf } from "../shared/storage";
import { dappRequestNetworks, walletAssets, walletNetworks } from "../shared/catalog";
import { createMockChains } from "./mocks/mock-chains";
import { knownAssets, MOCK_NETWORKS } from "./mocks/networks";
import { MockWalletConnect } from "./mocks/mock-dapps";
import { MockRoutePlanner } from "./mocks/mock-route";
import { MOCK_HEDERA_EVM, MockSettleClient } from "./mocks/mock-settle";
import { MOCK_ACTIVITY, MockNameResolver, MockPriceFeed } from "./mocks/fixtures";
import {
  KnownDappRegistry,
  OneMaskConnector,
  RoutePlannerAdapter,
  WalletConnectAdapter,
} from "./real";
import { createPriceFeed } from "./features";
import { BackupClient } from "@clip-wallet/backup-client";
import { HardwareKeyring, type HardwareStorage } from "@clip-wallet/hardware/core";
import { MultiNameResolver, PluginBackend } from "@clip-wallet/names";
import type { PluginNameResult } from "@clip-wallet/plugins";
import { BACKUP_SERVICE_URL } from "../app-settings";

/** The vault surface the background uses: core's Vault plus ClipVault's extras. */
export interface WalletVault {
  status(): Promise<"empty" | "locked" | "unlocked">;
  create(password: string): Promise<void>;
  importPhrase(phrase: string, password: string): Promise<void>;
  revealPhrase(password: string): Promise<string>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  deriveAccount(family: Family, index: number): Promise<Account>;
  listAccounts(families?: readonly Family[]): Promise<Account[]>;
  addAccount(family: Family, label?: string): Promise<Account>;
  setAccountLabel(family: Family, index: number, label: string): Promise<void>;
  freshChange: ClipVault["freshChange"];
  listChange: ClipVault["listChange"];
  registerApproval(approvalId: string, payloadHashes: Uint8Array[], ttlMs: number): void;
  revokeApproval(approvalId: string): void;
  sign: ClipVault["sign"];
  enrollPasskey(password: string, prf: PasskeyPrf): Promise<PasskeyInfo>;
  unlockWithPasskey(prf: PasskeyPrf, credentialId?: Uint8Array): Promise<void>;
  listPasskeys(): Promise<PasskeyInfo[]>;
  removePasskey(credentialId: Uint8Array): Promise<void>;
  /** Encrypts the phrase under a passkey PRF output, inside the vault (platform: passkey backup). */
  createPasskeyBackup(password: string, prfOutput: Uint8Array): Promise<Uint8Array>;
  /** Decrypts a passkey backup and imports it into an empty vault, inside the vault. */
  restorePasskeyBackup(blob: Uint8Array, prfOutput: Uint8Array, password: string): Promise<void>;
}

/** CLPRouter: how a request gets paid for ("From: Your balance", funding moves, sponsored gas, ETA). */
export interface RoutePlanner {
  /** `account`: the paying account's address (Phase 3 Connector quotes deliver to it). */
  plan(p: { request: DappRequest; decoded: DecodedRequest; balances: TokenBalance[]; networks: Network[]; account?: string }): Promise<ApprovalPlan>;
}

/** 1Mask's PermissionStore shape (per-origin, per-family). */
export interface PermissionStoreLike {
  has(origin: string, family: Family): Promise<boolean>;
  grant(origin: string, family: Family): Promise<void>;
  revoke(origin: string, family: Family): Promise<void>;
  origins(): Promise<string[]>;
}

/** What 1Mask and WalletConnect call into. Implemented by the background service. */
export interface DappHost {
  /** Connect approval ("Connect to Magic Eden?"), no network picker. Resolves true when approved. */
  approveConnect(p: {
    origin: string;
    family: Family;
    networkId: string;
    via: "injected" | "walletconnect";
    name?: string;
    iconUrl?: string;
    warnings?: Warning[];
  }): Promise<boolean>;
  /** Signing/sending request: decode → approval window → vault → finalize. Rejects with ClipError. */
  request(req: DappRequest, dapp?: { name?: string; iconUrl?: string; warnings?: Warning[] }): Promise<unknown>;
  /** Accounts granted to an origin (the wallet picks the right one per family). */
  accountsFor(origin: string, family: Family): Promise<Account[]>;
  /** Network a site starts on for a family: where the user holds the most, else a sensible default. */
  preferredNetwork(family: Family): string | undefined;
  /** Synchronous view of the derived account (WalletConnect addressesFor). */
  cachedAccount(family: Family): Account | undefined;
  permissions: PermissionStoreLike;
  /** Read-only JSON-RPC proxy for dapps (eth_call etc.). */
  rpc(networkId: string, method: string, params: unknown): Promise<unknown>;
  /** Read-only chain calls answered by a chain module (CIP-30 getUtxos/getBalance/…/submitTx). */
  chainRead(req: DappRequest): Promise<unknown>;
  /**
   * Hedera extension discovery: pair with a WalletConnect code a page's DAppConnector handed the wallet, as if the
   * user had pasted it (the proposal still needs approval). Optional: hosts without WalletConnect leave it out.
   */
  pairWalletConnect?(uri: string): Promise<void>;
  isUnlocked(): Promise<boolean>;
  /** The connector gave up on a request (timeout / relay expiry): drop its approval. */
  cancel(requestId: string): void;
  /** A site on a loaded phishing list (security stream). Sync: WalletConnect's Verify check calls it. */
  isKnownScam?(origin: string): boolean;
  /** EIP-5792 Wallet Call API + ERC-7682 auxiliary funds (./calls.ts). Absent = the methods stay unsupported. */
  calls?: import("@clip-wallet/1mask").CallsHost;
}

/** 1Mask background router (inpage/content ports). */
export interface DappConnector {
  start(host: DappHost): void;
  attachPort?(port: RouterPort, senderOrigin?: string): void;
  /** The wallet disconnected an origin: tell the site. */
  disconnected(origin: string, family?: Family): void | Promise<void>;
  /** Accounts appeared/disappeared (unlock/lock). */
  accountsChanged?(): void;
}

export interface WalletConnectBridge {
  start(host: DappHost): void;
  pair(uri: string): Promise<void>;
  sessions(): Promise<SessionView[]>;
  disconnect(id: string): Promise<void>;
}

export interface PriceFeed {
  /** USD price per whole unit of an asset key. */
  usd(assetKey: string): number | undefined;
  /** Units of `currency` per USD. */
  fx(currency: string): number;
}

export interface NameResolver {
  /**
   * "alice.eth", "alice.hbar", "alice.sol" → address, or null. `networkIds` = networks the name points at
   * specifically (empty = any of its family); `addressOn` = ENS per-network address records.
   */
  resolve(name: string): Promise<{ address: string; displayName: string; networkIds?: string[]; addressOn?: Record<string, string>; byFamily?: Partial<Record<Family, string>> } | null>;
  /** Primary name for an address, for display. */
  reverse?(address: string, family: Family, networkId?: string): Promise<string | null>;
  /** Which service would answer this name ("ens", "plugin", …), or null. No network. */
  serviceFor?(name: string): string | null;
}

export interface DappRegistry {
  lookup(origin: string): Omit<DappInfo, "origin" | "domain">;
}

export interface Dependencies {
  /** True in fixture mode (mock chains/1Mask/route; dev simulator enabled). */
  mocks: boolean;
  vault: WalletVault;
  /** Only the families this build ships. Phase 2 families are LazyChainModules (see lazyChain). */
  chains: Partial<Record<Family, ChainModule>>;
  /** Loads every lazily loaded chain module (before using their synchronous members). */
  loadChains(): Promise<void>;
  networks: Network[];
  /** Assets each network can carry, even at zero balance (send/receive candidates). */
  assets: AssetRef[];
  route: RoutePlanner;
  dapps: DappConnector;
  walletConnect: WalletConnectBridge;
  prices: PriceFeed;
  names: NameResolver;
  registry: DappRegistry;
  /**
   * Hardware accounts (Ledger, Keystone): public data, approval binding and signature checks. The devices
   * are driven from the approval window (see hardware-host.ts); no device code is in the service worker.
   */
  hardware: HardwareKeyring;
  /** services/backup client factory; null when no backup service is configured (clip.config services.backupUrl). */
  backup: ((session: { token: string; expiresAt: number } | null) => BackupClient) | null;
  /** Hedera "0.0.x" for the account's EVM alias, if it exists yet. */
  hederaAccountId(ctx: ChainContext): Promise<string | undefined>;
  /** Seed activity (fixture mode only). */
  seedActivity: ActivityEntry[];
  /**
   * Networks the wallet signs and decodes requests on but never lists or scans: Hedera's EVM (eip155:296/295) for
   * the settle-on-Hedera client's claim / withdraw, only when route.settleOnHedera is on.
   */
  requestNetworks?: Network[];
  /** Paying through a bonded Connector (settle on Hedera): the same instance the route planner quotes with. Null = off. */
  settleFunding?: import("@clip-wallet/route").SettleFunding | null;
  /** ERC-7682: networks auxiliary funds can come from (settle on Hedera's deposit networks). Empty/absent = not advertised. */
  auxiliaryFundsSources?: string[];
  /**
   * Names answered by Clip Plugins: the name resolver asks this last (built-ins always win). The service binds it to
   * the running plugins (background/plugins.ts); unbound, plugin names resolve to nothing.
   */
  pluginNames: PluginNameHook;
}

/** Late-bound link between the name resolver (built here) and the plugins (built by the service). */
export interface PluginNameHook {
  lookup: (name: string) => Promise<PluginNameResult | null>;
  suffixes: () => string[];
}

export function pluginNameHook(): PluginNameHook {
  return { lookup: async () => null, suffixes: () => [] };
}

export type StarknetModule = ReturnType<typeof createStarknetModule>;
export type TonModule = ReturnType<typeof createTonModule>;

/** A chain module whose code is evaluated on first use. `load()` resolves the real module. */
export type LazyChainModule<M extends ChainModule = ChainModule> = ChainModule & { load(): Promise<M> };

/**
 * Phase 2 families load on first use. WXT bundles `import()` targets into the service worker but evaluates
 * them only when called (MV3 workers can't fetch chunks), so a worker woken for an alarm, a lock or an EVM
 * dapp call doesn't evaluate ten chain SDKs. Async members wait for the module; the synchronous ones
 * (isAddress, networksForAddress, addressFromPublicKey, derivationPath) need it loaded first:
 * WalletService awaits `loadChains()` before using them.
 */
export function lazyChain<M extends ChainModule>(family: Family, curve: ChainModule["curve"], loader: () => Promise<M>): LazyChainModule<M> {
  let mod: M | undefined;
  let p: Promise<M> | undefined;
  const load = () => (p ??= loader().then((m) => (mod = m)));
  const now = (): M => {
    if (!mod) throw new ClipError("This kind of account is still loading. Try again in a moment.", "family-loading");
    return mod;
  };
  return {
    family,
    curve,
    load,
    derivationPath: (i) => now().derivationPath(i),
    addressFromPublicKey: (k, n) => now().addressFromPublicKey(k, n),
    isAddress: (v) => now().isAddress(v),
    networksForAddress: (v, c) => now().networksForAddress(v, c),
    getBalances: async (ctx) => (await load()).getBalances(ctx),
    getNfts: async (ctx) => (await load()).getNfts(ctx),
    decode: async (r, ctx) => (await load()).decode(r, ctx),
    prepare: async (r, ctx, id) => (await load()).prepare(r, ctx, id),
    finalize: async (r, s, ctx) => (await load()).finalize(r, s, ctx),
    buildTransfer: async (x, ctx) => (await load()).buildTransfer(x, ctx),
    receiveAddress: async (ctx) => {
      const m = await load();
      return m.receiveAddress ? m.receiveAddress(ctx) : ctx.account.address;
    },
  };
}

export interface WiringOptions {
  kv: KV;
  mocks: boolean;
  config: ClipConfig;
  /** Display currency lookup (route fees in fiat). */
  currency: () => Promise<string>;
  /** Bundled icon URL for WalletConnect metadata. */
  iconUrl: string;
  /** Partner keys for features (from build env; never committed). */
  features?: import("@clip-wallet/features").FeaturesConfig & { coingeckoDemoKey?: string };
  /** Tests pass cheap Argon2 params; production uses the vault's defaults. */
  vaultOptions?: Partial<ConstructorParameters<typeof ClipVault>[0]>;
}

/** Vault backstop: the background's alarm enforces the user's (shorter) auto-lock setting. */
const VAULT_MAX_IDLE_MS = 60 * 60 * 1000;

export function createDependencies(opts: WiringOptions): Dependencies {
  // Vault-v2 defaults (all testnet): cardanoNetwork "testnet", tonNetwork "testnet", tonWalletVersion "v5r1",
  // algorandScheme "arc52", starknetScheme "argent-x", starknetAccountClassHash STARKNET_OZ_ACCOUNT_CLASS_HASH.
  // The chain modules below are created with the matching defaults (TON v5r1, Starknet OpenZeppelin, Algorand ARC-52).
  const vault = new ClipVault({ storage: vaultStorageOf(opts.kv), autoLockMs: VAULT_MAX_IDLE_MS, ...opts.vaultOptions });
  const registry = new KnownDappRegistry();
  const hwStorage: HardwareStorage = { get: (k) => opts.kv.get<string>(k), set: (k, v) => opts.kv.set(k, v) };
  const hw = { hardware: new HardwareKeyring({ storage: hwStorage }) };

  if (opts.mocks) {
    // Settle on Hedera against a mock Connector and order book (dev simulator "settle" / "settle-late").
    const mockSettle = new SettleFunding(new MockSettleClient());
    return {
      mocks: true,
      vault,
      chains: createMockChains(),
      loadChains: async () => undefined,
      networks: MOCK_NETWORKS,
      assets: knownAssets(MOCK_NETWORKS),
      route: new MockRoutePlanner(mockSettle),
      settleFunding: mockSettle,
      // The mock Connector takes payment on any fixture EVM network (it answers only while the simulator arms it).
      auxiliaryFundsSources: MOCK_NETWORKS.filter((n) => n.id.startsWith("eip155:")).map((n) => n.id),
      requestNetworks: [MOCK_HEDERA_EVM],
      // The real 1Mask router over the fixture networks: test pages (e2e) reach mock chains through the real dapp path.
      dapps: new OneMaskConnector(MOCK_NETWORKS),
      walletConnect: new MockWalletConnect(),
      prices: new MockPriceFeed(),
      names: new MockNameResolver(),
      registry,
      ...hw,
      backup: null,
      hederaAccountId: async () => "0.0.4815162",
      seedActivity: MOCK_ACTIVITY,
      pluginNames: pluginNameHook(),
    };
  }

  const networks = walletNetworks(opts.config);
  const hedera: HederaModule = createHederaModule();
  // OpenZeppelin v0.17.0 = the vault's default Starknet address; TON v5r1 = the vault's default wallet.
  // Algorand must match the vault's algorandScheme (default ARC-52 BIP32-Ed25519).
  const starknet = lazyChain("starknet", "stark", () => import("@clip-wallet/chains-starknet").then((m) => m.createStarknetModule()));
  const ton = lazyChain("ton", "ed25519", () => import("@clip-wallet/chains-ton").then((m) => m.createTonModule()));
  const cardano = lazyChain("cardano", "bip32-ed25519", () => import("@clip-wallet/chains-cardano").then((m) => m.createCardanoModule() as CardanoModule));
  const lazy = {
    sui: lazyChain("sui", "ed25519", () => import("@clip-wallet/chains-sui").then((m) => m.createSuiModule())),
    aptos: lazyChain("aptos", "ed25519", () => import("@clip-wallet/chains-aptos").then((m) => m.createAptosModule())),
    near: lazyChain("near", "ed25519", () => import("@clip-wallet/chains-near").then((m) => m.createNearModule())),
    stellar: lazyChain("stellar", "ed25519", () => import("@clip-wallet/chains-stellar").then((m) => m.createStellarModule())),
    tezos: lazyChain("tezos", "ed25519", () => import("@clip-wallet/chains-tezos").then((m) => m.createTezosModule())),
    algorand: lazyChain("algorand", "bip32-ed25519", () => import("@clip-wallet/chains-algorand").then((m) => m.createAlgorandModule())),
    cardano,
    substrate: lazyChain("substrate", "sr25519", () => import("@clip-wallet/chains-substrate").then((m) => m.createSubstrateModule())),
    starknet,
    ton,
  };
  const prices = createPriceFeed(opts.kv, opts.features?.coingeckoDemoKey);
  const eager = { evm: createEvmModule(), hedera, solana: createSolanaModule(), bitcoin: createBitcoinModule() };
  // Clip-handle records are checked with each family's own address rules; lazy families join once loaded.
  const clipValidators: Partial<Record<Family, (a: string) => boolean>> = {};
  for (const [f, m] of Object.entries(eager)) clipValidators[f as Family] = (a) => m.isAddress(a);
  const pluginNames = pluginNameHook();
  // Phase 3 "settle on Hedera": only with route.settleOnHedera and a known deployment (testnet only).
  const mainnetOn = isMainnetEnabled(opts.config);
  const settle = settleClientFor({ enabled: opts.config.route.settleOnHedera, mainnet: mainnetOn, mirrorNodeUrl: MIRROR_NODE_URLS[mainnetOn ? "mainnet" : "testnet"] });
  const settleFunding = settle ? new SettleFunding(settle) : null;
  // Hedera's EVM (296/295): dapps reach it over EIP-1193 and the wallet signs there, but it is never listed or scanned.
  const requestNetworks = dappRequestNetworks(networks, { mainnet: mainnetOn, settleOnHedera: !!settle });
  return {
    mocks: false,
    vault,
    chains: {
      ...eager,
      ...lazy,
    },
    loadChains: async () => {
      await Promise.all(Object.values(lazy).map((m) => m.load()));
      for (const [f, m] of Object.entries(lazy)) clipValidators[f as Family] ??= (a) => m.isAddress(a);
    },
    networks,
    assets: walletAssets(networks),
    route: new RoutePlannerAdapter(opts.config, prices, opts.currency, settleFunding),
    settleFunding,
    auxiliaryFundsSources: settleFunding ? settleSourceNetworks(mainnetOn) : [],
    ...(requestNetworks.length ? { requestNetworks } : {}),
    dapps: new OneMaskConnector([...networks, ...requestNetworks], { beacon: { kv: opts.kv, name: opts.config.name, iconUrl: opts.iconUrl }, starknet: starknet.load, ton: ton.load }),
    walletConnect: new WalletConnectAdapter(opts.config, networks, opts.iconUrl),
    prices,
    // ENS (.eth), SNS (.sol), Hedera names (.hbar …) and Clip handles, limited to the networks this wallet has;
    // then names from Clip Plugins (only suffixes no built-in handles; labelled "from <plugin>").
    names: new MultiNameResolver({
      networks,
      clip: { isAddress: clipValidators, ...(opts.config.services.clipHandles ?? {}) },
      extra: [new PluginBackend((n) => pluginNames.lookup(n), () => pluginNames.suffixes())],
    }),
    pluginNames,
    registry,
    ...hw,
    backup: BACKUP_SERVICE_URL ? (session) => new BackupClient({ baseUrl: BACKUP_SERVICE_URL!, session }) : null,
    hederaAccountId: async (ctx) => (await hedera.getAccountState(ctx)).accountId ?? undefined,
    seedActivity: [],
  };
}
