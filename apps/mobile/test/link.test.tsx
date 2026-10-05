/** Settings → Linked devices on the phone: devices, sync switch, the code to compare, moving a wallet. */
import { fireEvent, screen } from "@testing-library/react-native";
import { LinkPair, LinkedDevices } from "../src/screens/LinkedDevices";
import { eventually, renderWith, testWallet } from "./helpers";

const PW = "a long test password 42!";
const base = { platform: "mobile", sync: { available: true, enabled: false }, signer: { deviceId: null, online: false, waiting: [] }, handoffs: [], capabilities: { relay: true, desktop: false, sync: true } };

describe("Linked devices", () => {
  it("lists linked browsers, unlinks, and turns sync on", async () => {
    const wallet = testWallet({}, {
      link: { linkStatus: () => ({ ...base, devices: [{ id: "d1", name: "Chrome on Mac", platform: "extension", purpose: "signer", servesRequests: true, pairedAt: 1, online: true }], pairings: [] }) },
    });
    await wallet.client.createWallet(PW);
    renderWith(wallet, <LinkedDevices />);
    await eventually(() => screen.getByText("Chrome on Mac"));
    expect(screen.getByText("Connected")).toBeTruthy();
    fireEvent.press(screen.getByText("Unlink"));
    await eventually(() => wallet.linkCalls.find((c) => c.type === "linkDeviceRemove"));
    fireEvent.press(screen.getByTestId("link-sync"));
    await eventually(() => wallet.linkCalls.find((c) => c.type === "linkSyncSet" && c.enabled === true));
  });

  it("scanned code → the 6 digits to compare; 'They don't match' is sent", async () => {
    const wallet = testWallet({}, {
      link: {
        linkPairScan: () => ({ id: "p1", purpose: "signer", state: "connecting" }),
        linkStatus: () => ({ ...base, devices: [], pairings: [{ id: "p1", purpose: "signer", state: "compare", sas: "512048", peerName: "Chrome on Mac" }] }),
      },
    });
    await wallet.client.createWallet(PW);
    renderWith(wallet, <LinkPair uri="clipwallet://link?v=1" />);
    await eventually(() => screen.getByTestId("sas"));
    expect(screen.getByText("512 048")).toBeTruthy();
    expect(screen.getByText(/Only continue if Chrome on Mac shows exactly the same numbers/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("sas-mismatch"));
    await eventually(() => wallet.linkCalls.find((c) => c.type === "linkPairConfirm" && c.match === false));
  });

  it("moving the wallet from this phone asks for its password", async () => {
    const wallet = testWallet({}, {
      link: { linkStatus: () => ({ ...base, devices: [], pairings: [{ id: "p2", purpose: "device-add", state: "password", direction: "send", peerName: "New laptop" }] }) },
    });
    await wallet.client.createWallet(PW);
    renderWith(wallet, <LinkPair id="p2" />);
    await eventually(() => screen.getByText("Send your wallet to New laptop"));
    fireEvent.changeText(screen.getByTestId("transfer-password"), PW);
    fireEvent.press(screen.getByText("Send wallet"));
    await eventually(() => wallet.linkCalls.find((c) => c.type === "linkTransferSend" && c.password === PW));
  });
});
