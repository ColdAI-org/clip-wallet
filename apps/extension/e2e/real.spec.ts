/**
 * Real wiring (default build): real vault, chain modules on testnets, 1Mask, route. No funds needed.
 */
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { extensionTest, expect, openPage, onboard, SHOTS, REAL_BUILD } from "./fixtures";

const test = extensionTest(REAL_BUILD);
const shotOf = (page: Page) => async (name: string) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function finishOnboarding(page: Page) {
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toHaveText(/\$\d/, { timeout: 30_000 });
}

test("real: onboarding → home on testnets, receive, settings, lock/unlock", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  const shot = shotOf(page);
  await expect(page.getByRole("heading", { name: "Clip Wallet" })).toBeVisible();
  await shot("onboarding-welcome");
  await onboard(page, { shots: shot });
  await shot("onboarding-passkey-offer");
  await finishOnboarding(page);
  // Fresh wallet: nothing held, no network names anywhere on Home.
  await expect(page.getByText(/Nothing here yet|Your assets/).first()).toBeVisible();
  await expect(page.getByText(/Sepolia|Testnet|Devnet/)).toHaveCount(0);
  await shot("home-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(400); // let colour transitions settle
  await shot("home-dark");
  await page.emulateMedia({ colorScheme: "light" });

  // Receive: asset first; the EVM address works on several testnets, so (and only so) networks are shown.
  await page.getByRole("button", { name: "Receive" }).click();
  await page.locator(".clip-asset-row", { hasText: /^E/ }).filter({ hasText: "Ether" }).first().click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^0x[0-9a-fA-F]{40}$/);
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await shot("receive");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Collectibles" }).click();
  await expect(page.getByText("No collectibles yet")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Connected apps" })).toBeVisible();
  await expect(page.getByText("Developer (mock data)")).toHaveCount(0);
  await shot("settings");
  await page.getByRole("switch", { name: "Advanced mode" }).click();
  await expect(page.getByRole("heading", { name: "Networks" })).toBeVisible();
  await expect(page.getByText("eip155:84532").first()).toBeVisible();
  await shot("settings-advanced");
  await page.getByRole("switch", { name: "Advanced mode" }).click();

  await page.getByRole("button", { name: "Lock now" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await shot("unlock");
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText("That password didn't work");
  await page.getByLabel("Password").fill("calm orange harbour 42");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
});

/** A dapp page served on an https origin so the 1Mask content scripts inject. */
async function openDapp(context: BrowserContext): Promise<Page> {
  await context.route("https://dapp.example/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Test dapp</title><h1>Test dapp</h1>" }),
  );
  const dapp = await context.newPage();
  await dapp.goto("https://dapp.example/");
  return dapp;
}

async function eip6963Request(dapp: Page, method: string, params?: unknown) {
  return dapp.evaluate(
    async ([m, p]) => {
      const providers: { info: { name: string; rdns: string }; provider: { request(a: unknown): Promise<unknown> } }[] = [];
      window.addEventListener("eip6963:announceProvider", (e) => providers.push((e as CustomEvent).detail));
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      await new Promise((r) => setTimeout(r, 200));
      const clip = providers.find((x) => x.info.rdns === "org.coldai.clipwallet");
      if (!clip) return { error: "no provider", names: providers.map((x) => x.info.name) };
      try {
        return { result: await clip.provider.request({ method: m, params: p }) };
      } catch (e) {
        return { error: String((e as Error).message), code: (e as { code?: number }).code };
      }
    },
    [method, params] as const,
  );
}

test("real: a dapp connects and signs through 1Mask (EIP-6963) with the real vault", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  await onboard(page);
  await finishOnboarding(page);

  const dapp = await openDapp(context);
  const windowOpened = context.waitForEvent("page", (p) => p.url().includes("/approval.html"));
  const connecting = eip6963Request(dapp, "eth_requestAccounts");
  const approval = await windowOpened;
  await approval.setViewportSize({ width: 360, height: 600 });
  await expect(approval.getByRole("heading", { name: "Connect to dapp.example?" })).toBeVisible();
  await expect(approval.getByRole("combobox")).toHaveCount(0);
  await shotOf(approval)("connect-approval");
  await approval.getByRole("button", { name: "Connect" }).click();
  const connected = await connecting;
  expect(connected).toMatchObject({ result: [expect.stringMatching(/^0x[0-9a-fA-F]{40}$/)] });
  const address = (connected as { result: string[] }).result[0]!;

  // personal_sign: decoded by chains-evm, approved, signed by the vault (approval-bound).
  const signWindow = context.waitForEvent("page", (p) => p.url().includes("/approval.html")).catch(() => approval);
  const signing = eip6963Request(dapp, "personal_sign", ["0x48656c6c6f20436c6970", address]);
  const w = await signWindow;
  await w.setViewportSize({ width: 360, height: 600 });
  await expect(w.locator(".clip-approval__title")).toBeVisible();
  await shotOf(w)("sign-approval");
  await w.getByRole("button", { name: "Approve" }).click();
  const signed = await signing;
  expect(signed).toMatchObject({ result: expect.stringMatching(/^0x[0-9a-f]{130}$/i) });

  // The site shows up under Connected apps and can be disconnected.
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("dapp.example").first()).toBeVisible();
  await page.getByRole("button", { name: /Disconnect/ }).first().click();
  await expect(page.getByText("No apps are connected.")).toBeVisible();
});

test("real: passkey unlock (WebAuthn PRF from the extension origin, virtual authenticator)", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "tab.html");
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  await onboard(page);
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Lock wallet" }).click();
  await expect(page.getByRole("button", { name: "Unlock with passkey" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "unlock-passkey.png") });
  await page.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(page.getByTestId("total")).toBeVisible({ timeout: 30_000 });
});
