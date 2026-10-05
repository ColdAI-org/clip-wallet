/**
 * The UI's only door to the wallet. In the extension this is implemented over the zod-validated
 * message bus to the background service worker; in tests it is a plain fake.
 *
 * Nothing here carries key material, with one deliberate exception: `revealPhrase`, used only by the
 * onboarding phrase screen (and a future backup screen).
 */
import type { PlatformClient } from "./platform/client";
import type {
  AssetRef,
  DecodedRequest,
  Family,
  NetworkId,
  Nft,
  TokenBalance,
  Msg,
  Warning,
} from "@clip-wallet/core";
import { currentBgText } from "./i18n/bg";
import type { PasskeyCeremony } from "./lib/passkey";
import type { LocalePref } from "@clip-wallet/i18n";

export type VaultStatus = "empty" | "locked" | "unlocked";
export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  /** Reveals network names, chain ids, RPC overrides and raw transactions. */
  advanced: boolean;
  autoLockMinutes: number;
  displayCurrency: string;
  theme: ThemePref;
  /** AssetRef.key values pinned to the top of Home. */
  pinned: string[];
  hideSmallBalances: boolean;
  showSpam: boolean;
  /** Advanced mode: per-network RPC override. */
  rpcOverrides: Record<NetworkId, string>;
  /** Display language: "system" (absent) follows the device; otherwise a shipped locale code ("de", "pt-BR"). */
  locale?: LocalePref;
}

export interface WalletState {
  status: VaultStatus;
  prefs: Prefs;
  passkey: { enrolled: boolean; credentialId?: string };
  pendingApprovals: number;
  /** True in builds wired to in-repo mocks (dev flag). */
  mocks: boolean;
}

/** Network facts the UI is allowed to show: only on asset detail split, network-matters prompts and Advanced mode. */
export interface NetworkView {
  id: NetworkId;
  family: Family;
  name: string;
  chainId?: number;
  testnet: boolean;
  explorerUrl: string;
  rpcUrl?: string;
}

export interface PortfolioView {
  balances: TokenBalance[];
  /** Assets the wallet can hold on its networks, even at zero balance (Receive list). */
  assets?: AssetRef[];
  networks: NetworkView[];
  currency: string;
  updatedAt: number;
  /** Networks whose indexer failed this round; their last cached balances are used. */
  stale: NetworkId[];
}

export interface ActivityLeg {
  /** "Moved 25 USDC to pay", "Network fee (sponsored)". */
  title: string;
  /** Additive: `title` as a translatable Msg. */
  titleMsg?: Msg;
  networkId: NetworkId;
  status: "done" | "pending" | "failed";
  txHash?: string;
}

/** One entry per user action. Funding legs are folded inside. */
export interface ActivityEntry {
  id: string;
  /** "Paid Magic Eden 25 USDC", "Received 0.1 ETH", "Sent 40 HBAR to alice". */
  title: string;
  /** Additive: `title` as a translatable Msg. */
  titleMsg?: Msg;
  kind: "pay" | "send" | "receive" | "swap" | "connect" | "sign" | "mint";
  app?: { name: string; origin: string };
  /** Signed fiat amount in display currency (negative = money out). */
  fiatValue?: number;
  timestamp: number;
  status: "done" | "pending" | "failed";
  legs: ActivityLeg[];
}

export interface DappInfo {
  name: string;
  origin: string;
  /** Hostname shown under the name. */
  domain: string;
  /** Domain verified against the wallet's registry (mock until 1Mask lands). */
  verified: boolean;
  iconUrl?: string;
}

export interface PlanStep {
  kind: "funding" | "gas" | "action";
  /** "Move 25 USDC to the right place", "Network fee paid for you", "Pay Magic Eden". */
  title: string;
  /** Additive: `title` as a translatable Msg. */
  titleMsg?: Msg;
  detail?: string;
  balanceChanges?: DecodedRequest["balanceChanges"];
}

export interface ApprovalPlan {
  /** Plain-words source, e.g. "Your balance". */
  source: string;
  feeFiat?: number;
  sponsored: boolean;
  readyInSeconds: number;
  steps: PlanStep[];
  /** "Settles in one step. If anything fails, nothing leaves your balance." */
  settlement: string;
  /** Plain-words reason this can't be approved as planned (e.g. not enough money anywhere). Blocks Approve. */
  problem?: string;
}

export interface ConnectView {
  /** What the dapp will see, in plain words. */
  accountLabel: string;
  address: string;
  permissions: string[];
  /** Phase 2.5 (additive): scam-list and WalletConnect Verify findings for the site ("phishing-site", "domain-mismatch"…). */
  warnings?: Warning[];
}

