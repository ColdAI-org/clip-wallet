/**
 * Loads the built extension (.output/chrome-mv3) into Chromium with --load-extension, headless
 * (Playwright's "chromium" channel supports extensions in new headless mode).
 */
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Real wiring (default build). */
export const REAL_BUILD = path.resolve(here, "../.output/chrome-mv3");
/** Fixture mode (CLIP_MOCKS=1 build): mock chains/1Mask/route + dev simulator. */
export const FIXTURE_BUILD = path.resolve(here, "../.output-fixtures/chrome-mv3");
export const SHOTS = path.resolve(here, "../screenshots");

export function extensionTest(extPath: string) {
  return base.extend<{ context: BrowserContext; extensionId: string }>({
    // eslint-disable-next-line no-empty-pattern
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        headless: true,
        viewport: { width: 360, height: 600 },
        args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
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
}

export const expect = base.expect;

/** Opens an extension page after closing the welcome tab the extension opens on install. */
export async function openPage(context: BrowserContext, extensionId: string, file: string, hash = ""): Promise<Page> {
  const isWelcome = (p: Page) => p.url().endsWith("/tab.html#/");
  const welcome = context.pages().find(isWelcome) ?? (await context.waitForEvent("page", { predicate: isWelcome, timeout: 5000 }).catch(() => undefined));
  await welcome?.close();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${file}${hash ? `#${hash}` : ""}`);
  await page.bringToFront();
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
    await page.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  words.length = 0;
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Unlock with Face ID or Touch ID?" })).toBeVisible();
  return password;
}
