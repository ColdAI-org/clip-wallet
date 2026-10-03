import path from "node:path";
import { extensionTest, expect, openPage, onboard, SHOTS, FIXTURE_BUILD } from "./fixtures";

/** Fixture mode: realistic balances, collectibles and dapp requests drive every screen. */
const test = extensionTest(FIXTURE_BUILD);

test("fixtures: every key screen with sample data", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };

  await expect(page.getByRole("heading", { name: "Clip Wallet" })).toBeVisible();
  await shot("fixtures-onboarding-welcome");
  await onboard(page, { shots: async () => undefined });
  await shot("fixtures-onboarding-passkey-offer");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();

  // Home: one total, USDC merged across networks into one row, no network names.
  await expect(page.getByTestId("total")).toHaveText(/\$/);
  const usdc = page.locator(".clip-asset-row").filter({ has: page.locator(".clip-asset-row__symbol", { hasText: /^USDC$/ }) });
  await expect(usdc).toHaveCount(1);
  await expect(usdc).toContainText("$412.00");
  await expect(page.getByText("Base Sepolia")).toHaveCount(0);
  await shot("fixtures-home-light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.waitForTimeout(400); // let colour transitions settle
  await shot("fixtures-home-dark");
  await page.emulateMedia({ colorScheme: "light" });

  await usdc.click();
  await expect(page.getByTestId("network-split")).toContainText("Ethereum Sepolia");
  await shot("asset-split");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Collectibles" }).click();
  await expect(page.getByRole("heading", { name: /Clip Founders/ })).toBeVisible();
  await expect(page.getByText("FREE MINT")).toHaveCount(0);
  await expect(page.locator("iframe, object, embed")).toHaveCount(0);
  await shot("collectibles");

  // Approval for a dapp payment (dev simulator).
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Connected apps" })).toBeVisible();
  await shot("fixtures-settings");
  await page.getByRole("button", { name: "pay", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pay 25 USDC" })).toBeVisible();
  await expect(page.locator(".clip-row", { hasText: "From" })).toContainText("Your balance");
  await expect(page.locator(".clip-row", { hasText: "Fee" })).toContainText("$0.04");
  await expect(page.locator(".clip-row", { hasText: "Ready" })).toContainText("in about 10 seconds");
  await shot("approval-collapsed");
  await page.getByRole("button", { name: /Details/ }).click();
  await expect(page.locator(".clip-step")).toHaveCount(3);
  await expect(page.locator(".clip-step").first()).toContainText("Move 13 USDC");
  await shot("approval-details");
  await page.getByRole("button", { name: "Approve" }).click();
  // Signed by the real vault (approval-bound), finalized by the mock chain module.
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("Paid Magic Eden 25 USDC").first()).toBeVisible();
  await shot("activity");

  // Blind request: blocked.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "blind", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unreadable request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await shot("approval-blind-blocked");
  await page.getByRole("button", { name: "Reject" }).click();

  // Send to an EVM address: several networks fit → ask once, in plain words.
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByLabel("To", { exact: true }).fill("0x1111111111111111111111111111111111111111");
  await page.getByLabel("Amount").fill("5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Where should the USDC arrive?" })).toBeVisible();
  await shot("send-ambiguous");
  await page.getByRole("radio", { name: /Ethereum Sepolia/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Send 5 USDC" })).toBeVisible();
  await page.getByRole("button", { name: "Reject" }).click();

  // Remembered: the second time there is no question.
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByLabel("To", { exact: true }).fill("0x1111111111111111111111111111111111111111");
  await page.getByLabel("Amount").fill("1");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: /^Send 1 / })).toBeVisible();
  await page.getByRole("button", { name: "Reject" }).click();

  // Receive: asset first, then address + QR.
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Receive" }).click();
  await page.locator(".clip-asset-row", { hasText: "HBAR" }).click();
  await expect(page.getByTestId("receive-address")).toHaveText("0.0.4815162");
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await shot("fixtures-receive");

  // Lock and unlock with the password.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Lock wallet" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await shot("fixtures-unlock");
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("alert")).toContainText("That password didn't work");
  await page.getByLabel("Password").fill("calm orange harbour 42");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("total")).toBeVisible();
});

test("fixtures: full-tab view", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "tab.html");
  await page.setViewportSize({ width: 1100, height: 760 });
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toBeVisible();
  await expect(page.locator(".clip-asset-row").first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "fixtures-tab-home.png") });
});
