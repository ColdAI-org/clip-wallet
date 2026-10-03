import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CleanupOverviewView, GrantView, SecurityClient, ThreatProviderStatusView } from "../src/security/client";
import { SecurityProvider } from "../src/security/context";
import { securityRoute } from "../src/security/routes";
import { Cleanup, Permissions, Protection, SecurityHome } from "../src/security/Security";
import { renderUi } from "./render";
import { ConnectApproval } from "../src/screens/Approval";
import { payApproval } from "./fake-client";

const NOW = Date.now();
const GRANTS: GrantView[] = [
  {
    id: "g1",
    kind: "token-allowance",
    family: "evm",
    title: "An unknown app can spend all your USDC",
    asset: { symbol: "USDC", name: "USD Coin", address: "0xa" },
    spender: { address: "0x5555555555555555555555555555555555555555", known: false },
    amount: "All your USDC",
    unlimited: true,
    grantedAt: NOW - 3 * 86_400_000,
    risks: [
      { code: "unlimited", label: "Can take all of it", level: "danger" },
      { code: "unknown-spender", label: "Unknown app", level: "caution" },
    ],
    riskLevel: "high",
    networkId: "eip155:11155111",
  },
  {
    id: "g2",
    kind: "nft-all",
    family: "evm",
    title: "OpenSea can move every NFT you hold in Pudgy Pals",
    asset: { symbol: "Pudgy Pals", name: "Pudgy Pals" },
    spender: { address: "0x1E0049783F008A0085193E00003D00cd54003c71", name: "OpenSea", known: true },
    amount: "Every NFT in Pudgy Pals",
    unlimited: true,
    risks: [{ code: "unlimited", label: "Can take all of it", level: "danger" }],
    riskLevel: "medium",
    networkId: "eip155:11155111",
  },
  {
    id: "g3",
    kind: "hts-allowance",
    family: "hedera",
    title: "SaucerSwap can spend up to 5 SAUCE",
    asset: { symbol: "SAUCE", name: "SAUCE" },
    spender: { address: "0.0.1414040", name: "SaucerSwap", known: true },
    amount: "Up to 5 SAUCE",
    unlimited: false,
    risks: [],
    riskLevel: "low",
    networkId: "hedera:testnet",
  },
];

const CLEANUP: CleanupOverviewView = {
  items: [
    { id: "c1", family: "solana", kind: "token", symbol: "Empt…1111", name: "Unknown token", balance: "0", action: "close", reason: "Empty account. Closing it gives you back its ≈0.002 SOL deposit.", spam: false, preselected: true, reclaim: { amount: "2039280", display: "≈0.002 SOL" }, networkId: "solana:x" },
    { id: "c2", family: "solana", kind: "token", symbol: "CLAIM-USDC.COM", name: "Visit", balance: "1,000,000 CLAIM-USDC.COM", action: "burn-close", reason: "Spam. Destroying it and closing its account gives you back ≈0.002 SOL.", spam: true, preselected: true, reclaim: { amount: "2039280", display: "≈0.002 SOL" }, networkId: "solana:x" },
    { id: "c3", family: "hedera", kind: "token", symbol: "SAUCE", name: "SAUCE", balance: "0", action: "dissociate", reason: "You don't hold any.", spam: false, preselected: false, networkId: "hedera:testnet" },
  ],
  notes: ["On Ethereum and similar networks, spam tokens can only be hidden."],
  partial: [],
};

const SOURCES: ThreatProviderStatusView[] = [
  { id: "metamask", name: "MetaMask phishing list", privacy: "Downloads the public list to your device and checks it there. Nothing about you is sent.", sendsUserData: false, enabled: true, updatedAt: NOW - 3_600_000, entries: 102218 },
  { id: "blockaid", name: "Blockaid scanning", privacy: "Sends the site, the transaction and your address to Blockaid for every request you review.", sendsUserData: true, enabled: false, unavailable: { code: "threat/blockaid-off", message: "Off. Add a Blockaid API key to the wallet's configuration to scan every transaction before you sign." } },
];

function security(over: Partial<SecurityClient> = {}): SecurityClient {
  return {
    approvalsScan: vi.fn(async () => ({ grants: GRANTS, notes: ["Aptos tokens can't be spent by an app unless you sign each time, so there's nothing to remove there."], partial: [], scannedAt: NOW })),
    revoke: vi.fn(async () => ({ queued: { approvalId: "appr-1", steps: ["Stop …"] }, hidden: 0 })),
    cleanupScan: vi.fn(async () => CLEANUP),
    cleanupPreview: vi.fn(async ({ ids }: { ids: string[] }) => ({
      headline: ids.length >= 2 ? "Get back ~0.0041 SOL" : "Get back ~0.002 SOL",
      lines: ids.map((i) => `line ${i}`),
      approvals: ids.length >= 2 ? 2 : 1,
      reclaimLamports: "4078560",
    })),
    cleanupRun: vi.fn(async () => ({ queued: { approvalId: "appr-2", steps: ["Close"] }, hidden: 0 })),
    unhide: vi.fn(async () => ({ ok: true as const })),
    threatStatus: vi.fn(async () => SOURCES),
    threatRefresh: vi.fn(async () => SOURCES),
    checkSite: vi.fn(async ({ origin }: { origin: string }) => ({ origin, warnings: [], safe: true })),
    ...over,
  };
}

