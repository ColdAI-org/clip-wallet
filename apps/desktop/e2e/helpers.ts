/** Shared e2e steps: launch the built app in a throwaway profile, find windows, onboard with the real vault. */
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SHOTS = join(ROOT, "screenshots");
export const PASSWORD = "calm orange harbour 42";

export function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({ args: ["."], cwd: ROOT, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0", ...env } as Record<string, string> });
}

export async function pageWhere(app: ElectronApplication, pred: (url: string) => boolean, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => pred(w.url()));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`no page matched; have: ${app.windows().map((w) => w.url()).join(", ")}`);
}

export const isApproval = (u: string) => u.startsWith("clip-app://wallet/approval/");
export const isWallet = (u: string) => u.startsWith("clip-app://wallet/wallet/");

/** Creates a wallet (testnets) through the real onboarding screens and lands on Home. */
export async function onboard(wallet: Page) {
  await expect(wallet.getByRole("heading", { name: "Clip Wallet" })).toBeVisible();
  await wallet.getByRole("button", { name: "Create a new wallet" }).click();
  await wallet.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await wallet.getByLabel("Type it again").fill(PASSWORD);
  await wallet.getByRole("button", { name: "Create wallet" }).click();
  await expect(wallet.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible({ timeout: 60_000 });
  await wallet.getByRole("button", { name: "Show my phrase" }).click();
  const words = await wallet.locator(".clip-phrase__w").allTextContents();
  expect(words.length).toBeGreaterThanOrEqual(12);
  await wallet.getByRole("checkbox", { name: "I wrote these words down" }).check();
  await wallet.getByRole("button", { name: "Continue" }).click();
  for (const label of await wallet.locator(".clip-field__label").allTextContents()) {
    const n = Number(label.replace("Word #", ""));
    await wallet.getByLabel(label, { exact: true }).fill(words[n - 1]!);
  }
  words.length = 0;
  await wallet.getByRole("button", { name: "Confirm" }).click();
  await expect(wallet.getByRole("heading", { name: "Unlock with Face ID or Touch ID?" })).toBeVisible();
  await wallet.getByRole("button", { name: "Not now" }).click();
  await wallet.getByRole("button", { name: "Open my wallet" }).click();
  await expect(wallet.getByTestId("total")).toHaveText(/\$\d/, { timeout: 60_000 });
}
