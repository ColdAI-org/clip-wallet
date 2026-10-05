/** Sample answers for the security service in screen tests (the real one scans RPCs, mirror nodes and lists). */
import type { ApprovalsOverviewView, CleanupOverviewView, CleanupSummaryView, ThreatProviderStatusView } from "@clip-wallet/ui";
import { QUEUE } from "./feature-fixtures";

const DAY = 86_400_000;

export const PERMISSIONS: ApprovalsOverviewView = {
  grants: [
    {
      id: "evm:base-sepolia:usdc:0xdead",
      kind: "token-allowance",
      family: "evm",
      title: "An unknown app can spend all your USDC",
      asset: { symbol: "USDC", name: "USD Coin", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
      spender: { address: "0xdEAD000000000000000000000000000000000000", known: false },
      amount: "All your USDC",
      unlimited: true,
      grantedAt: Date.now() - 400 * DAY,
      risks: [
        { code: "unlimited", label: "Can take all of it", level: "danger" },
        { code: "unknown-spender", label: "Unknown app", level: "caution" },
      ],
      riskLevel: "high",
      networkId: "evm:84532",
    },
    {
      id: "evm:base-sepolia:usdc:uniswap",
      kind: "token-allowance",
      family: "evm",
      title: "Uniswap can spend up to 100 USDC",
      asset: { symbol: "USDC", name: "USD Coin" },
      spender: { address: "0x2626664c2603336E57B271c5C0b26F421741e481", name: "Uniswap", known: true },
      amount: "Up to 100 USDC",
      limit: "100",
      unlimited: false,
      risks: [],
      riskLevel: "low",
      networkId: "evm:84532",
    },
  ],
  notes: ["Aptos tokens can't be spent by an app unless you sign each time."],
  noteCodes: ["no-permissions:aptos"],
  partial: [{ code: "approvals/recent-only", message: "Only recent permissions", network: "Sepolia" }],
  scannedAt: Date.now(),
};

export const CLEANUP: CleanupOverviewView = {
  items: [
    { id: "sol:empty", family: "solana", kind: "token", symbol: "BONK", name: "Bonk", balance: "0", action: "close", reason: "Empty", reasonCode: "empty-account", spam: false, preselected: true, reclaim: { amount: "2039280", display: "≈0.00204 SOL" }, networkId: "solana:devnet" },
    { id: "sol:spam", family: "solana", kind: "token", symbol: "FREE", name: "Free airdrop", balance: "1,000 FREE", action: "burn-close", reason: "Spam", reasonCode: "spam-burn", spam: true, preselected: true, reclaim: { amount: "2039280", display: "≈0.00204 SOL" }, networkId: "solana:devnet" },
    { id: "evm:spam", family: "evm", kind: "token", symbol: "SCAM", name: "Scam", balance: "1 SCAM", action: "hide", reason: "Spam", reasonCode: "spam-hide", spam: true, preselected: false, networkId: "evm:84532" },
  ],
  notes: ["On Ethereum spam can only be hidden."],
  noteCodes: ["hide-only:evm"],
  partial: [],
};

export function cleanupSummary(ids: string[]): CleanupSummaryView {
  const counts = { close: 0, "burn-close": 0, dissociate: 0, hide: 0 };
  let lamports = 0n;
  for (const id of ids) {
    const i = CLEANUP.items.find((x) => x.id === id)!;
    counts[i.action]++;
    if (i.reclaim) lamports += BigInt(i.reclaim.amount);
  }
  return { headline: "", lines: [], approvals: counts.close + counts["burn-close"] ? 1 : 0, counts, reclaimLamports: lamports.toString() };
}

export const THREAT: ThreatProviderStatusView[] = [
  { id: "metamask", name: "MetaMask phishing list", privacy: "Downloads the list.", sendsUserData: false, enabled: true, updatedAt: Date.now() - 3_600_000, entries: 102345 },
  { id: "local", name: "Look-alike checks", privacy: "On device.", sendsUserData: false, enabled: true },
  { id: "blockaid", name: "Blockaid", privacy: "Sends the site, the transaction and your address to Blockaid.", sendsUserData: true, enabled: false, unavailable: { code: "threat/blockaid-off", message: "Off" } },
];

export const SECURITY_ANSWERS: Record<string, (m: Record<string, unknown>) => unknown> = {
  secApprovalsScan: () => PERMISSIONS,
  secRevoke: () => QUEUE,
  secCleanupScan: () => CLEANUP,
  secCleanupPreview: (m) => cleanupSummary(m.ids as string[]),
  secCleanupRun: (m) => ((m.ids as string[]).some((id) => !id.startsWith("evm")) ? QUEUE : { hidden: (m.ids as string[]).length }),
  secThreatStatus: () => THREAT,
  secThreatRefresh: () => THREAT,
};
