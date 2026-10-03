import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectHardware, HardwareSettings, KeystoneExchangeScreen, LedgerConfirm, type HardwareAccountView, type HardwareClient, type ScannerStart } from "../src/hardware";
import { renderUi } from "./render";

const acct = (i: number, kind: "ledger" | "keystone" = "ledger"): HardwareAccountView => ({
  id: `hw:${kind}:4418d0b4:evm:${i}`,
  family: "evm",
  index: i,
  address: i === 0 ? "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" : "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0",
  derivationPath: `m/44'/60'/0'/0/${i}`,
  hardware: { kind, fingerprint: "4418d0b4", pathStyle: "standard" },
});

function fakeHardware(over: Partial<HardwareClient> = {}): HardwareClient {
  return {
    ledgerAccounts: vi.fn(async (_f, start: number) => [acct(start), acct(start + 1)]),
    keystoneImport: vi.fn(async () => ({ fingerprint: "e9181cf3", families: ["evm" as const] })),
    keystoneAccounts: vi.fn(async () => [acct(0, "keystone")]),
    addAccounts: vi.fn(async () => undefined),
    listAccounts: vi.fn(async () => [acct(0)]),
    renameAccount: vi.fn(async () => undefined),
    forgetDevice: vi.fn(async () => undefined),
    setActive: vi.fn(async () => undefined),
    ...over,
  };
}

/** A camera that "sees" the given QR texts in order. */
const fakeCamera =
  (texts: string[]): ScannerStart =>
  async (_video, opts) => {
    setTimeout(() => texts.forEach((t) => opts.onText(t)), 0);
    return { engine: "jsqr", stop: () => undefined };
  };

// Keystone SDK vector (KeystoneHQ/keystone-sdk-base CryptoHDKey.test.ts)
const HDKEY =
  "ur:crypto-hdkey/oxaxhdclaowdverokopdinhseeroisyalksaykctjshedprnuyjyfgrovawewftyghceglrpkgaahdcxtplfjsluknfwlaisaxwypalbjylswzamcxhscyuyloztmwfnldlgskpyptgsdecfamtaaddyoeadlncsdwykcsfnykaeykaocywlcscewfaycytedmfeayghlptnin";

