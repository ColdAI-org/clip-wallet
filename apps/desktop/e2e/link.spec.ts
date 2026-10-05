/**
 * Clip Desktop as the signer for the browser extension, over native messaging (r1/connect):
 *   Settings → Linked devices → Browser extension → "Set up again" registers the host for Chrome, Chromium, Edge,
 *   Brave and Firefox (in a throwaway home folder); a mock browser starts the registered host exactly as Chrome would,
 *   the extension's LinkService pairs with the app (same 6-digit code on both sides, confirmed on both), switches to
 *   "sign with Clip Desktop", and a site's connect and personal_sign arrive in the desktop approval window; the
 *   signature recovers to the desktop wallet's address. A second extension id that the build doesn't trust is refused.
 */
import { expect, test, type ElectronApplication } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverMessageAddress } from "viem";
import { SHOTS, isApproval, isWallet, launch, onboard, pageWhere } from "./helpers";
import { connectNative, startMockExtension, type MockExtension } from "./mock-extension";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const OTHER = "ponmlkjihgfedcbaponmlkjihgfedcba";
const RDNS = "org.coldai.clipwallet";
const os = process.platform as "darwin" | "linux" | "win32";

let app: ElectronApplication;
let dir: string;
let ext: MockExtension | undefined;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clip-desktop-link-"));
  app = await launch({
    CLIP_DESKTOP_USER_DATA: join(dir, "userData"),
    CLIP_DESKTOP_NM_HOME: join(dir, "home"),
    CLIP_DESKTOP_SOCKET: os === "win32" ? `\\\\.\\pipe\\clip-e2e-${process.pid}` : join(dir, "run", "desktop.sock"),
    CLIP_DESKTOP_EXTENSION_IDS: EXT,
  });
});

test.afterAll(async () => {
  ext?.close();
  await app?.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("native messaging: register the host, pair with the extension, sign for it in the approval window", async () => {
  const wallet = await pageWhere(app, isWallet);
  await wallet.setViewportSize({ width: 440, height: 760 }).catch(() => undefined);
  await onboard(wallet);

  /* ------------------------------------------------------------ Settings → Linked devices → Browser extension */
  await wallet.getByRole("button", { name: "Settings" }).click();
  await wallet.getByRole("button", { name: /Linked devices/ }).click();
  const connector = wallet.getByTestId("browser-connector");
  await expect(connector).toContainText("Not set up in any browser.");
  await connector.getByRole("button", { name: "Set up again" }).click();
  await expect(connector).toContainText("Set up for Chrome, Chromium, Edge, Brave, Firefox.");
  await connector.scrollIntoViewIfNeeded();
  await wallet.screenshot({ path: join(SHOTS, "linked-devices-connector.png") });

  /* ------------------------------------------------------------ an untrusted extension id gets nothing */
  expect(() => connectNative({ os, home: join(dir, "home"), rdns: RDNS, origin: `chrome-extension://${OTHER}/`, hosts: [] })).toThrow(/host not found/);

  /* ------------------------------------------------------------ pairing: same code on both screens */
  ext = startMockExtension({ os, home: join(dir, "home"), rdns: RDNS, extensionId: EXT });
  await ext.link.init();
  const run = await ext.link.desktopPair();
  await expect.poll(async () => (await ext!.link.status()).pairings.find((p) => p.id === run.id)?.state, { timeout: 30_000 }).toBe("compare");
  const sas = (await ext.link.status()).pairings.find((p) => p.id === run.id)!.sas!;
  expect(sas).toMatch(/^\d{6}$/);
  // The desktop brought its pairing screen forward by itself, showing the same code.
  await expect(wallet.getByText(`${sas.slice(0, 3)} ${sas.slice(3)}`)).toBeVisible({ timeout: 20_000 });
  await wallet.screenshot({ path: join(SHOTS, "linked-devices-pairing-code.png") });
  await wallet.getByRole("button", { name: "They match" }).click();
  await ext.link.confirm(run.id, true);
  await expect.poll(async () => (await ext!.link.status()).devices.length, { timeout: 30_000 }).toBe(1);
  const desktop = (await ext.link.status()).devices[0]!;
  expect(desktop.name).toMatch(/^Clip Desktop/);
  await expect(wallet.getByText(/Linked with Chrome on this computer/)).toBeVisible({ timeout: 20_000 });

  /* ------------------------------------------------------------ the extension signs with Clip Desktop */
  await ext.link.useSigner(desktop.id);
  const signer = ext.link.signer()!;
  const origin = "https://app.example";
  const connecting = signer.connectApp({ origin, family: "evm", networkId: "eip155:11155111", name: "Example app" });
  const approval = await pageWhere(app, isApproval);
  // The approval names the app and the linked device it came through.
  await expect(approval.getByRole("heading", { name: /Connect to Example app/ })).toBeVisible();
  await expect(approval.getByText(/via Chrome on this computer/).first()).toBeVisible();
  await approval.screenshot({ path: join(SHOTS, "approval-connect-for-extension.png") });
  await approval.getByRole("button", { name: "Connect" }).click();
  const connected = await connecting;
  expect(connected.approved).toBe(true);
  const address = connected.accounts[0]!.address;
  expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

  const message = "Signed in Clip Desktop for the extension";
  const signing = signer.request({
    id: "e2e-sign-1",
    origin,
    via: "injected",
    family: "evm",
    networkId: "eip155:11155111",
    method: "personal_sign",
    params: [`0x${Buffer.from(message).toString("hex")}`, address],
  });
  const signWin = await pageWhere(app, isApproval);
  await expect(signWin.locator(".clip-approval__title")).toBeVisible();
  await signWin.screenshot({ path: join(SHOTS, "approval-for-extension.png") });
  await signWin.getByRole("button", { name: "Approve" }).click();
  const signature = (await signing) as `0x${string}`;
  expect((await recoverMessageAddress({ message, signature })).toLowerCase()).toBe(address.toLowerCase());

  /* ------------------------------------------------------------ remove */
  await wallet.evaluate(() => (location.hash = "/settings/devices"));
  await expect(wallet.getByTestId("linked-device")).toHaveCount(1);
  await connector.getByRole("button", { name: "Remove from browsers" }).click();
  await expect(connector).toContainText("Not set up in any browser.");
  expect(() => connectNative({ os, home: join(dir, "home"), rdns: RDNS, origin: `chrome-extension://${EXT}/`, hosts: [] })).toThrow();
});