export interface ApprovalView {
  id: string;
  kind: "connect" | "transaction";
  createdAt: number;
  dapp: DappInfo;
  network: NetworkView;
  via: "injected" | "walletconnect" | "wallet";
  decoded?: DecodedRequest;
  /** Fiat value of what leaves the user's balance, in display currency. */
  fiatValue?: number;
  plan?: ApprovalPlan;
  connect?: ConnectView;
  /** Raw request params, Advanced mode only. */
  raw?: string;
  /** Wallet-built sends (Send screen): who receives, so the approval can say "Send to Alex" (social stream). */
  recipient?: { address: string; family: Family };
  /** Set while a hardware wallet is signing this request (see packages/ui/src/hardware). */
  hardware?: import("./hardware/types").HardwareApprovalState;
}

export type RecipientResolution =
  | { kind: "invalid"; message: string }
  /** Only one network fits; the UI never mentions it. */
  | { kind: "resolved"; address: string; displayName?: string; networkId: NetworkId }
  /** Several networks fit and nothing tells them apart: ask once, in plain words. */
  | {
      kind: "ask";
      address: string;
      displayName?: string;
      candidates: { network: NetworkView; balance: string }[];
    };

export interface SendRequest {
  assetKey: string;
  networkId: NetworkId;
  to: string;
  /** Human units ("25.5"). */
  amount: string;
}

/** One receiving address for an asset. `networks` has every network that address can receive it on. */
export interface ReceiveTarget {
  asset: AssetRef;
  address: string;
  /** Hedera: "0.0.x" account id, preferred over the EVM alias when known. */
  displayAddress?: string;
  networks: NetworkView[];
}

export interface SessionView {
  id: string;
  dapp: DappInfo;
  via: "injected" | "walletconnect";
  connectedAt: number;
  /** Advanced only: networks granted. */
  networkIds: NetworkId[];
}

export interface WalletClient extends PlatformClient {
  getState(): Promise<WalletState>;
  setPrefs(patch: Partial<Prefs>): Promise<Prefs>;

  /* onboarding & lock */
  createWallet(password: string): Promise<void>;
  /** Onboarding/backup only. */
  revealPhrase(password: string): Promise<string>;
  importWallet(phrase: string, password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;

  /* passkeys: the vault (in the background) drives; the WebAuthn ceremony runs in a page.
     See lib/passkey.ts runPasskeyCeremony. Only PRF output crosses the bus, never key material. */
  passkeyBegin(p: { op: "enroll"; password: string } | { op: "unlock" }): Promise<PasskeyCeremony>;
  passkeyFinish(p: { id: string; credentialId: string; prfOutput: string } | { id: string; error: string }): Promise<void>;
  passkeyRemove(): Promise<void>;

  /* money and things */
  getPortfolio(opts?: { refresh?: boolean }): Promise<PortfolioView>;
  getCollectibles(): Promise<Nft[]>;
  getActivity(): Promise<ActivityEntry[]>;

  /* send / receive */
  resolveRecipient(p: { input: string; assetKey: string }): Promise<RecipientResolution>;
  rememberRecipientNetwork(p: { address: string; assetKey: string; networkId: NetworkId }): Promise<void>;
  /** Builds the transfer and queues it as an approval. Returns the approval id. */
  send(p: SendRequest): Promise<string>;
  getReceiveTargets(p: { assetKey: string }): Promise<ReceiveTarget[]>;

  /* approvals */
  listApprovals(): Promise<ApprovalView[]>;
  getApproval(id: string): Promise<ApprovalView | null>;
  approve(id: string, opts?: { allowBlind?: boolean }): Promise<void>;
  reject(id: string): Promise<void>;

  /* sessions, permissions, WalletConnect */
  listSessions(): Promise<SessionView[]>;
  disconnect(id: string): Promise<void>;
  pairWalletConnect(uri: string): Promise<void>;

  /** Background-pushed "something changed" (new request, lock, prefs). Returns an unsubscribe function. */
  onChange?(cb: () => void): () => void;

  /* shell */
  openFullTab(route?: string): Promise<void>;
  /** Dev-flag builds only: inject a fixture dapp request. */
  devSimulateRequest?(kind: "pay" | "connect" | "blind" | "approval-for-all"): Promise<string>;
}

/** Thrown by client implementations; screens show `userMessage` only. */
export interface UserFacingError {
  userMessage: string;
  code: string;
  /** Additive: the translatable version (ClipError.msg), when the background sent one. */
  msg?: Msg;
}

export function userMessageOf(err: unknown): string {
  const bg = currentBgText();
  if (err && typeof err === "object" && "userMessage" in err && typeof (err as UserFacingError).userMessage === "string") {
    return bg.error(err) ?? (err as UserFacingError).userMessage;
  }
  return bg.error({ userMessage: GENERIC_ERROR, code: "internal" }) ?? GENERIC_ERROR;
}

const GENERIC_ERROR = "Something went wrong. Please try again.";