function renderSecurity(ui: ReactElement, s = security()) {
  return { ...renderUi(<SecurityProvider client={s}>{ui}</SecurityProvider>), s };
}

describe("security screens", () => {
  it("menu links to the three screens", async () => {
    renderSecurity(<SecurityHome />);
    for (const n of ["App permissions", "Clean up spam", "Scam protection"]) expect(screen.getByRole("button", { name: n })).toBeInTheDocument();
  });

  it("permissions: risky ones are preselected, one tap revokes them, opens the first approval", async () => {
    const user = userEvent.setup();
    const { s, container } = renderSecurity(<Permissions />);
    expect(await screen.findByText("An unknown app can spend all your USDC")).toBeInTheDocument();
    expect(screen.getAllByTestId("grant")).toHaveLength(3);
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getByText("Unknown app")).toBeInTheDocument();
    expect(screen.getByText(/nothing to remove there/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Remove: An unknown app can spend all your USDC" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Remove: SaucerSwap can spend up to 5 SAUCE" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Remove: SaucerSwap can spend up to 5 SAUCE" }));
    await user.click(screen.getByRole("button", { name: "Remove 3 permissions" }));
    expect(s.revoke).toHaveBeenCalledWith({ ids: ["g1", "g2", "g3"] });
    // Networks are invisible by default.
    expect(container.textContent).not.toContain("eip155");
    expect(container.textContent).not.toContain("Sepolia");
  });

  it("permissions: empty state", async () => {
    renderSecurity(<Permissions />, security({ approvalsScan: vi.fn(async () => ({ grants: [], notes: [], partial: [{ code: "x", message: "Couldn't check Base right now." }], scannedAt: NOW })) }));
    expect(await screen.findByText("No apps can spend your tokens")).toBeInTheDocument();
    expect(screen.getByText("Couldn't check Base right now.")).toBeInTheDocument();
  });

  it("cleanup: bulk selection with a live summary, 'Get back ~… SOL', then queues", async () => {
    const user = userEvent.setup();
    const { s } = renderSecurity(<Cleanup />);
    expect(await screen.findByText("CLAIM-USDC.COM")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("cleanup-summary")).toHaveTextContent("Get back ~0.0041 SOL"));
    expect(screen.getByText("You'll confirm 2 transactions.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Remove SAUCE" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Select none" }));
    expect(screen.getByRole("button", { name: "Pick items to clean up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    await waitFor(() => expect(s.cleanupPreview).toHaveBeenLastCalledWith({ ids: ["c1", "c2", "c3"] }));
    await user.click(screen.getByRole("button", { name: "Get back ~0.0041 SOL" }));
    expect(s.cleanupRun).toHaveBeenCalledWith({ ids: ["c1", "c2", "c3"] });
    expect(screen.getByText("On Ethereum and similar networks, spam tokens can only be hidden.")).toBeInTheDocument();
  });

  it("cleanup: hide-only run says what it did", async () => {
    const user = userEvent.setup();
    renderSecurity(<Cleanup />, security({ cleanupRun: vi.fn(async () => ({ hidden: 2 })) }));
    await screen.findByText("CLAIM-USDC.COM");
    await waitFor(() => expect(screen.getByRole("button", { name: "Get back ~0.0041 SOL" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Get back ~0.0041 SOL" }));
    expect(await screen.findByText("Hid 2 items.")).toBeInTheDocument();
  });

  it("scam protection: each source and what it sees; Blockaid off with a plain note", async () => {
    const user = userEvent.setup();
    const { s } = renderSecurity(<Protection />);
    expect(await screen.findByText("MetaMask phishing list")).toBeInTheDocument();
    expect(screen.getByText(/102,218 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Add a Blockaid API key/)).toBeInTheDocument();
    expect(screen.getByText("Sends the site, the transaction and your address to Blockaid for every request you review.")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update lists now" }));
    expect(s.threatRefresh).toHaveBeenCalled();
  });

  it("routes", () => {
    expect(securityRoute(["settings", "security"])?.type).toBe(SecurityHome);
    expect(securityRoute(["settings", "security", "permissions"])?.type).toBe(Permissions);
    expect(securityRoute(["settings", "security", "cleanup"])?.type).toBe(Cleanup);
    expect(securityRoute(["settings", "security", "protection"])?.type).toBe(Protection);
    expect(securityRoute(["settings"])).toBeNull();
    expect(securityRoute(["swap"])).toBeNull();
  });
});

describe("connect approval with scam findings", () => {
  it("shows phishing warnings and makes connecting a deliberate choice", () => {
    renderUi(
      <ConnectApproval
        approval={payApproval({
          kind: "connect",
          decoded: undefined,
          connect: {
            accountLabel: "wallet address",
            address: "0xabc",
            permissions: ["See your address"],
            warnings: [{ level: "danger", code: "phishing-site", message: "This site is on MetaMask's list of phishing sites. Don't connect or sign anything." }],
          },
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("MetaMask's list of phishing sites");
    expect(screen.getByRole("button", { name: "Connect anyway" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  });
});
