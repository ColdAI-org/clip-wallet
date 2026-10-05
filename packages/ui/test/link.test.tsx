/** Settings → Linked devices: devices, signer mode, sync toggle, pairing with the code comparison, moving a wallet. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LinkClient, LinkStatusView, PairingView } from "../src/link/client";
import { LinkProvider } from "../src/link/context";
import { LinkedDevices, Pairing } from "../src/link/LinkedDevices";
import { linkRoute } from "../src/link/routes";
import { renderUi } from "./render";

function status(over: Partial<LinkStatusView> = {}): LinkStatusView {
  return {
    platform: "extension",
    devices: [{ id: "d1", name: "Pixel 9", platform: "mobile", purpose: "signer", servesRequests: false, pairedAt: 1, online: true }],
    sync: { available: true, enabled: false },
    signer: { deviceId: null, online: false, waiting: [] },
    pairings: [],
    handoffs: [],
    capabilities: { relay: true, desktop: true, sync: true },
    ...over,
  };
}

function fake(s: LinkStatusView): LinkClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  const pairing = (p: Partial<PairingView>): PairingView => ({ id: "p1", purpose: "signer", state: "waiting", uri: "clipwallet://link?v=1", ...p });
  const rec = <T,>(name: string, v: T) => vi.fn(async (a?: unknown) => (calls.push([name, a]), v));
  return {
    calls,
    status: vi.fn(async () => s),
    pairStart: rec("pairStart", pairing({})),
    pairScan: rec("pairScan", pairing({})),
    desktopPair: rec("desktopPair", pairing({ purpose: "desktop", state: "connecting", uri: undefined })),
    pairConfirm: rec("pairConfirm", pairing({ state: "confirming" })),
    pairCancel: rec("pairCancel", undefined),
    transferSend: rec("transferSend", pairing({ state: "done" })),
    transferReceive: rec("transferReceive", pairing({ state: "done" })),
    deviceRemove: rec("deviceRemove", undefined),
    useSigner: rec("useSigner", undefined),
    syncSet: rec("syncSet", undefined),
    syncNow: rec("syncNow", undefined),
    syncDelete: rec("syncDelete", undefined),
    handoffCreate: rec("handoffCreate", { link: "clipwallet://browse?url=https%3A%2F%2Fapp.example" }),
    handoffSend: rec("handoffSend", undefined),
    handoffOpen: rec("handoffOpen", { id: "h1", url: "https://app.example", origin: "https://app.example", verified: true, families: ["evm"], at: 1 }),
    handoffAccept: rec("handoffAccept", { url: "https://app.example" }),
    handoffDismiss: rec("handoffDismiss", undefined),
  };
}

describe("Linked devices", () => {
  it("lists devices, switches signing to the phone, and turns sync on", async () => {
    const c = fake(status());
    renderUi(<LinkProvider client={c}><LinkedDevices /></LinkProvider>);
    expect(await screen.findByRole("heading", { name: "Linked devices" })).toBeInTheDocument();
    expect(screen.getByTestId("signer-mode")).toHaveTextContent("This browser signs with its own wallet.");
    expect(screen.getByText("Pixel 9")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use for signing" }));
    expect(c.calls).toContainEqual(["useSigner", { deviceId: "d1" }]);
    await userEvent.click(screen.getByRole("switch", { name: "Sync between your devices" }));
    expect(c.calls).toContainEqual(["syncSet", { enabled: true }]);
    expect(screen.getByRole("button", { name: "Link your phone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Clip Desktop" })).toBeInTheDocument();
  });

  it("Clip Desktop: a phone can be its signer, and the browser-extension connector can be repaired or removed", async () => {
    const c = fake(status({ platform: "desktop" }));
    const view = (installed: boolean) => ({ available: true, browsers: [{ browser: "chrome" as const, installed }, { browser: "firefox" as const, installed }] });
    let installed = false;
    c.browserConnector = {
      status: vi.fn(async () => view(installed)),
      repair: vi.fn(async () => view((installed = true))),
      remove: vi.fn(async () => view((installed = false))),
    };
    renderUi(<LinkProvider client={c}><LinkedDevices /></LinkProvider>);
    expect(await screen.findByRole("button", { name: "Use for signing" })).toBeInTheDocument();
    const section = await screen.findByTestId("browser-connector");
    expect(section).toHaveTextContent("Not set up in any browser.");
    await userEvent.click(screen.getByRole("button", { name: "Set up again" }));
    expect(await screen.findByText("Set up for Chrome, Firefox.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove from browsers" }));
    expect(await screen.findByText("Not set up in any browser.")).toBeInTheDocument();
  });

  it("while the phone signs, shows what it's waiting for", async () => {
    const c = fake(status({ signer: { deviceId: "d1", deviceName: "Pixel 9", online: true, waiting: [{ id: "r1", origin: "https://app.example", kind: "request", title: "Send 10 USDC to 0x12…ab", since: 1 }] } }));
    renderUi(<LinkProvider client={c}><LinkedDevices /></LinkProvider>);
    expect(await screen.findByText("Waiting for approval on Pixel 9")).toBeInTheDocument();
    expect(screen.getByText("Send 10 USDC to 0x12…ab")).toBeInTheDocument();
    expect(screen.getByTestId("signer-mode")).toHaveTextContent("App requests go to Pixel 9 for approval.");
  });

  it("pairing: QR first, then the code to compare; 'They don't match' tells the background", async () => {
    const s = status({ pairings: [{ id: "p1", purpose: "signer", state: "waiting", uri: "clipwallet://link?v=1&c=x" }] });
    const c = fake(s);
    c.status = vi.fn(async () => ({ ...s }));
    renderUi(<LinkProvider client={c}><Pairing id="p1" /></LinkProvider>);
    expect(await screen.findByTestId("pair-qr")).toBeInTheDocument();
    s.pairings = [{ id: "p1", purpose: "signer", state: "compare", sas: "042917", peerName: "Pixel 9" }];
    expect(await screen.findByTestId("sas", {}, { timeout: 3000 })).toHaveTextContent("042 917");
    expect(screen.getByText(/Only continue if Pixel 9 shows exactly the same numbers/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "They don't match" }));
    expect(c.calls).toContainEqual(["pairConfirm", { id: "p1", match: false }]);
  });

  it("moving a wallet asks the source for its password", async () => {
    const c = fake(status({ pairings: [{ id: "p1", purpose: "device-add", state: "password", direction: "send", peerName: "New laptop" }] }));
    renderUi(<LinkProvider client={c}><Pairing id="p1" /></LinkProvider>);
    expect(await screen.findByRole("heading", { name: "Send your wallet to New laptop" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Send wallet" }));
    await waitFor(() => expect(c.calls).toContainEqual(["transferSend", { id: "p1", password: "correct horse" }]));
  });

  it("routes", () => {
    expect(linkRoute(["settings", "devices"])).not.toBeNull();
    expect(linkRoute(["settings", "devices", "pair", "p1"])).not.toBeNull();
    expect(linkRoute(["settings", "security"])).toBeNull();
  });
});
