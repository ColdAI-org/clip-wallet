import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../src/features/context";
import type { FeaturesClient, StakeAssetView, SwapQuoteView, TradeOfferView, TradeReviewView } from "../src/features/client";
import { featureRoute } from "../src/features/routes";
import { StakeAsset, StakeHome } from "../src/features/Stake";
import { Swap } from "../src/features/Swap";
import { Buy } from "../src/features/Buy";
import { TradeCreate, TradeDetail, TradeReview } from "../src/features/Trade";
import { Explore } from "../src/features/Explore";
import { BALANCES, NETWORKS, fakeClient } from "./fake-client";
import { renderUi } from "./render";
import { WalletApp } from "../src/App";

const QUEUED = { approvalId: "appr-9", steps: ["Swap"] };

const STAKING: StakeAssetView[] = [
  {
    assetKey: "sol",
    symbol: "SOL",
    name: "Solana",
    wholeBalance: false,
    howItWorks: "You put an amount of SOL in a stake account that only you control.",
    rewardRate: "About 6.8% a year",
    networkId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    positions: [
      { id: "Acct1", assetKey: "sol", symbol: "SOL", decimals: 9, amount: "2000000000", amountDisplay: "2 SOL", with: "Validator APsE…zhhr", status: "active", statusText: "Earning rewards", actions: ["unstake"], networkId: "solana:x" },
      { id: "Acct2", assetKey: "sol", symbol: "SOL", decimals: 9, amount: "1000000000", amountDisplay: "1 SOL", with: "Validator APsE…zhhr", status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"], networkId: "solana:x" },
    ],
  },
  { assetKey: "dot", symbol: "DOT", name: "Polkadot", wholeBalance: false, howItWorks: "", positions: [], unavailable: { code: "staking/coming-soon", message: "Staking DOT is coming soon." } },
];

const QUOTE: SwapQuoteView = {
  id: "q1",
  provider: "SaucerSwap",
  sell: { assetKey: "usdc", symbol: "USDC", amount: "100000000", display: "100 USDC" },
  buy: { assetKey: "eth", symbol: "ETH", amount: "30000000000000000", display: "0.03 ETH" },
  youGet: "You get ~0.03 ETH",
  atLeast: "At least 0.0298 ETH, or nothing happens",
  slippageBps: 50,
  priceImpactPct: 0.12,
  route: "Via Uniswap V3",
  steps: ["Allow 0x to use exactly 100 USDC", "Swap"],
  warnings: [{ level: "caution", code: "high-fee", message: "This swap moves the price by 1.5%." }],
  executable: true,
  expiresAt: Date.now() + 30_000,
  networkId: "eip155:84532",
};

const OFFER: TradeOfferView = {
  id: "t1",
  role: "maker",
  mode: "scheduled",
  title: "Trade 10 HBAR for 5 SAUCE with 0.0.2002",
  give: { kind: "asset", assetKey: "hbar", symbol: "HBAR", amount: "1000000000", display: "10 HBAR" },
  get: { kind: "asset", assetKey: "hts:0.0.1", symbol: "SAUCE", amount: "5000000", display: "5 SAUCE", tokenId: "0.0.1" },
  counterparty: "0.0.2002",
  status: "waiting",
  statusText: "Waiting for 0.0.2002 to accept",
  link: "https://clipwallet.example/trade#offer=abc",
  expiresAt: Date.now() + 3_600_000,
  createdAt: Date.now(),
  notes: ["0.0.2002 must add SAUCE to their account before they can accept."],
};

function features(over: Partial<FeaturesClient> = {}): FeaturesClient {
  return {
    stakingOverview: vi.fn(async () => STAKING),
    stakingOptions: vi.fn(async () => [
      { id: "v1", title: "Validator FwR3…T59f", detail: "Earns about 6.4% a year · keeps 5% of rewards" },
      { id: "v2", title: "Validator APsE…zhhr", detail: "Earns about 6.8% a year · keeps 0% of rewards", recommended: true },
    ]),
    stake: vi.fn(async () => QUEUED),
    stakeAction: vi.fn(async () => QUEUED),
    swapStatus: vi.fn(async () => []),
    swapQuote: vi.fn(async () => QUOTE),
    swapExecute: vi.fn(async () => QUEUED),
    buyAssets: vi.fn(async () => [{ assetKey: "sol", symbol: "SOL", name: "Solana" }]),
    buyOptions: vi.fn(async () => ({
      assetKey: "sol",
      symbol: "SOL",
      explainer: "Your SOL arrives in this wallet. Clip Wallet picked the cheapest way to receive it.",
      options: [
        { provider: "banxa", name: "Banxa", url: "https://clipwallet.banxa-sandbox.com/?coinType=SOL", methods: "Card" },
        { provider: "moonpay", name: "MoonPay", unavailable: { code: "onramp/not-configured", message: "Buying with MoonPay isn't switched on in this build." } },
      ],
    })),
    tradeList: vi.fn(async () => [OFFER]),
    tradeCreate: vi.fn(async () => ({ offerId: "t2", queued: QUEUED })),
    tradeReview: vi.fn(async (): Promise<TradeReviewView> => ({
      offer: { ...OFFER, role: "taker", title: "Trade 5 SAUCE for 10 HBAR with 0.0.2002" },
      title: "Approve scheduled: trade",
      lines: [{ label: "Schedule", value: "0.0.7777" }],
      balanceChanges: [],
      warnings: [],
      steps: ["Add SAUCE to your account", "Accept the trade"],
    })),
    tradeAccept: vi.fn(async () => QUEUED),
    featured: vi.fn(async () => [{ name: "SaucerSwap", url: "https://www.saucerswap.finance/", domain: "saucerswap.finance", category: "swap" as const, description: "Swap tokens and earn from liquidity.", family: "hedera" as const }]),
    lpPositions: vi.fn(async () => [{ id: "lp1", app: "SaucerSwap", pair: "HBAR / SAUCE", holdings: "12 HBAR + 40 SAUCE", status: "Earning fees", inRange: true, url: "https://www.saucerswap.finance/liquidity", networkId: "hedera:testnet" }]),
    openExternal: vi.fn(async () => undefined),
    ...over,
  };
}

function renderFeature(ui: ReactElement, f = features(), client = fakeClient()) {
  return { ...renderUi(<FeaturesProvider client={f}>{ui}</FeaturesProvider>, { client }), f };
}

/** Network names must not leak into the default UI. */
function expectNoNetworkNames(container: HTMLElement) {
  for (const n of [...NETWORKS.map((x) => x.name), "Devnet", "Testnet", "Hedera", "Solana Devnet"]) expect(container.textContent).not.toContain(n);
}

describe("feature screens", () => {
  it("Stake overview: coins, rates and plain statuses; other families say coming soon", async () => {
    const user = userEvent.setup();
    const { f, container } = renderFeature(<StakeHome />);
    expect(await screen.findByText("About 6.8% a year")).toBeInTheDocument();
    expect(screen.getAllByTestId("stake-position")).toHaveLength(2);
    expect(screen.getByText("Ready to move back to your balance")).toBeInTheDocument();
    expect(screen.getByText("Staking DOT is coming soon.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move to balance" }));
    expect(f.stakeAction).toHaveBeenCalledWith({ assetKey: "sol", positionId: "Acct2", action: "withdraw" });
    expectNoNetworkNames(container);
  });

  it("Stake SOL: preselects the wallet's pick and stakes the amount", async () => {
    const user = userEvent.setup();
    const { f } = renderFeature(<StakeAsset assetKey="sol" />);
    await screen.findByText("Picked for you");
    await waitFor(() => expect(screen.getAllByRole("radio")[1]).toBeChecked());
    await user.type(screen.getByLabelText("Amount"), "1.5");
    await user.click(screen.getByRole("button", { name: "Stake 1.5 SOL" }));
    expect(f.stake).toHaveBeenCalledWith({ assetKey: "sol", optionId: "v2", amount: "1.5" });
  });

  it("Swap: asks for a price, shows 'You get ~', steps and warnings, then queues the approval", async () => {
    const user = userEvent.setup();
    const { f, container } = renderFeature(<Swap sell="usdc" buy="eth" />);
    await user.type(await screen.findByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Get price" }));
    expect(await screen.findByTestId("swap-you-get")).toHaveTextContent("You get ~0.03 ETH");
    expect(f.swapQuote).toHaveBeenCalledWith({ sell: "usdc", buy: "eth", amount: "100", slippageBps: 50 });
    expect(screen.getByText("Allow 0x to use exactly 100 USDC")).toBeInTheDocument();
    expect(screen.getByText("This swap moves the price by 1.5%.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review and swap" }));
    expect(f.swapExecute).toHaveBeenCalledWith({ quoteId: "q1" });
    expectNoNetworkNames(container);
  });

  it("Buy: what and how much, then hand off to the provider; unavailable ones say why", async () => {
    const user = userEvent.setup();
    const { f } = renderFeature(<Buy />);
    await user.click(await screen.findByRole("button", { name: /SOL/ }));
    await user.type(screen.getByLabelText("How much (USD)"), "50");
    await user.click(screen.getByRole("button", { name: "See ways to pay" }));
    expect(await screen.findByText("Buying with MoonPay isn't switched on in this build.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue with Banxa" }));
    expect(f.buyOptions).toHaveBeenCalledWith({ assetKey: "sol", fiatAmount: 50, fiatCurrency: "USD" });
    expect(f.openExternal).toHaveBeenCalledWith("https://clipwallet.banxa-sandbox.com/?coinType=SOL");
  });

  it("Secure Trade: create an offer in plain words", async () => {
    const user = userEvent.setup();
    const hbar = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "hedera:testnet" };
    const sauce = { key: "hts:0.0.1", symbol: "SAUCE", name: "SAUCE", decimals: 6, networkId: "hedera:testnet", address: "0.0.1" };
    const client = fakeClient({ getPortfolio: vi.fn(async () => ({ balances: BALANCES, assets: [hbar, sauce], networks: NETWORKS, currency: "USD", updatedAt: 0, stale: [] })) });
    const { f } = renderFeature(<TradeCreate />, features(), client);
    const amounts = await screen.findAllByLabelText("Amount");
    await user.type(amounts[0]!, "10");
    await user.type(amounts[1]!, "5");
    await user.type(screen.getByLabelText("Trade with"), "0.0.2002");
    await user.click(screen.getByRole("radio", { name: "They're here now" }));
    await user.click(screen.getByRole("button", { name: "Review trade" }));
    expect(f.tradeCreate).toHaveBeenCalledWith({ give: { assetKey: "hbar", amount: "10" }, get: { assetKey: "hts:0.0.1", amount: "5" }, counterparty: "0.0.2002", mode: "direct", expiresInHours: undefined });
  });

  it("Secure Trade: the waiting offer shows its share link and what the other side must do", async () => {
    renderFeature(<TradeDetail id="t1" />);
    expect(await screen.findByTestId("trade-link")).toHaveTextContent("https://clipwallet.example/trade#offer=abc");
    expect(screen.getByText("0.0.2002 must add SAUCE to their account before they can accept.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("Secure Trade review: accept only when the offer checks out", async () => {
    const user = userEvent.setup();
    const { f } = renderFeature(<TradeReview link="https://clipwallet.example/trade#offer=abc" />);
    await user.click(screen.getByRole("button", { name: "Check offer" }));
    expect(await screen.findByTestId("trade-review-title")).toHaveTextContent("Trade 5 SAUCE for 10 HBAR with 0.0.2002");
    expect(screen.getByText("Add SAUCE to your account")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept trade" }));
    expect(f.tradeAccept).toHaveBeenCalledWith({ link: "https://clipwallet.example/trade#offer=abc" });

    const bad = features({ tradeReview: vi.fn(async () => ({ ...(await features().tradeReview({ link: "" })), problem: "This link doesn't match the trade inside it." })) });
    renderFeature(<TradeReview link="x" />, bad);
    await user.click(screen.getAllByRole("button", { name: "Check offer" }).at(-1)!);
    expect(await screen.findByText("This link doesn't match the trade inside it.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Accept trade" })).toHaveLength(1); // only the first render's
  });

  it("Explore: liquidity positions and featured apps open in a new tab", async () => {
    const user = userEvent.setup();
    const { f } = renderFeature(<Explore />);
    expect(await screen.findByText("HBAR / SAUCE")).toBeInTheDocument();
    expect(screen.getByText("12 HBAR + 40 SAUCE")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Swap tokens and earn/ }));
    expect(f.openExternal).toHaveBeenCalledWith("https://www.saucerswap.finance/");
  });

  it("Explore: Trade & earn lists curated apps with plain notes and the regulatory disclaimer", async () => {
    const user = userEvent.setup();
    const f = features({
      featured: vi.fn(async () => [
        { name: "SaucerSwap", url: "https://www.saucerswap.finance/", domain: "saucerswap.finance", category: "swap" as const, description: "Swap tokens and earn from liquidity.", family: "hedera" as const },
        { name: "Hyperliquid", url: "https://app.hyperliquid.xyz/trade", domain: "app.hyperliquid.xyz", category: "trade" as const, kind: "perps" as const, description: "Trade perpetual futures.", note: "Leveraged trading can lose everything you put in, fast. Not available in the US, Ontario or sanctioned countries.", family: "evm" as const },
      ]),
    });
    const { container } = renderFeature(<Explore />, f);
    const section = await screen.findByTestId("trade-and-earn");
    expect(within(section).getByText(/aren't available in your country/)).toBeInTheDocument();
    expect(within(section).getByText(/Leveraged trading can lose everything/)).toBeInTheDocument();
    expect(within(section).getByText("Futures")).toBeInTheDocument();
    expect(within(section).queryByText("SaucerSwap")).not.toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: /Trade perpetual futures/ }));
    expect(f.openExternal).toHaveBeenCalledWith("https://app.hyperliquid.xyz/trade");
    expectNoNetworkNames(container);
  });

  it("Explore: no Trade & earn section when no such apps apply", async () => {
    renderFeature(<Explore />);
    await screen.findByText("HBAR / SAUCE");
    expect(screen.queryByTestId("trade-and-earn")).not.toBeInTheDocument();
  });

  it("featureRoute maps paths and ignores the rest", () => {
    expect(featureRoute(["stake"], new URLSearchParams())).not.toBeNull();
    expect(featureRoute(["trade", "open"], new URLSearchParams("link=x"))).not.toBeNull();
    expect(featureRoute(["settings"], new URLSearchParams())).toBeNull();
  });
});

describe("feature entry points in the wallet", () => {
  it("adds an Explore tab, Swap/Buy/Stake on Home and a More menu in Settings when a features client is given", async () => {
    const user = userEvent.setup();
    const f = features();
    renderUi(<WalletApp client={fakeClient()} features={f} memoryRouter />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav).toHaveTextContent("Explore");
    expect(await screen.findByRole("button", { name: /Swap/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Explore" }));
    await waitFor(() => expect(f.featured).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const more = await screen.findByRole("navigation", { name: "More" });
    expect(more).toHaveTextContent("Secure Trade");
    await user.click(within(more).getByRole("button", { name: "Stake" }));
    await waitFor(() => expect(f.stakingOverview).toHaveBeenCalled());
  });

  it("hides every feature entry point without a features client", async () => {
    renderUi(<WalletApp client={fakeClient()} memoryRouter />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav).not.toHaveTextContent("Explore");
    await screen.findByRole("list", { name: "Your assets" });
    expect(screen.queryByRole("button", { name: "Buy" })).not.toBeInTheDocument();
  });
});