describe("Connect a hardware wallet", () => {
  it("Ledger: device, then family, plain steps, connect, pick accounts", async () => {
    const user = userEvent.setup();
    const hw = fakeHardware();
    const onDone = vi.fn();
    renderUi(<ConnectHardware hardware={hw} onDone={onDone} requestLedger={async () => undefined} />);
    expect(screen.getByText(/Your keys stay on the device/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ledger/ }));
    await user.click(screen.getByRole("button", { name: /Ethereum and EVM apps/ }));
    expect(screen.getByText("Open the Ethereum app on it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(hw.ledgerAccounts).toHaveBeenCalledWith("evm", 0, 5, "standard");
    expect(await screen.findByText("0x9858Ef…aEda94")).toBeInTheDocument();
    await user.click(screen.getAllByRole("checkbox")[1]!);
    await user.click(screen.getByRole("button", { name: "Add 2 accounts" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(["hw:ledger:4418d0b4:evm:0", "hw:ledger:4418d0b4:evm:1"]));
  });

  it("Ledger errors are shown in plain words", async () => {
    const user = userEvent.setup();
    const err = Object.assign(new Error("hw/wrong-app"), { userMessage: "Open the Ethereum app on your Ledger, then try again.", code: "hw/wrong-app" });
    renderUi(<ConnectHardware hardware={fakeHardware({ ledgerAccounts: vi.fn(async () => Promise.reject(err)) })} onDone={vi.fn()} requestLedger={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: /Ledger/ }));
    await user.click(screen.getByRole("button", { name: /Ethereum/ }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Open the Ethereum app on your Ledger, then try again.");
  });

  it("Ledger Live accounts only in Advanced mode", async () => {
    const user = userEvent.setup();
    const hw = fakeHardware();
    renderUi(<ConnectHardware hardware={hw} onDone={vi.fn()} advanced requestLedger={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: /Ledger/ }));
    await user.click(screen.getByRole("button", { name: /Ethereum/ }));
    await user.click(screen.getByRole("switch", { name: "Use Ledger Live's accounts" }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(hw.ledgerAccounts).toHaveBeenCalledWith("evm", 0, 5, "ledger-live");
  });

  it("Keystone: no Hedera; scan the account code, then pick accounts", async () => {
    const user = userEvent.setup();
    const hw = fakeHardware();
    renderUi(<ConnectHardware hardware={hw} onDone={vi.fn()} scanner={fakeCamera(["not a ur", HDKEY.toUpperCase()])} />);
    await user.click(screen.getByRole("button", { name: /Keystone/ }));
    expect(screen.queryByRole("button", { name: /Hedera/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ethereum/ }));
    await waitFor(() => expect(hw.keystoneImport).toHaveBeenCalledWith(expect.objectContaining({ type: "crypto-hdkey" })));
    await user.click(await screen.findByRole("button", { name: "Show accounts" }));
    expect(hw.keystoneAccounts).toHaveBeenCalledWith("evm", 0, 5, "standard");
  });
});

describe("Ledger USB permission", () => {
  it("a browser without WebHID gets a plain answer, before any background call", async () => {
    const user = userEvent.setup();
    const hw = fakeHardware();
    renderUi(<ConnectHardware hardware={hw} onDone={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Ledger/ }));
    await user.click(screen.getByRole("button", { name: /Solana/ }));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This browser can't talk to a Ledger over USB.");
    expect(hw.ledgerAccounts).not.toHaveBeenCalled();
  });
});

describe("Signing with a hardware wallet", () => {
  it("Ledger: confirm-on-device steps, then errors with a retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const first = renderUi(<LedgerConfirm title="Send 0.01 ETH" app="Ethereum" onCancel={vi.fn()} />);
    expect(screen.getByText("Make sure the Ethereum app is open on your Ledger.")).toBeInTheDocument();
    first.unmount();
    renderUi(<LedgerConfirm title="Send 0.01 ETH" app="Ethereum" onCancel={vi.fn()} error="Unlock your Ledger with your PIN, then try again." onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unlock your Ledger");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });

  it("Keystone: shows the request QR, then scans the signature", async () => {
    const user = userEvent.setup();
    const onSig = vi.fn();
    // eth-signature vector (KeystoneHQ/keystone-sdk-base EthSignature.test.ts)
    const sig =
      "ur:eth-signature/otadtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdfptywtosrftahprdctrkbegylogdghjkbafhflamfwlohghtpsseaozorsimnybbtnnbiynlckenbtfmeeamsabnaeoxasjkwswfkekiieckhpecckssptndzelnwfecylbwaxisjeihkkjkjyjljtihdwlkamiy";
    renderUi(
      <KeystoneExchangeScreen
        title="Send 0.01 ETH"
        request={{ type: "bytes", cborHex: "4401020304", expect: ["eth-signature"] }}
        onSignature={onSig}
        onCancel={vi.fn()}
        scanner={fakeCamera([sig])}
      />,
    );
    expect(await screen.findByAltText("Request for your Keystone")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next: scan the signature" }));
    await waitFor(() => expect(onSig).toHaveBeenCalledWith(expect.objectContaining({ type: "eth-signature" })));
  });
});

describe("Settings → Hardware wallets", () => {
  it("lists devices and accounts, renames and removes", async () => {
    const user = userEvent.setup();
    const hw = fakeHardware();
    vi.stubGlobal("confirm", () => true);
    renderUi(<HardwareSettings hardware={hw} onAdd={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByText("Ethereum and EVM apps · Account 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use this account" }));
    expect(hw.setActive).toHaveBeenCalledWith("evm", "hw:ledger:4418d0b4:evm:0");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByLabelText("Account name"), "Savings{Enter}");
    expect(hw.renameAccount).toHaveBeenCalledWith("hw:ledger:4418d0b4:evm:0", "Savings");
    await user.click(screen.getByRole("button", { name: "Remove Ledger" }));
    expect(hw.forgetDevice).toHaveBeenCalledWith("ledger", "4418d0b4");
    vi.unstubAllGlobals();
  });

  it("empty state", async () => {
    renderUi(<HardwareSettings hardware={fakeHardware({ listAccounts: vi.fn(async () => []) })} onAdd={vi.fn()} />);
    expect(await screen.findByText("No hardware wallet yet")).toBeInTheDocument();
  });
});

describe("HardwareApprovalGate", () => {
  it("shows the approval until the background reports a device step, then the device screen", async () => {
    const { HardwareApprovalGate } = await import("../src/hardware");
    const user = userEvent.setup();
    const client = { keystoneAnswer: vi.fn(async () => undefined), hardwareCancel: vi.fn(async () => undefined) };
    const first = renderUi(
      <HardwareApprovalGate approvalId="a1" title="Send 0.01 ETH" state={undefined} client={client}>
        <p>approval screen</p>
      </HardwareApprovalGate>,
    );
    expect(screen.getByText("approval screen")).toBeInTheDocument();
    first.unmount();
    renderUi(
      <HardwareApprovalGate approvalId="a1" title="Send 0.01 ETH" state={{ kind: "ledger", stage: "confirm", app: "Ethereum" }} client={client}>
        <p>approval screen</p>
      </HardwareApprovalGate>,
    );
    expect(screen.getByRole("heading", { name: "Confirm on your Ledger" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(client.hardwareCancel).toHaveBeenCalledWith("a1");
  });
});
