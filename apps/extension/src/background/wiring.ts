/**
 * THE seam. Everything the background needs from the other packages is created here, and nowhere else.
 *
 *   dependency         real (default build)                                  fixture mode (CLIP_MOCKS=1)
 *   -----------------  ----------------------------------------------------  ---------------------------
 *   vault              @clip-wallet/vault ClipVault                          same (always real)
 *   chain modules      @clip-wallet/chains-* (all 14 families)               mocks/mock-chains.ts
 *   networks/assets    chain packages via shared/catalog.ts + clip.config    mocks/networks.ts
 *   1Mask (injected)   @clip-wallet/1mask/background router (real.ts)        mocks/mock-dapps.ts
 *   WalletConnect      @clip-wallet/1mask/walletconnect (real.ts)            mocks/mock-dapps.ts
 *   route (funding)    @clip-wallet/route RouteClient (real.ts)              mocks/mock-route.ts
 *   prices             CoinGecko feed (features.ts)                          mocks/fixtures.ts
 *   names              none yet (real.ts)                                    mocks/fixtures.ts
 *   dapp registry      curated list (real.ts)                                same
 *
 * Fixture mode drives the UI with realistic balances, collectibles and dapp requests (dev simulator in
 * Settings) for screenshots and UI work. One chain-module instance per family lives for the background's
 * lifetime: modules keep prepare→finalize state keyed by request id.
 */
import type { Account, AssetRef, ChainContext, ChainModule, DappRequest, DecodedRequest, Family, Network, TokenBalance, Warning } from "@clip-wallet/core";
import type { ActivityEntry, ApprovalPlan, DappInfo, SessionView } from "@clip-wallet/ui";
import type { ClipConfig } from "@clip-wallet/config";
import { ClipVault, type PasskeyInfo, type PasskeyPrf } from "@clip-wallet/vault";
import { createEvmModule } from "@clip-wallet/chains-evm";
import { createHederaModule, type HederaModule } from "@clip-wallet/chains-hedera";
import { createSolanaModule } from "@clip-wallet/chains-solana";
import { createBitcoinModule } from "@clip-wallet/chains-bitcoin";
import { createSuiModule } from "@clip-wallet/chains-sui";
import { createAptosModule } from "@clip-wallet/chains-aptos";
import { createNearModule } from "@clip-wallet/chains-near";
import { createStellarModule } from "@clip-wallet/chains-stellar";
import { createTezosModule } from "@clip-wallet/chains-tezos";
import { createAlgorandModule } from "@clip-wallet/chains-algorand";
import { createCardanoModule } from "@clip-wallet/chains-cardano";
import { createSubstrateModule } from "@clip-wallet/chains-substrate";
import { createStarknetModule } from "@clip-wallet/chains-starknet";
import { createTonModule } from "@clip-wallet/chains-ton";
import type { RouterPort } from "@clip-wallet/1mask/background";
import type { KV } from "../shared/storage";
import { vaultStorageOf } from "../shared/storage";
import { walletAssets, walletNetworks } from "../shared/catalog";
import { createMockChains } from "./mocks/mock-chains";
import { knownAssets, MOCK_NETWORKS } from "./mocks/networks";
import { MockDappConnector, MockWalletConnect } from "./mocks/mock-dapps";
import { MockRoutePlanner } from "./mocks/mock-route";
import { MOCK_ACTIVITY, MockNameResolver, MockPriceFeed } from "./mocks/fixtures";
import {
  KnownDappRegistry,
  NoNameResolver,
  OneMaskConnector,
  RoutePlannerAdapter,
  WalletConnectAdapter,
} from "./real";
import { createPriceFeed } from "./features";

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
}

/** CLPRouter: how a request gets paid for ("From: Your balance", funding moves, sponsored gas, ETA). */
export interface RoutePlanner {
  plan(p: { request: DappRequest; decoded: DecodedRequest; balances: TokenBalance[]; networks: Network[] }): Promise<ApprovalPlan>;
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
  isUnlocked(): Promise<boolean>;
  /** The connector gave up on a request (timeout / relay expiry): drop its approval. */
  cancel(requestId: string): void;
}

/** 1Mask background router (inpage/content ports). */
export interface DappConnector {
  start(host: DappHost): void;
  attachPort?(port: RouterPort, senderOrigin?: string): void;
  /** The wallet disconnected an origin: tell the site. */
  disconnected(origin: string): void;
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
  /** "alice.eth", "alice.hbar", "alice.sol" → address, or null. */
  resolve(name: string): Promise<{ address: string; displayName: string } | null>;
}

export interface DappRegistry {
  lookup(origin: string): Omit<DappInfo, "origin" | "domain">;
}

export interface Dependencies {
  /** True in fixture mode (mock chains/1Mask/route; dev simulator enabled). */
  mocks: boolean;
  vault: WalletVault;
  /** Only the families this build ships; Phase 2 families register as their modules land. */
  chains: Partial<Record<Family, ChainModule>>;
  networks: Network[];
  /** Assets each network can carry, even at zero balance (send/receive candidates). */
  assets: AssetRef[];
  route: RoutePlanner;
  dapps: DappConnector;
  walletConnect: WalletConnectBridge;
  prices: PriceFeed;
  names: NameResolver;
  registry: DappRegistry;
  /** Hedera "0.0.x" for the account's EVM alias, if it exists yet. */
  hederaAccountId(ctx: ChainContext): Promise<string | undefined>;
  /** Seed activity (fixture mode only). */
  seedActivity: ActivityEntry[];
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

  if (opts.mocks) {
    return {
      mocks: true,
      vault,
      chains: createMockChains(),
      networks: MOCK_NETWORKS,
      assets: knownAssets(MOCK_NETWORKS),
      route: new MockRoutePlanner(),
      dapps: new MockDappConnector(),
      walletConnect: new MockWalletConnect(),
      prices: new MockPriceFeed(),
      names: new MockNameResolver(),
      registry,
      hederaAccountId: async () => "0.0.4815162",
      seedActivity: MOCK_ACTIVITY,
    };
  }

  const networks = walletNetworks(opts.config);
  const hedera: HederaModule = createHederaModule();
  // OpenZeppelin v0.17.0 = the vault's default Starknet address; TON v5r1 = the vault's default wallet.
  const starknet = createStarknetModule();
  const ton = createTonModule();
  const prices = createPriceFeed(opts.kv, opts.features?.coingeckoDemoKey);
  return {
    mocks: false,
    vault,
    chains: {
      evm: createEvmModule(),
      hedera,
      solana: createSolanaModule(),
      bitcoin: createBitcoinModule(),
      sui: createSuiModule(),
      aptos: createAptosModule(),
      near: createNearModule(),
      stellar: createStellarModule(),
      tezos: createTezosModule(),
      // Must match the vault's algorandScheme (default ARC-52 BIP32-Ed25519).
      algorand: createAlgorandModule(),
      cardano: createCardanoModule(),
      substrate: createSubstrateModule(),
      starknet,
      ton,
    },
    networks,
    assets: walletAssets(networks),
    route: new RoutePlannerAdapter(opts.config, prices, opts.currency),
    dapps: new OneMaskConnector(networks, { beacon: { kv: opts.kv, name: opts.config.name, iconUrl: opts.iconUrl }, starknet, ton }),
    walletConnect: new WalletConnectAdapter(opts.config, networks, opts.iconUrl),
    prices,
    names: new NoNameResolver(),
    registry,
    hederaAccountId: async (ctx) => (await hedera.getAccountState(ctx)).accountId ?? undefined,
    seedActivity: [],
  };
}
