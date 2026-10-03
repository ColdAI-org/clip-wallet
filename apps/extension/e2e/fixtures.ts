/**
 * Loads the built extension (.output/chrome-mv3) into Chromium with --load-extension, headless
 * (Playwright's "chromium" channel supports extensions in new headless mode).
 */
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXT_PATH = path.resolve(here, "../.output/chrome-mv3");
export const SHOTS = path.resolve(here, "../screenshots");

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      viewport: { width: 360, height: 600 },
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

/** Opens an extension page, closing the onboarding tab the extension opens on install. */
export async function openPage(context: BrowserContext, extensionId: string, file: string, hash = ""): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${file}${hash ? `#${hash}` : ""}`);
  for (const p of context.pages()) if (p !== page && p.url().includes("/tab.html")) await p.close();
  return page;
}

/**
 * Creates a wallet through the real onboarding UI. The phrase is read from the page only to answer the
 * 3-word check; it is never printed, logged or screenshotted (it is a throwaway testnet wallet).
 */
export async function onboard(page: Page, opts: { shots?: (name: string) => Promise<void>; password?: string } = {}) {
  const password = opts.password ?? "calm orange harbour 42";
  await page.getByRole("button", { name: "Create a new wallet" }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Type it again").fill(password);
  await opts.shots?.("onboarding-password");
  await page.getByRole("button", { name: "Create wallet" }).click();
  await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible({ timeout: 30_000 });
  await opts.shots?.("onboarding-phrase-hidden");
  await page.getByRole("button", { name: "Show my phrase" }).click();
  const words = await page.locator(".clip-phrase__w").allTextContents();
  await page.getByRole("checkbox", { name: "I wrote these words down" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  for (const label of await page.locator(".clip-field__label").allTextContents()) {
    const n = Number(label.replace("Word #", ""));
    await page.getByLabel(label).fill(words[n - 1]!);
  }
  words.length = 0;
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Unlock with Face ID or Touch ID?" })).toBeVisible();
  return password;
}
