/**
 * Hardware wallets: connect a Ledger (Bluetooth device pick → accounts) and a Keystone (camera → accounts),
 * Settings, and signing: the approval sheet shows the Ledger step / the Keystone QR exchange while the engine
 * waits. Device signing itself is faked (packages/engine/test/hardware-fixtures.ts); no keys anywhere.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AnimatedUr, urFromJson } from "@clip-wallet/hardware/qr";
import { App } from "../src/App";
import { ConnectHardware, HardwareSettings } from "../src/screens/Hardware";
import { EVM_ADDRESS, fakePort } from "../../engine/test/fixtures";
import { HW_ADDRESS } from "../../engine/test/hardware-fixtures";
import { eventually, renderWith, settle, testWallet } from "./helpers";

const PW = "a long test password 42!";

/** What the camera reads: one QR frame of a UR (uppercase, as Keystone shows it). */
const frame = (type: string, cborHex: string) => new AnimatedUr(urFromJson({ type, cborHex })).next();
const camera = () => (globalThis as { __camera?: { onBarcodeScanned?: (e: { data: string }) => void } }).__camera;

async function ready() {
  const wallet = testWallet();
  await wallet.client.createWallet(PW);
  return wallet;
}

async function press(testID: string) {
  const el = await eventually(() => screen.getByTestId(testID));
  // Not inside an async act(): Approve stays pending while the device is asked, and act would wait for it.
  fireEvent.press(el);
  await settle();
}

describe("Connect a hardware wallet", () => {
  it("Ledger: Bluetooth scan, pick the device, pick accounts; the first becomes the wallet's EVM account", async () => {
    const wallet = await ready();
    const onDone = jest.fn();
    renderWith(wallet, <ConnectHardware onDone={onDone} />, { name: "hardware-connect" });
    await press("hw-device-ledger");
    await press("hw-family-evm");
    expect(screen.getByText("Turn on Bluetooth on your Ledger (Settings → Bluetooth).")).toBeTruthy();
    await press("ledger-scan");
    await press("ledger-AA:BB");
    expect(wallet.ledgerPicked).toEqual({ id: "AA:BB", name: "Nano X 1A2B" });
    await press("hw-load");
    expect(screen.getByText("Account 1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("hw-pick-1"));
    await press("hw-add");
    expect(onDone).toHaveBeenCalled();
    expect(wallet.engine.cachedAccount("evm")?.address).toBe(HW_ADDRESS);
  });

  it("Keystone: scans the account QR, then the accounts", async () => {
    const wallet = await ready();
    renderWith(wallet, <ConnectHardware onDone={() => undefined} />, { name: "hardware-connect" });
    await press("hw-device-keystone");
    await press("hw-family-evm");
    // Another app's QR is ignored; a different UR type is refused in plain words.
    await act(async () => camera()?.onBarcodeScanned?.({ data: "https://example.com" }));
    await act(async () => camera()?.onBarcodeScanned?.({ data: frame("eth-signature", "a1") }));
    expect(screen.getByText("That's a different QR code. Scan the one your Keystone shows for this step.")).toBeTruthy();
    await act(async () => camera()?.onBarcodeScanned?.({ data: frame("crypto-multi-accounts", "a0") }));
    await settle();
    await press("hw-load");
    expect(screen.getByText("Account 1")).toBeTruthy();
  });

  it("Settings lists devices and switches back to the recovery-phrase account", async () => {
    const wallet = await ready();
    const [a] = await wallet.hardware.ledgerAccounts("evm", 0, 1);
    await wallet.hardware.addAccounts([a!.id]);
    renderWith(wallet, <HardwareSettings />, { name: "hardware" });
    expect(await eventually(() => screen.getByText("In use"))).toBeTruthy();
    expect(screen.getByText("Nano X")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText("Use my recovery-phrase accounts instead")));
    await settle();
    expect(wallet.engine.cachedAccount("evm")?.address).toBe(EVM_ADDRESS);
  });
});

describe("Signing with a hardware wallet", () => {
  it("Ledger: after Approve the sheet says to confirm on the Ledger, then the app gets its answer", async () => {
    const wallet = await ready();
    const [a] = await wallet.hardware.ledgerAccounts("evm", 0, 1);
    await wallet.hardware.addAccounts([a!.id]);
    await wallet.engine.permissions.grant("https://dapp.test", "evm");
    render(<App wallet={wallet} />);
    await eventually(() => screen.getByTestId("total"));
    const { port, send } = fakePort();
    wallet.engine.attachDappPort(port, "https://dapp.test");
    let reply: Awaited<ReturnType<typeof send>> | undefined;
    await act(async () => void send("https://dapp.test", "personal_sign", ["0x68656c6c6f", HW_ADDRESS]).then((r) => (reply = r)));
    await press("approve");
    expect(await eventually(() => screen.getByText("Confirm on your Ledger"))).toBeTruthy();
    expect(screen.getByText("Make sure the Ethereum app is open on your Ledger.")).toBeTruthy();
    await act(async () => wallet.releaseLedger());
    await settle();
    expect(reply?.result).toBe(`0x${"07".repeat(64)}1c`);
    expect(wallet.vault.signed).toHaveLength(0);
    expect(screen.queryByTestId("hardware-step")).toBeNull();
  });

  it("Keystone: shows the animated request QR, then scans the signature", async () => {
    const wallet = await ready();
    await wallet.hardware.keystoneImport({ type: "crypto-multi-accounts", cborHex: "a0" });
    const [k] = await wallet.hardware.keystoneAccounts("evm", 0, 1);
    await wallet.hardware.addAccounts([k!.id]);
    render(<App wallet={wallet} />);
    await eventually(() => screen.getByTestId("total"));
    let id = "";
    await act(async () => void (id = await wallet.client.send({ assetKey: "eth", networkId: "eip155:11155111", to: "0x000000000000000000000000000000000000dEaD", amount: "0.1" })));
    await act(async () => wallet.events.emit({ type: "approval", id }));
    await press("approve");
    expect(await eventually(() => screen.getByText("Scan with your Keystone"))).toBeTruthy();
    expect(screen.getByTestId("ur-qr")).toBeTruthy();
    await press("keystone-next");
    await act(async () => camera()?.onBarcodeScanned?.({ data: frame("eth-signature", "a1") }));
    await settle();
    expect(await wallet.client.getApproval(id)).toBeNull();
    expect(screen.queryByTestId("hardware-step")).toBeNull();
  });

  it("Cancel stops waiting for the device and nothing is signed", async () => {
    const wallet = await ready();
    await wallet.hardware.keystoneImport({ type: "crypto-multi-accounts", cborHex: "a0" });
    const [k] = await wallet.hardware.keystoneAccounts("evm", 0, 1);
    await wallet.hardware.addAccounts([k!.id]);
    render(<App wallet={wallet} />);
    await eventually(() => screen.getByTestId("total"));
    let id = "";
    await act(async () => void (id = await wallet.client.send({ assetKey: "eth", networkId: "eip155:11155111", to: "0x000000000000000000000000000000000000dEaD", amount: "0.1" })));
    await act(async () => wallet.events.emit({ type: "approval", id }));
    await press("approve");
    await press("hw-cancel");
    expect(await eventually(() => screen.getByText("Cancelled. Nothing was signed."))).toBeTruthy();
    expect(await wallet.client.getApproval(id)).not.toBeNull();
  });
});
