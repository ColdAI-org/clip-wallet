import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionApproval, ConnectApproval } from "../src/screens/Approval";
import { Home } from "../src/screens/Home";
import { Send } from "../src/screens/Send";
import { Onboarding } from "../src/screens/Onboarding";
import { WalletApp } from "../src/App";
import { NETWORKS, fakeClient, payApproval, state } from "./fake-client";
import { renderUi } from "./render";

describe("Approval screen", () => {
  it("shows dapp, network chip, title, fiat line and the three plain rows", () => {
    renderUi(<TransactionApproval approval={payApproval()} />);
    expect(screen.getByText("Magic Eden")).toBeInTheDocument();
    expect(screen.getByText("magiceden.io")).toBeInTheDocument();
    expect(screen.getByText("(verified)")).toBeInTheDocument();
    expect(screen.getByText("Base Sepolia")).toHaveClass("clip-network-chip");
    expect(screen.getByRole("heading", { level: 1, name: "Pay 25 USDC" })).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();

    const row = (label: string) => screen.getByText(label).closest(".clip-row") as HTMLElement;
    expect(within(row("From")).getByText("Your balance")).toBeInTheDocument();
    expect(within(row("Fee")).getByText("$0.04")).toBeInTheDocument();
    expect(within(row("Ready")).getByText("in about 10 seconds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("reveals numbered steps with simulated balance changes and the settlement note behind Details", async () => {
    const user = userEvent.setup();
    renderUi(<TransactionApproval approval={payApproval()} />);
    const toggle = screen.getByRole("button", { name: /Details/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Pay Magic Eden")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const steps = screen.getAllByRole("listitem").filter((li) => li.classList.contains("clip-step"));
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("1Move 13 USDC from your other balance");
    expect(steps[1]).toHaveTextContent("2Network fee paid for you");
    expect(steps[2]).toHaveTextContent("3Pay Magic Eden");
    expect(within(steps[2]!).getByRole("list", { name: "Simulated balance changes" })).toHaveTextContent("−25 USDC");
    expect(screen.getByText(/nothing leaves your balance/)).toBeInTheDocument();
    // No raw data or network ids outside Advanced mode.
    expect(screen.queryByLabelText("Raw request")).not.toBeInTheDocument();
  });

  it("orders warnings by level above the buttons", () => {
    renderUi(
      <TransactionApproval
        approval={payApproval({}, {
          warnings: [
            { level: "info", code: "new-recipient", message: "First time paying this app." },
            { level: "danger", code: "known-scam", message: "This site is a known scam." },
            { level: "caution", code: "unlimited-approval", message: "Lets it spend all your USDC." },
          ],
        })}
      />,
    );
    const notices = document.querySelectorAll(".clip-warnings .clip-notice");
    expect(Array.from(notices).map((n) => n.textContent)).toEqual([
      "This site is a known scam.",
      "Lets it spend all your USDC.",
      "First time paying this app.",
    ]);
  });

  it("calls approve and reject", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { client } = renderUi(<TransactionApproval approval={payApproval()} onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(client.approve).toHaveBeenCalledWith("appr-1", { allowBlind: undefined });
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it("shows only userMessage when approving fails", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      approve: vi.fn(async () => {
        throw { userMessage: "Not enough USDC to pay this.", code: "route/insufficient", raw: "execution reverted: 0x08c379a0" };
      }),
    });
    renderUi(<TransactionApproval approval={payApproval()} />, { client });
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Not enough USDC to pay this.")).toBeInTheDocument();
    expect(screen.queryByText(/execution reverted/)).not.toBeInTheDocument();
  });
});

describe("Blind requests", () => {
  const blind = () =>
    payApproval({ fiatValue: undefined }, {
      title: "Sign message",
      blind: true,
      simulated: false,
      balanceChanges: [],
      warnings: [{ level: "danger", code: "blind-signing", message: "Unreadable" }],
    });

  it("are blocked by default with no override", () => {
    renderUi(<TransactionApproval approval={blind()} />);
    expect(screen.getByRole("heading", { name: "Unreadable request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/so it's blocked/)).toBeInTheDocument();
    expect(screen.getByText(/Only Advanced mode can override this/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("stay blocked in Advanced mode until the explicit toggle is switched on", async () => {
    const user = userEvent.setup();
    const { client } = renderUi(<TransactionApproval approval={blind()} />, { state: state({}, { advanced: true }) });
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: "Sign this unreadable request anyway" }));
    expect(approve).toBeEnabled();
    await user.click(approve);
    expect(client.approve).toHaveBeenCalledWith("appr-1", { allowBlind: true });
  });
});

describe("Connect approval", () => {
  it("asks plainly with no network picker", () => {
    renderUi(
      <ConnectApproval
        approval={payApproval({ kind: "connect", decoded: undefined, connect: { accountLabel: "wallet address", address: "0xabc", permissions: ["See your address"] } })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Connect to Magic Eden?" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });
});

describe("Home", () => {
  it("merges the same asset across networks into one row and shows one total", async () => {
    renderUi(<Home />);
    await waitFor(() => expect(screen.getByTestId("total")).toHaveTextContent("$604.51"));
    const list = screen.getByRole("list", { name: "Your assets" });
    const rows = within(list).getAllByRole("button");
    const usdcRows = rows.filter((r) => r.querySelector(".clip-asset-row__symbol")?.textContent === "USDC");
    expect(usdcRows).toHaveLength(1);
    expect(usdcRows[0]).toHaveTextContent("$412.00");
    expect(usdcRows[0]).toHaveTextContent("412 USDC");
    // Bridged copy stays separate and labelled.
    const bridged = rows.find((r) => r.textContent?.includes("USDC.e"))!;
    expect(within(bridged).getByText("bridged")).toBeInTheDocument();
    // Spam hidden by default; no network names anywhere on Home.
    expect(screen.queryByText("CLAIM")).not.toBeInTheDocument();
    expect(screen.getByText("1 suspicious token hidden")).toBeInTheDocument();
    for (const n of NETWORKS) expect(screen.queryByText(new RegExp(n.name))).not.toBeInTheDocument();
  });

  it("hides small balances when the toggle is on", async () => {
    const user = userEvent.setup();
    const { client } = renderUi(<Home />);
    await screen.findByText("DUST");
    await user.click(screen.getByRole("switch", { name: "Hide small balances" }));
    expect(client.setPrefs).toHaveBeenCalledWith({ hideSmallBalances: true });
  });

  it("shows the per-network split only on the asset screen", async () => {
    const user = userEvent.setup();
    renderUi(<WalletApp client={fakeClient()} memoryRouter />);
    const list = await screen.findByRole("list", { name: "Your assets" });
    const usdcRow = (await within(list).findAllByRole("button")).find((r) => r.querySelector(".clip-asset-row__symbol")?.textContent === "USDC")!;
    await user.click(usdcRow);
    const split = await screen.findByTestId("network-split");
    expect(split).toHaveTextContent("Base Sepolia");
    expect(split).toHaveTextContent("300 USDC");
    expect(split).toHaveTextContent("Ethereum Sepolia");
    expect(split).toHaveTextContent("112 USDC");
  });
});

describe("Send: network-matters", () => {
  it("asks once in plain words when an address fits several networks, then remembers", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resolveRecipient: vi.fn(async () => ({
        kind: "ask" as const,
        address: "0x1111111111111111111111111111111111111111",
        candidates: [
          { network: NETWORKS[0]!, balance: "300000000" },
          { network: NETWORKS[1]!, balance: "112000000" },
        ],
      })),
    });
    renderUi(<Send assetKey="usdc" />, { client });
    await screen.findByRole("combobox", { name: "Asset to send" });
    await user.type(screen.getByLabelText("To"), "0x1111111111111111111111111111111111111111");
    await user.type(screen.getByLabelText("Amount"), "25");
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByRole("heading", { name: "Where should the USDC arrive?" })).toBeInTheDocument();
    expect(screen.getByText(/ask them which network to use/)).toBeInTheDocument();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Ethereum Sepolia/ }));
    await user.click(cont);
    expect(client.rememberRecipientNetwork).toHaveBeenCalledWith({
      address: "0x1111111111111111111111111111111111111111",
      assetKey: "usdc",
      networkId: "eip155:11155111",
    });
    expect(client.send).toHaveBeenCalledWith({ assetKey: "usdc", networkId: "eip155:11155111", to: "0x1111111111111111111111111111111111111111", amount: "25" });
  });

  it("never mentions a network when only one fits", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resolveRecipient: vi.fn(async () => ({ kind: "resolved" as const, address: "0.0.1234", networkId: "hedera:testnet" })),
    });
    renderUi(<Send assetKey="usdc" />, { client });
    await screen.findByRole("combobox", { name: "Asset to send" });
    await user.type(screen.getByLabelText("To"), "0.0.1234");
    await user.type(screen.getByLabelText("Amount"), "1");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => expect(client.send).toHaveBeenCalled());
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("rejects amounts above the balance", async () => {
    const user = userEvent.setup();
    renderUi(<Send assetKey="usdc" />);
    await screen.findByRole("combobox", { name: "Asset to send" });
    await user.type(screen.getByLabelText("To"), "x");
    await user.type(screen.getByLabelText("Amount"), "1000");
    expect(screen.getByText("You have 412 USDC.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });
});

describe("Onboarding", () => {
  it("creates, shows the phrase once and checks 3 words", async () => {
    const user = userEvent.setup();
    const client = fakeClient({}, state({ status: "empty" }));
    renderUi(<Onboarding onFinished={vi.fn()} confirmIndexes={[0, 4, 11]} />, { client, state: state({ status: "empty" }) });
    await user.click(screen.getByRole("button", { name: "Create a new wallet" }));
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    expect(screen.getByRole("meter", { name: "Password strength" })).toHaveAttribute("aria-valuenow", "4");
    await user.type(screen.getByLabelText("Type it again"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create wallet" }));
    expect(client.createWallet).toHaveBeenCalledWith("correct horse battery staple");
    await user.click(await screen.findByRole("button", { name: "Show my phrase" }));
    expect(screen.getByText("foxtrot")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "I wrote these words down" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Word #1"), "alpha");
    await user.type(screen.getByLabelText("Word #5"), "wrong");
    await user.type(screen.getByLabelText("Word #12"), "lima");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("alert")).toHaveTextContent("don't match");
    await user.clear(screen.getByLabelText("Word #5"));
    await user.type(screen.getByLabelText("Word #5"), "echo");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { name: "Unlock with Face ID or Touch ID?" })).toBeInTheDocument();
    // The phrase is gone from the DOM after the check.
    expect(screen.queryByText("foxtrot")).not.toBeInTheDocument();
  });

  it("rejects weak passwords", async () => {
    const user = userEvent.setup();
    renderUi(<Onboarding onFinished={vi.fn()} />, { state: state({ status: "empty" }) });
    await user.click(screen.getByRole("button", { name: "Create a new wallet" }));
    await user.type(screen.getByLabelText("Password"), "password1");
    await user.type(screen.getByLabelText("Type it again"), "password1");
    expect(screen.getByText(/Too common/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create wallet" })).toBeDisabled();
  });
});

describe("WalletApp onboarding", () => {
  it("keeps onboarding on screen after the wallet is created (vault already unlocked)", async () => {
    const user = userEvent.setup();
    let status: "empty" | "unlocked" = "empty";
    let notify: () => void = () => undefined;
    const client = fakeClient({
      getState: vi.fn(async () => state({ status })),
      createWallet: vi.fn(async () => {
        status = "unlocked";
        notify();
      }),
      onChange: (cb) => {
        notify = cb;
        return () => undefined;
      },
    });
    renderUi(<WalletApp client={client} memoryRouter />, { client });
    await user.click(await screen.findByRole("button", { name: "Create a new wallet" }));
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.type(screen.getByLabelText("Type it again"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create wallet" }));
    expect(await screen.findByRole("heading", { name: "Your recovery phrase" })).toBeInTheDocument();
  });
});

describe("Approval plan problems", () => {
  it("blocks Approve with a plain reason when the plan can't be paid", () => {
    const base = payApproval();
    renderUi(<TransactionApproval approval={{ ...base, plan: { ...base.plan!, problem: "You don't have enough USDC for this." } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("You don't have enough USDC for this.");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});

describe("Message signing", () => {
  it("shows no money rows when nothing moves", () => {
    renderUi(<TransactionApproval approval={payApproval({ fiatValue: undefined, plan: undefined }, { title: "Sign in to magiceden.io", balanceChanges: [], fee: undefined })} />);
    expect(screen.getByRole("heading", { name: "Sign in to magiceden.io" })).toBeInTheDocument();
    expect(screen.queryByText("From")).not.toBeInTheDocument();
    expect(screen.queryByText("Fee")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});
