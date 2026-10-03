import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { App } from "../src/App";
import { Onboarding } from "../src/screens/Onboarding";
import { Send } from "../src/screens/Send";
import { renderWith, testWallet, WORDS } from "./helpers";
import { EVM_ADDRESS, fakePort } from "../../../packages/engine/test/fixtures";

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
