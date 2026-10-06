/** Stake, Swap, Buy and Secure Trade screens, plus how you reach them (Explore tab, Home, asset detail, deep link). */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Share } from "react-native";
import { App } from "../src/App";
import { Stake } from "../src/screens/Stake";
import { Swap } from "../src/screens/Swap";
import { Buy } from "../src/screens/Buy";
import { TradeCreate, TradeDetail, TradeHome, TradeReview } from "../src/screens/Trade";
import { eventually, renderWith, testWallet } from "./helpers";
import { OFFER_LINK, REVIEW } from "./feature-fixtures";

const PW = "a long test password 42!";

/** The last feature request of this type (screens also reload their data after an action). */
const lastCall = (w: ReturnType<typeof testWallet>, type: string) => [...w.featureCalls].reverse().find((c) => c.type === type);

async function ready(answers?: Parameters<typeof testWallet>[0]) {
  const wallet = testWallet(answers);
  await wallet.client.createWallet(PW);
  return wallet;
}

describe("Stake", () => {
  it("lists every provider the engine exposes, live or coming soon, without network names", async () => {
    const wallet = await ready();
    renderWith(wallet, <Stake />, { name: "stake" });
    expect(await eventually(() => screen.getByText("About 2.5% a year"))).toBeTruthy();
    expect(screen.getByText("Stake HBAR")).toBeTruthy();
    expect(screen.getByText("2 SOL")).toBeTruthy();
    expect(screen.getByText("Earning rewards")).toBeTruthy();
    expect(screen.getByText("Staking ADA is coming soon.")).toBeTruthy();
    expect(screen.queryByText(/devnet|testnet|Sepolia/i)).toBeNull();
  });

  it("unstaking queues an approval and opens the approval sheet", async () => {
    const wallet = await ready();
    renderWith(wallet, <Stake />, { name: "stake" });
    await eventually(() => screen.getByText("2 SOL"));
    const target = await eventually(() => screen.getByTestId("stake-unstake"));
    await act(async () => fireEvent.press(target));
    expect(lastCall(wallet, "featStakeAction")).toMatchObject({ type: "featStakeAction", assetKey: "sol", positionId: "stake-1", action: "unstake" });
    expect((await wallet.client.listApprovals()).length).toBe(1);
  });

  it("Stake SOL: picks a validator for you, asks how much, then queues the approval", async () => {
    const wallet = await ready();
    renderWith(wallet, <Stake assetKey="sol" />, { name: "stake", assetKey: "sol" });
    expect(await eventually(() => screen.getByText("Picked for you"))).toBeTruthy();
    expect(screen.getByTestId("stake-option-v1").props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(screen.getByTestId("stake-option-v2"));
    fireEvent.changeText(screen.getByTestId("stake-amount"), "abc");
    expect(screen.getByText("Enter an amount like 2 or 0.5.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("stake-amount"), "1.5");
    await act(async () => fireEvent.press(screen.getByTestId("stake-submit")));
    expect(lastCall(wallet, "featStake")).toMatchObject({ type: "featStake", assetKey: "sol", optionId: "v2", amount: "1.5" });
  });

  it("Stake HBAR stakes the whole balance (no amount)", async () => {
    const wallet = await ready();
    renderWith(wallet, <Stake assetKey="hbar" />, { name: "stake", assetKey: "hbar" });
    const target = await eventually(() => screen.getByText("Stake my HBAR"));
    await act(async () => fireEvent.press(target));
    expect(screen.queryByTestId("stake-amount")).toBeNull();
    expect(lastCall(wallet, "featStake")).toMatchObject({ type: "featStake", assetKey: "hbar", optionId: "v1" });
    expect(lastCall(wallet, "featStake")?.amount).toBeUndefined();
  });
});

describe("Swap", () => {
  it("quotes in assets, then swaps through the approval queue", async () => {
    const wallet = await ready();
    renderWith(wallet, <Swap buy="usdc" />, { name: "swap" });
    await eventually(() => screen.getByTestId("swap-amount"));
    expect(screen.getByText("You have 0.5 ETH")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("swap-amount"), "0.1");
    fireEvent.press(screen.getByTestId("swap-slippage-100"));
    await act(async () => fireEvent.press(screen.getByTestId("swap-quote")));
    expect(lastCall(wallet, "featSwapQuote")).toMatchObject({ type: "featSwapQuote", sell: "eth", amount: "0.1", slippageBps: 100 });
    expect(screen.getByTestId("swap-you-get").props.children).toBe("You get ~250 USDC");
    expect(screen.queryByText("eip155:11155111")).toBeNull(); // network only in Advanced mode
    await act(async () => fireEvent.press(screen.getByTestId("swap-execute")));
    expect(lastCall(wallet, "featSwapExecute")).toMatchObject({ type: "featSwapExecute", quoteId: "q1" });
    expect((await wallet.client.listApprovals()).length).toBe(1);
  });

  it("refuses an amount it can't read; a comma decimal is half, as everywhere else", async () => {
    const wallet = await ready();
    renderWith(wallet, <Swap buy="usdc" />, { name: "swap" });
    fireEvent.changeText(await eventually(() => screen.getByTestId("swap-amount")), "1.2.3");
    await act(async () => fireEvent.press(screen.getByTestId("swap-quote")));
    expect(screen.getByText("Enter an amount like 25 or 0.5.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("swap-amount"), "1,5");
    await act(async () => fireEvent.press(screen.getByTestId("swap-quote")));
    await eventually(() => expect(wallet.featureCalls.some((c) => c.type === "featSwapQuote" && c.amount === "1.5")).toBe(true));
  });
});

describe("Buy", () => {
  it("asks what and how much, then opens the provider's widget in the in-app browser sheet", async () => {
    const wallet = await ready();
    renderWith(wallet, <Buy />, { name: "buy" });
    fireEvent.press(await eventually(() => screen.getByTestId("buy-sol")));
    fireEvent.changeText(screen.getByTestId("buy-amount"), "50");
    await act(async () => fireEvent.press(screen.getByTestId("buy-options")));
    expect(lastCall(wallet, "featBuyOptions")).toMatchObject({ type: "featBuyOptions", assetKey: "sol", fiatAmount: 50, fiatCurrency: "USD" });
    expect(screen.getByText("Buying with MoonPay isn't switched on in this build.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("buy-with-banxa")));
    expect(wallet.opened).toEqual(["https://clip.banxa-sandbox.com/?coinType=SOL"]);
  });

  it("says plainly when buying is off in this build", async () => {
    const wallet = await ready({ featBuyAssets: () => [] });
    renderWith(wallet, <Buy />, { name: "buy" });
    expect(await eventually(() => screen.getByText("Buying isn't switched on in this build"))).toBeTruthy();
  });
});

describe("Secure Trade", () => {
  it("lists trades and shares a waiting offer through the native share sheet", async () => {
    const wallet = await ready();
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
    const home = renderWith(wallet, <TradeHome />, { name: "trade" });
    expect(await eventually(() => screen.getByText("Trade 10 HBAR for 5 SAUCE with 0.0.1001"))).toBeTruthy();
    home.unmount();
    renderWith(wallet, <TradeDetail id="offer-1" />, { name: "trade-detail", id: "offer-1" });
    const target = await eventually(() => screen.getByTestId("trade-share"));
    await act(async () => fireEvent.press(target));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: OFFER_LINK }));
    expect(screen.getByLabelText("QR code for the trade link")).toBeTruthy();
  });

  it("creates an offer: give, get, who with, when", async () => {
    const wallet = await ready();
    renderWith(wallet, <TradeCreate />, { name: "trade-new" });
    fireEvent.changeText(await eventually(() => screen.getByTestId("give-amount")), "10");
    fireEvent.press(screen.getByTestId("get-kind-nft"));
    fireEvent.changeText(screen.getByTestId("get-token"), "0.0.4242");
    fireEvent.changeText(screen.getByTestId("get-serial"), "7");
    fireEvent.changeText(screen.getByTestId("trade-counterparty"), "bob");
    await act(async () => fireEvent.press(screen.getByTestId("trade-create")));
    expect(screen.getByText("Enter their account, like 0.0.1234.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("trade-counterparty"), "0.0.1001");
    fireEvent.press(screen.getByTestId("trade-hours-168"));
    await act(async () => fireEvent.press(screen.getByTestId("trade-create")));
    expect(lastCall(wallet, "featTradeCreate")).toMatchObject({
      type: "featTradeCreate",
      give: { assetKey: "hbar", amount: "10" },
      get: { nft: { tokenId: "0.0.4242", serial: "7" } },
      counterparty: "0.0.1001",
      mode: "scheduled",
      expiresInHours: 168,
    });
  });

  it("opening a link shows what the transaction does, then accepts", async () => {
    const wallet = await ready();
    renderWith(wallet, <TradeReview link="#offer=abc" />, { name: "trade-open", link: "#offer=abc" });
    expect(await eventually(() => screen.getByTestId("trade-review-title"))).toBeTruthy();
    expect(screen.getByText("Add SAUCE to your account")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("trade-accept")));
    expect(lastCall(wallet, "featTradeAccept")).toMatchObject({ type: "featTradeAccept", link: "#offer=abc" });
  });

  it("blocks Accept when the offer has a problem", async () => {
    const wallet = await ready({ featTradeReview: () => ({ ...REVIEW, problem: "This offer expired. Nothing moved." }) });
    renderWith(wallet, <TradeReview link="#offer=abc" />, { name: "trade-open", link: "#offer=abc" });
    expect(await eventually(() => screen.getByText("This offer expired. Nothing moved."))).toBeTruthy();
    expect(screen.queryByTestId("trade-accept")).toBeNull();
  });
});

describe("Getting there (same entry points as the extension)", () => {
  it("Explore is a tab with Stake, Swap, Buy and Secure Trade", async () => {
    const wallet = await ready();
    render(<App wallet={wallet} />);
    await eventually(() => screen.getByTestId("total"));
    fireEvent.press(screen.getByTestId("tab-explore"));
    fireEvent.press(await eventually(() => screen.getByTestId("explore-trade")));
    expect(await eventually(() => screen.getByText("Trade directly with someone you know. Both sides move together, or nothing moves."))).toBeTruthy();
  });

  it("Home has Swap / Buy / Stake; the asset screen pre-fills the asset", async () => {
    const wallet = await ready();
    render(<App wallet={wallet} />);
    await eventually(() => screen.getByTestId("total"));
    expect(screen.getByTestId("action-stake")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-eth"));
    // ETH has no live staking provider: no Stake button there.
    await eventually(() => screen.getByTestId("action-swap"));
    expect(screen.queryByTestId("action-stake")).toBeNull();
    fireEvent.press(screen.getByTestId("action-swap"));
    await eventually(() => screen.getByTestId("swap-amount"));
    expect(screen.getByTestId("swap-sell-eth").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("a clipwallet://trade deep link opens the offer review after unlocking", async () => {
    const wallet = await ready();
    const Linking = jest.requireMock("expo-linking") as { getInitialURL: jest.Mock };
    Linking.getInitialURL.mockResolvedValueOnce("clipwallet://trade#offer=eyJ2IjoxfQ");
    render(<App wallet={wallet} />);
    await eventually(() => screen.getByTestId("trade-review-title"));
    expect(wallet.featureCalls.find((c) => c.type === "featTradeReview")).toMatchObject({ link: "#offer=eyJ2IjoxfQ" });
  });
});
