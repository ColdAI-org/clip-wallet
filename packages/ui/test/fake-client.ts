import { vi } from "vitest";
import type { AssetRef, DecodedRequest, TokenBalance } from "@clip-wallet/core";
import type { ApprovalView, NetworkView, Prefs, WalletClient, WalletState } from "../src/client";

export const NETWORKS: NetworkView[] = [
  { id: "eip155:84532", family: "evm", name: "Base Sepolia", chainId: 84532, testnet: true, explorerUrl: "https://sepolia.basescan.org" },
  { id: "eip155:11155111", family: "evm", name: "Ethereum Sepolia", chainId: 11155111, testnet: true, explorerUrl: "https://sepolia.etherscan.io" },
  { id: "eip155:421614", family: "evm", name: "Arbitrum Sepolia", chainId: 421614, testnet: true, explorerUrl: "https://sepolia.arbiscan.io" },
  { id: "hedera:testnet", family: "hedera", name: "Hedera Testnet", testnet: true, explorerUrl: "https://hashscan.io/testnet" },
];

export const usdc = (networkId: string, extra: Partial<AssetRef> = {}): AssetRef => ({
  key: "usdc",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  networkId,
  address: "0x0000000000000000000000000000000000000001",
  ...extra,
});

export const BALANCES: TokenBalance[] = [
  { asset: usdc("eip155:84532"), amount: "300000000", fiatValue: 300 },
  { asset: usdc("eip155:11155111"), amount: "112000000", fiatValue: 112 },
  {
    asset: usdc("eip155:421614", { key: "usdc.e", symbol: "USDC.e", name: "Bridged USDC", bridged: true }),
    amount: "40000000",
    fiatValue: 40,
  },
  { asset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: "eip155:84532" }, amount: "50000000000000000", fiatValue: 150 },
  { asset: { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "hedera:testnet" }, amount: "2500000000", fiatValue: 2.5 },
  { asset: { key: "dust", symbol: "DUST", name: "Dust token", decimals: 18, networkId: "eip155:84532", address: "0x2" }, amount: "1000", fiatValue: 0.01 },
  {
    asset: { key: "scam", symbol: "CLAIM", name: "Claim $5000 reward", decimals: 18, networkId: "eip155:84532", address: "0x3", spam: true },
    amount: "5000000000000000000000",
    fiatValue: 0,
  },
];

export const PREFS: Prefs = {
  advanced: false,
  autoLockMinutes: 15,
  displayCurrency: "USD",
  theme: "light",
  pinned: [],
  hideSmallBalances: false,
  showSpam: false,
  rpcOverrides: {},
};

export function state(over: Partial<WalletState> = {}, prefs: Partial<Prefs> = {}): WalletState {
  return { status: "unlocked", prefs: { ...PREFS, ...prefs }, passkey: { enrolled: false }, pendingApprovals: 0, mocks: true, ...over };
}

export function payDecoded(over: Partial<DecodedRequest> = {}): DecodedRequest {
  return {
    requestId: "req-1",
    title: "Pay 25 USDC",
    lines: [],
    balanceChanges: [{ asset: usdc("eip155:84532"), delta: "-25000000" }],
    fee: { asset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: "eip155:84532" }, amount: "12000000000000", fiatValue: 0.04, sponsored: true },
    simulated: true,
    blind: false,
    warnings: [],
    networkId: "eip155:84532",
    ...over,
  };
}

export function payApproval(over: Partial<ApprovalView> = {}, decoded: Partial<DecodedRequest> = {}): ApprovalView {
  return {
    id: "appr-1",
    kind: "transaction",
    createdAt: Date.now(),
    dapp: { name: "Magic Eden", origin: "https://magiceden.io", domain: "magiceden.io", verified: true },
    network: NETWORKS[0]!,
    via: "injected",
    decoded: payDecoded(decoded),
    fiatValue: 25,
    plan: {
      source: "Your balance",
      feeFiat: 0.04,
      sponsored: true,
      readyInSeconds: 10,
      steps: [
        { kind: "funding", title: "Move 13 USDC from your other balance", detail: "Your USDC is spread out; this gathers it in one place." },
        { kind: "gas", title: "Network fee paid for you", detail: "Covered by Clip ($0.04)." },
        { kind: "action", title: "Pay Magic Eden", balanceChanges: [{ asset: usdc("eip155:84532"), delta: "-25000000" }] },
      ],
      settlement: "Settles in one step. If anything fails, nothing leaves your balance.",
    },
    raw: '{"method":"eth_sendTransaction"}',
    ...over,
  };
}

export function fakeClient(over: Partial<WalletClient> = {}, st: WalletState = state()): WalletClient {
  let current = st;
  const c: WalletClient = {
    getState: vi.fn(async () => current),
    setPrefs: vi.fn(async (p) => {
      current = { ...current, prefs: { ...current.prefs, ...p } };
      return current.prefs;
    }),
    createWallet: vi.fn(async () => undefined),
    revealPhrase: vi.fn(async () => "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima"),
    importWallet: vi.fn(async () => undefined),
    unlock: vi.fn(async () => undefined),
    lock: vi.fn(async () => undefined),
    passkeyBegin: vi.fn(async () => {
      throw new Error("not in test");
    }),
    passkeyFinish: vi.fn(async () => undefined),
    passkeyRemove: vi.fn(async () => undefined),
    getPortfolio: vi.fn(async () => ({ balances: BALANCES, networks: NETWORKS, currency: "USD", updatedAt: Date.now(), stale: [] })),
    getCollectibles: vi.fn(async () => []),
    getActivity: vi.fn(async () => []),
    resolveRecipient: vi.fn(async () => ({ kind: "invalid" as const, message: "Not an address" })),
    rememberRecipientNetwork: vi.fn(async () => undefined),
    send: vi.fn(async () => "appr-1"),
    getReceiveTargets: vi.fn(async () => []),
    listApprovals: vi.fn(async () => []),
    getApproval: vi.fn(async () => null),
    approve: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    disconnect: vi.fn(async () => undefined),
    pairWalletConnect: vi.fn(async () => undefined),
    openFullTab: vi.fn(async () => undefined),
    // platform (PlatformClient): no backup service, one account per family
    backupStatus: vi.fn(async () => ({ signedIn: false, backups: [], available: false })),
    backupStartSignIn: vi.fn(async () => undefined),
    backupCompleteSignIn: vi.fn(async () => undefined),
    backupSignOut: vi.fn(async () => undefined),
    backupDelete: vi.fn(async () => undefined),
    passkeyBackupBegin: vi.fn(async () => {
      throw new Error("not in test");
    }),
    passkeyRestoreBegin: vi.fn(async () => {
      throw new Error("not in test");
    }),
    markPhraseBackedUp: vi.fn(async () => undefined),
    listAccounts: vi.fn(async () => []),
    addAccount: vi.fn(async (p) => ({ id: `${p.family}:1`, family: p.family, index: 1, label: "Account 2", address: "addr" })),
    renameAccount: vi.fn(async () => undefined),
    getActiveAccounts: vi.fn(async () => ({ defaults: {} })),
    setActiveAccount: vi.fn(async () => undefined),
    ...over,
  };
  return c;
}
