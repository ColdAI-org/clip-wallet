/**
 * The engine's seams. Everything environment-specific is injected: the vault (constructed by the host,
 * the only place allowed to import @clip-wallet/vault), storage, timers, fetch and randomness, and the
 * UI side effects (open an approval, tell screens to re-fetch).
 */
import type {
  Account,
  AssetRef,
  ChainContext,
  ChildAddress,
  ChainModule,
  DappRequest,
  DecodedRequest,
  Family,
  Network,
  Signature,
  SignablePayload,
  TokenBalance,
  Warning,
} from "@clip-wallet/core";
import type { ActivityEntry, ApprovalPlan, DappInfo, SessionView } from "@clip-wallet/ui";
import type { RouterPort } from "@clip-wallet/1mask/background";

/** Passkey PRF the vault calls (same shape as @clip-wallet/vault's PasskeyPrf; restated so the engine stays vault-free). */
export interface PrfProvider {
  enroll(prfInput: Uint8Array): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }>;
  evaluate(credentialId: Uint8Array, prfInput: Uint8Array): Promise<Uint8Array>;
}

export interface PasskeyInfoLike {
  credentialId: Uint8Array;
  createdAt: number;
}

/** The vault surface the engine uses: core's Vault plus ClipVault's extras. ClipVault satisfies it. */
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
  sign(payload: SignablePayload): Promise<Signature>;
  enrollPasskey(password: string, prf: PrfProvider): Promise<PasskeyInfoLike>;
  unlockWithPasskey(prf: PrfProvider, credentialId?: Uint8Array): Promise<void>;
  listPasskeys(): Promise<PasskeyInfoLike[]>;
  removePasskey(credentialId: Uint8Array): Promise<void>;
  /* vault-v2: several accounts per family, Bitcoin change addresses */
  listAccounts(families?: readonly Family[]): Promise<Account[]>;
  addAccount(family: Family, label?: string): Promise<Account>;
  setAccountLabel(family: Family, index: number, label: string): Promise<void>;
  freshChange(family: "bitcoin", accountIndex: number): Promise<ChildAddress>;
  listChange(family: "bitcoin", accountIndex: number): Promise<ChildAddress[]>;
  /* platform: passkey backup, encrypted and restored inside the vault */
  createPasskeyBackup(password: string, prfOutput: Uint8Array): Promise<Uint8Array>;
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

/** What 1Mask and WalletConnect call into. Implemented by WalletEngine. */
export interface DappHost {
  approveConnect(p: {
    origin: string;
    family: Family;
    networkId: string;
    via: "injected" | "walletconnect";
    name?: string;
    iconUrl?: string;
    warnings?: Warning[];
  }): Promise<boolean>;
  request(req: DappRequest, dapp?: { name?: string; iconUrl?: string; warnings?: Warning[] }): Promise<unknown>;
  accountsFor(origin: string, family: Family): Promise<Account[]>;
  preferredNetwork(family: Family): string | undefined;
  cachedAccount(family: Family): Account | undefined;
  permissions: PermissionStoreLike;
  rpc(networkId: string, method: string, params: unknown): Promise<unknown>;
  /** Read-only chain calls answered by a chain module (CIP-30 getUtxos/getBalance/…/submitTx). */
  chainRead(req: DappRequest): Promise<unknown>;
  isUnlocked(): Promise<boolean>;
  cancel(requestId: string): void;
  /** A site on a loaded phishing list (security stream). Sync: WalletConnect's Verify check calls it. */
  isKnownScam?(origin: string): boolean;
}

/** 1Mask background router (injected providers: extension content scripts, mobile WebView bridge). */
export interface DappConnector {
  start(host: DappHost): void;
  /** `senderOrigin` must come from the browser / WebView, never from the page. */
  attachPort?(port: RouterPort, senderOrigin?: string): void;
  disconnected(origin: string): void;
  accountsChanged?(): void;
}

export interface WalletConnectBridge {
  start(host: DappHost): void;
  /** False when this build has no project id: the UI says so plainly instead of offering a broken button. */
  readonly enabled: boolean;
  pair(uri: string): Promise<void>;
  sessions(): Promise<SessionView[]>;
  disconnect(id: string): Promise<void>;
}

export interface PriceFeed {
  usd(assetKey: string): number | undefined;
  fx(currency: string): number;
}

export interface NameResolver {
  /** `networkIds`: networks the name points at specifically; `addressOn`: ENS per-network addresses. */
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
  /** True when wired to fixtures (dev builds); enables nothing on its own beyond `WalletState.mocks`. */
  mocks: boolean;
  vault: WalletVault;
  /** SHA-256 binding of a payload to its approval (the vault's hashSignablePayload), injected by the host. */
  hashPayload(payload: SignablePayload): Uint8Array;
  chains: Partial<Record<Family, ChainModule>>;
  networks: Network[];
  assets: AssetRef[];
  route: RoutePlanner;
  dapps: DappConnector;
  walletConnect: WalletConnectBridge;
  prices: PriceFeed;
  names: NameResolver;
  registry: DappRegistry;
  hederaAccountId(ctx: ChainContext): Promise<string | undefined>;
  seedActivity?: ActivityEntry[];
  /** services/backup client factory (clip.config services.backupUrl); null = passkey backup hidden. */
  backup?: import("./platform.js").PlatformDeps["backup"];
  /**
   * Networks the wallet signs and decodes requests on but never lists or scans: Hedera's EVM (eip155:296/295) for
   * the settle-on-Hedera client's claim / withdraw, only when route.settleOnHedera is on.
   */
  requestNetworks?: Network[];
}

/** Side effects the engine needs from its host. */
export interface EngineEnv {
  walletName: string;
  /** A request is waiting: show the approval (extension popup window, mobile sheet). */
  openApproval(id: string): Promise<void> | void;
  /** Extension: open a full tab. Mobile: navigate. Optional. */
  openRoute?(route: string): Promise<void> | void;
  /** Tell screens to re-fetch. */
  broadcast(): void;
  /** (Re)arm the auto-lock timer. */
  armAutoLock(minutes: number): void;
  /** Passkey ceremony metadata for hosts whose WebAuthn runs in another context (extension pages). */
  passkey?(): { rpId: string | null; rpName: string; mode: "extension" | "web-bridge" | "native"; bridgeUrl: string };
  fetch: typeof fetch;
  randomUUID(): string;
  /** Defaults to Date.now. */
  now?(): number;
  /**
   * Google / Apple sign-in for backups: a browser auth session that resolves with the URL it ended on
   * (extension: chrome.identity.launchWebAuthFlow; mobile: expo-web-browser openAuthSessionAsync) and the
   * return URL listed in the backup service's OIDC_RETURN_URLS. Absent = the buttons stay hidden.
   */
  identity?: { launchWebAuthFlow(url: string): Promise<string | undefined>; returnUrl: string };
}
