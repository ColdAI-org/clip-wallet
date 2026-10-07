import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { App } from "../src/App";
import { Onboarding } from "../src/screens/Onboarding";
import { Send } from "../src/screens/Send";
import { Explore } from "../src/screens/Explore";
import { ApprovalScreen } from "../src/screens/Approval";
import { renderWith, testWallet, WORDS } from "./helpers";
import { EVM_ADDRESS, fakePort } from "../../engine/test/fixtures";

const PW = "a long test password 42!";

describe("Onboarding (same flow as the extension)", () => {
  it("create → password → phrase reveal → backup check → biometrics → done", async () => {
    const wallet = testWallet();
    const onFinished = jest.fn();
    renderWith(wallet, <Onboarding onFinished={onFinished} confirmIndexes={[0, 4, 11]} />);
    fireEvent.press(screen.getByTestId("create"));
    fireEvent.changeText(screen.getByTestId("password"), PW);
    fireEvent.changeText(screen.getByTestId("password2"), PW);
    await waitFor(() => expect(screen.getByTestId("strength")).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId("password-submit")));
    // Hidden until the user asks.
    await waitFor(() => expect(screen.getByTestId("word-0").props.children).toBe("••••"));
    expect(screen.getByTestId("phrase-continue").props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("reveal"));
    expect(screen.getByTestId("word-0").props.children).toBe(WORDS[0]);
    fireEvent.press(screen.getByTestId("saved"));
    fireEvent.press(screen.getByTestId("phrase-continue"));
    // Wrong words are refused.
    fireEvent.changeText(screen.getByTestId("confirm-0"), "nope");
    fireEvent.changeText(screen.getByTestId("confirm-1"), WORDS[4]);
    fireEvent.changeText(screen.getByTestId("confirm-2"), WORDS[11]);
    fireEvent.press(screen.getByTestId("confirm"));
    expect(screen.getByText("Those words don't match. Check your written copy and try again.")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("confirm-0"), WORDS[0]);
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(screen.getByText("Unlock with Face ID?")).toBeTruthy());
    fireEvent.press(screen.getByTestId("biometrics-skip"));
    fireEvent.press(screen.getByTestId("open-wallet"));
    expect(onFinished).toHaveBeenCalled();
    expect(await wallet.vault.status()).toBe("unlocked");
  });
});

describe("App", () => {
  it("lands on Home with one total after unlocking", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    await wallet.client.lock();
    render(<App wallet={wallet} />);
    fireEvent.changeText(await screen.findByTestId("unlock-password"), PW);
    await act(async () => fireEvent.press(screen.getByTestId("unlock")));
    await waitFor(() => expect(screen.getByTestId("total").props.children).toBe("$1,500.00"));
    expect(screen.getByText("ETH")).toBeTruthy();
    // Networks are invisible on Home.
    expect(screen.queryByText("Sepolia")).toBeNull();
  });

  it("shows a dapp's personal_sign as an approval sheet and answers the dapp after Approve", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    await wallet.engine.permissions.grant("https://dapp.test", "evm");
    render(<App wallet={wallet} />);
    await screen.findByTestId("total");
    const { port, send } = fakePort();
    wallet.engine.attachDappPort(port, "https://dapp.test");
    let reply: Awaited<ReturnType<typeof send>> | undefined;
    await act(async () => {
      void send("https://dapp.test", "personal_sign", ["0x68656c6c6f", EVM_ADDRESS]).then((r) => (reply = r));
    });
    await waitFor(() => expect(screen.getByTestId("approval-title").props.children).toBe("Sign in to dapp.test"));
    expect(screen.getByTestId("dapp-domain").props.children).toBe("dapp.test");
    expect(screen.getByTestId("network-chip")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("approve")));
    await waitFor(() => expect(reply?.result).toBe(`0x${"07".repeat(64)}1c`));
    expect(wallet.vault.signed).toHaveLength(1);
  });

  it("Settings → Advanced mode reveals networks; WalletConnect says plainly it is off", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    render(<App wallet={wallet} initialRoute={{ name: "settings" }} />);
    expect(await screen.findByText(/isn't switched on in this build yet/)).toBeTruthy();
    expect(screen.queryByText("eip155:84532")).toBeNull();
    await act(async () => fireEvent(screen.getByTestId("advanced"), "valueChange", true));
    await waitFor(() => expect(screen.getByText("eip155:84532")).toBeTruthy());
  });
});

