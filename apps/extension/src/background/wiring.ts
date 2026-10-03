/**
 * THE seam. Everything the background service needs from packages that other agents are building is
 * created here, and nowhere else. At merge time, swap each mock for the real package in this file only.
 *
 *   dependency          now (feat/app)                         at merge
 *   ------------------  -------------------------------------  ---------------------------------------------
 *   vault               @clip-wallet/vault ClipVault (REAL)    — already real
 *   chain modules       mocks/mock-chains.ts                   @clip-wallet/chains-{evm,hedera,solana,bitcoin}
 *   networks            mocks/networks.ts (testnets)           each chain package's exported testnet list
 *   1Mask (injected)    mocks/mock-dapps.ts MockDappConnector  @clip-wallet/1mask background router
 *   WalletConnect       mocks/mock-dapps.ts MockWalletConnect  @clip-wallet/1mask WalletConnect
 *   route (funding)     mocks/mock-route.ts MockRoutePlanner   @clip-wallet/route CLPRouter quotes
 *   prices / names /    mocks/fixtures.ts                      price + name services (TBD)
 *   dapp registry
 *
 * The interfaces below are the background's view of those packages. They are local on purpose
 * (packages/core stays the shared contract); real packages are adapted to them here.
 */
import type { Account, AssetRef, ChainModule, DappRequest, DecodedRequest, Family, Network, TokenBalance } from "@clip-wallet/core";
import type { ApprovalPlan, DappInfo, SessionView } from "@clip-wallet/ui";
import { ClipVault, type PasskeyPrf, type PasskeyInfo } from "@clip-wallet/vault";
import type { KV } from "../shared/storage";
import { vaultStorageOf } from "../shared/storage";
import { createMockChains } from "./mocks/mock-chains";
import { knownAssets, MOCK_NETWORKS } from "./mocks/networks";
import { MockDappConnector, MockWalletConnect } from "./mocks/mock-dapps";
import { MockRoutePlanner } from "./mocks/mock-route";
import { MOCK_ACTIVITY, MockDappRegistry, MockNameResolver, MockPriceFeed } from "./mocks/fixtures";
import type { ActivityEntry } from "@clip-wallet/ui";

/** The vault surface the background uses: core's Vault plus ClipVault's extras. */
export interface WalletVault {
  status(): Promise<"empty" | "locked" | "unlocked">;
  create(password: string): Promise<void>;
  importPhrase(phrase: string, password: string): Promise<void>;
  revealPhrase(password: string): Promise<string>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  deriveAccount(family: Family, index: number): Promise<Account>;
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

/** What 1Mask and WalletConnect call into. Implemented by the background service. */
export interface DappHost {
  /** A dapp wants accounts. Resolves with the accounts the user approved (wallet picks the right one). */
  connect(p: { origin: string; family: Family; networkId: string; via: "injected" | "walletconnect"; name?: string; iconUrl?: string }): Promise<Account[]>;
  /** Any signing/sending request. Resolves with the chain module's finalize() result, or rejects with ClipError. */
  request(req: DappRequest, dapp?: { name?: string; iconUrl?: string }): Promise<unknown>;
  /** Accounts already granted to an origin (no prompt). */
  connectedAccounts(origin: string, family: Family): Promise<Account[]>;
}

/** 1Mask background router (inpage/content ports). */
export interface DappConnector {
  start(host: DappHost): void;
  /** Tell connected dapps an origin was disconnected from the wallet side. */
  disconnected(origin: string): void;
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
  mocks: boolean;
  vault: WalletVault;
  chains: Record<Family, ChainModule>;
  networks: Network[];
  /** Assets each network can carry, even at zero balance (send/receive candidates). */
  assets: AssetRef[];
  route: RoutePlanner;
  dapps: DappConnector;
  walletConnect: WalletConnectBridge;
  prices: PriceFeed;
  names: NameResolver;
  registry: DappRegistry;
  /** Seed activity for mock builds (real builds start empty and fill from approvals + indexers). */
  seedActivity: ActivityEntry[];
}

export interface WiringOptions {
  kv: KV;
  mocks: boolean;
  /** Tests pass cheap Argon2 params; production uses the vault's defaults. */
  vaultOptions?: Partial<ConstructorParameters<typeof ClipVault>[0]>;
}

/** Vault backstop: the background's alarm enforces the user's shorter auto-lock setting. */
const VAULT_MAX_IDLE_MS = 60 * 60 * 1000;

export function createDependencies(opts: WiringOptions): Dependencies {
  const vault = new ClipVault({ storage: vaultStorageOf(opts.kv), autoLockMs: VAULT_MAX_IDLE_MS, ...opts.vaultOptions });

  if (!opts.mocks) {
    // Real chain/1Mask/route packages are not on this branch yet. Until they merge, a non-mock build
    // still uses the mocks so the extension runs; this branch is where they get swapped in.
    console.warn("[clip] CLIP_MOCKS=0 requested but real chain/1Mask/route packages are not wired yet");
  }

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
    registry: new MockDappRegistry(),
    seedActivity: MOCK_ACTIVITY,
  };
}
