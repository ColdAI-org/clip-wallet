/**
 * Phase 2.5 screens in fixture mode: Settings → Security (permissions), contacts, notification settings, Discover,
 * Plugins (Advanced mode) and the whole wallet in Arabic (RTL) from the language picker. Live sources (scam lists,
 * explorers, CoinGecko / DEX Screener) may be unreachable from CI: each screen must still say so plainly.
 */
import path from "node:path";
import type { Page } from "@playwright/test";
import { extensionTest, expect, openPage, onboard, SHOTS, FIXTURE_BUILD } from "./fixtures";

const test = extensionTest(FIXTURE_BUILD);

async function go(page: Page, route: string) {
  await page.evaluate((r) => (location.hash = r), route);
}
const noSpinner = (page: Page) => expect(page.locator(".clip-spinner")).toHaveCount(0, { timeout: 45_000 });

test("phase 2.5: security, contacts, notifications, Discover, plugins, Arabic", async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const page = await openPage(context, extensionId, "popup.html");
  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toBeVisible();

  // Settings → Security → App permissions.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scam protection" })).toBeVisible();
  await page.getByRole("button", { name: "App permissions" }).click();
  await expect(page.getByRole("heading", { name: "App permissions" })).toBeVisible();
  await noSpinner(page);
  await shot("phase25-security-permissions");

  // Contacts.
  await go(page, "/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await noSpinner(page);
  await shot("phase25-contacts");

  // Notification settings.
  await go(page, "/settings/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await noSpinner(page);
  await shot("phase25-notifications");

  // Discover (top of Explore).
  await go(page, "/explore");
  await expect(page.getByRole("heading", { name: "Discover" })).toBeVisible();
  await noSpinner(page);
  await shot("phase25-discover");

  // Plugins: only in Advanced mode, off by default.
  await go(page, "/settings");
  await page.getByRole("switch", { name: "Advanced mode" }).click();
  await expect(page.getByRole("switch", { name: "Advanced mode" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Use plugins" })).toHaveAttribute("aria-checked", "false");
  await shot("phase25-plugins");

  // Language picker → Arabic: translated, right-to-left.
  await go(page, "/settings");
  await page.getByLabel("Language").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();
  await page.waitForTimeout(300);
  await shot("phase25-settings-arabic");
  await go(page, "/settings/security");
  await expect(page.getByRole("button", { name: /أذونات/ })).toBeVisible();
  await shot("phase25-security-arabic");
});