describe("Send", () => {
  it("asks where the money should arrive when the address fits several networks", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    renderWith(wallet, <Send />, { name: "send" });
    fireEvent.changeText(await screen.findByTestId("to"), "0x000000000000000000000000000000000000dEaD");
    fireEvent.changeText(screen.getByTestId("amount"), "0.1");
    await waitFor(() => expect(screen.getByTestId("asset-picker")).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId("review")));
    expect(await screen.findByText("Where should the ETH arrive?")).toBeTruthy();
    expect(screen.getByText("Sepolia")).toBeTruthy();
    expect(screen.getByText("You have 0.5 ETH there")).toBeTruthy();
    expect(screen.getByText("We'll move your ETH there for you")).toBeTruthy();
  });
});

describe("Explore", () => {
  it("lists featured apps (they open in the in-app browser) and what's staked", async () => {
    const wallet = testWallet();
    await wallet.engine.handle({ type: "createWallet", password: PW });
    renderWith(wallet, <Explore />, { name: "explore" });
    await waitFor(() => expect(screen.getByText("SaucerSwap")).toBeTruthy());
    expect(screen.getByText("Staking ADA is coming soon.")).toBeTruthy();
  });
});

const ALEX = "0x000000000000000000000000000000000000dEaD";

async function walletWithAlex() {
  const wallet = testWallet();
  await wallet.client.createWallet(PW);
  const alex = await wallet.social.saveContact({ input: { name: "Alex", addresses: [{ family: "evm", address: ALEX }] } });
  return { wallet, alex };
}

describe("Contacts", () => {
  it("adds a contact (kind of address detected) and lists it", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    render(<App wallet={wallet} initialRoute={{ name: "contacts" }} />);
    expect(await screen.findByText("No contacts yet")).toBeTruthy();
    fireEvent.press(screen.getByTestId("contact-add"));
    fireEvent.changeText(await screen.findByTestId("contact-name"), "Sam");
    fireEvent.changeText(screen.getByTestId("contact-address-0"), ALEX);
    await act(async () => fireEvent(screen.getByTestId("contact-address-0"), "blur"));
    // The kind of address is worked out from the address (only EVM networks in the test wallet: no picker).
    expect(await screen.findByText("Ethereum-style (ETH, USDC, Base, Arbitrum…)")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("contact-save")));
    expect(await screen.findByText("Sam")).toBeTruthy();
    expect((await wallet.social.contacts()).contacts.map((c) => c.name)).toEqual(["Sam"]);
  });
});

describe("Send with contacts", () => {
  it("suggests a contact under To and fills the address", async () => {
    const { wallet, alex } = await walletWithAlex();
    renderWith(wallet, <Send />, { name: "send" });
    fireEvent.changeText(await screen.findByTestId("to"), "Al");
    fireEvent.press(await screen.findByTestId(`suggest-${alex.id}`));
    expect(screen.getByTestId("to").props.value).toBe(ALEX);
    expect(screen.getByText("Alex (from your contacts)")).toBeTruthy();
    expect(screen.queryByTestId(`suggest-${alex.id}`)).toBeNull();
  });
});

describe("Approval recipient check", () => {
  async function sendApproval(wallet: ReturnType<typeof testWallet>, to: string) {
    const p = await wallet.client.getPortfolio();
    const eth = p.balances.find((b) => b.asset.symbol === "ETH" && BigInt(b.amount) > 0n)!;
    const id = await wallet.client.send({ assetKey: eth.asset.key, networkId: eth.asset.networkId, to, amount: "0.01" });
    return (await wallet.client.getApproval(id))!;
  }

  it("says who the money goes to when the recipient is a saved contact", async () => {
    const { wallet } = await walletWithAlex();
    const view = await sendApproval(wallet, ALEX);
    expect(view.recipient?.address.toLowerCase()).toBe(ALEX.toLowerCase());
    renderWith(wallet, <ApprovalScreen approval={view} onDone={() => undefined} />);
    expect(await screen.findByText("Sending to Alex")).toBeTruthy();
  });

  it("warns about a look-alike of a saved address", async () => {
    const { wallet } = await walletWithAlex();
    const fake = "0x0000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaadEaD";
    const view = await sendApproval(wallet, fake);
    renderWith(wallet, <ApprovalScreen approval={view} onDone={() => undefined} />);
    expect(await screen.findByTestId("recipient-lookalike")).toBeTruthy();
    expect(screen.getByText("Look-alike address")).toBeTruthy();
    expect(screen.getByText(`Saved: ${ALEX}`)).toBeTruthy();
  });
});

describe("Settings language", () => {
  it("saves the chosen language and formats numbers for it", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    render(<App wallet={wallet} initialRoute={{ name: "settings" }} />);
    expect(await screen.findByText("Match device (English)")).toBeTruthy();
    expect(screen.getByText("Deutsch")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("locale-de")));
    await waitFor(async () => expect((await wallet.client.getState()).prefs.locale).toBe("de"));
    fireEvent.press(screen.getByTestId("tab-home"));
    // German: "." groups thousands, "," marks decimals.
    await waitFor(() => expect(String(screen.getByTestId("total").props.children)).toMatch(/1\.500,00/));
  });
});

describe("Explore Discover", () => {
  it("shows Discover first with the risk note, even when market data can't load", async () => {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    renderWith(wallet, <Explore />, { name: "explore" });
    expect(await screen.findByTestId("discover")).toBeTruthy();
    expect(screen.getByText(/New and trending tokens are risky/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("SaucerSwap")).toBeTruthy());
  });
});

describe("Approval paid through a bonded Connector (settle on Hedera)", () => {
  async function fundedApproval(stage: "offer" | "opened" | "late", extra: Record<string, unknown> = {}) {
    const wallet = testWallet();
    await wallet.client.createWallet(PW);
    const p = await wallet.client.getPortfolio();
    const eth = p.balances.find((b) => b.asset.symbol === "ETH" && BigInt(b.amount) > 0n)!;
    const id = await wallet.client.send({ assetKey: eth.asset.key, networkId: eth.asset.networkId, to: "0x000000000000000000000000000000000000dEaD", amount: "0.01" });
    const view = (await wallet.client.getApproval(id))!;
    const amt = (amount: string, symbol: string, decimals: number) => ({ amount, symbol, decimals });
    view.plan = {
      ...(view.plan ?? { source: "Your balance", sponsored: false, readyInSeconds: 12, steps: [], settlement: "" }),
      funding: { orderId: `0x${"0d".repeat(32)}`, stage, provider: "Clip test Connector", pay: amt("13052000", "USDC", 6), receive: amt("13000000", "USDC", 6), fee: amt("52000", "USDC", 6), payback: amt("19800000000", "HBAR", 8), approveFirst: true, etaSeconds: 90, deadline: 1_800_001_800, ...extra },
    };
    return { wallet, view };
  }

  it("names the Connector as the source and keeps the normal buttons for the offer", async () => {
    const { wallet, view } = await fundedApproval("offer");
    renderWith(wallet, <ApprovalScreen approval={view} onDone={() => undefined} />);
    expect(await screen.findByText("Your other balance, through Clip test Connector")).toBeTruthy();
    expect(screen.getByTestId("approve")).toBeTruthy();
  });

  it("shows progress while the money is on its way, without Approve or Reject", async () => {
    const { wallet, view } = await fundedApproval("opened");
    renderWith(wallet, <ApprovalScreen approval={view} onDone={() => undefined} />);
    expect(await screen.findByText("Order confirmed. Clip test Connector is sending 13 USDC.")).toBeTruthy();
    expect(screen.queryByTestId("approve")).toBeNull();
    expect(screen.queryByTestId("reject")).toBeNull();
  });

  it("offers the one-tap claim when it's late", async () => {
    const { wallet, view } = await fundedApproval("late");
    renderWith(wallet, <ApprovalScreen approval={view} onDone={() => undefined} />);
    expect(await screen.findByText(/Your payment didn't arrive in time — you've been paid back 198 HBAR on Hedera/)).toBeTruthy();
    expect(screen.getByText("Claim 198 HBAR")).toBeTruthy();
  });
});
