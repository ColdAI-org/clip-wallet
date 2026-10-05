import path from "node:path";
import { extensionTest, expect, openPage, onboard, SHOTS, FIXTURE_BUILD } from "./fixtures";

/**
 * Settle on Hedera in fixture mode: a 25 USDC payment on Base Sepolia with 12 USDC there and 400 on Ethereum
 * Sepolia. A mock bonded Connector quotes; one Approve signs the exact-amount allowance and the deposit with the
 * real vault; the screen follows the order; then either the money arrives and the payment is approved, or the
 * Connector misses its deadline and the cover is claimed on Hedera with one tap.
 */
const test = extensionTest(FIXTURE_BUILD);

async function start(page: import("@playwright/test").Page, kind: "settle" | "settle-late") {
  await onboard(page, { shots: async () => undefined });
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: kind, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pay 25 USDC" })).toBeVisible();
}

test("settle: the Connector delivers, then the payment is approved", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await start(page, "settle");

  await expect(page.locator(".clip-row", { hasText: "From" })).toContainText("Your other balance, through Clip test Connector");
  await page.getByRole("button", { name: /Details/ }).click();
  const steps = page.locator(".clip-step");
  await expect(steps.nth(0)).toContainText("Allow exactly 13.052 USDC for this payment");
  await expect(steps.nth(1)).toContainText("Pay 13.052 USDC to Clip test Connector");
  await expect(steps.nth(2)).toContainText("Clip test Connector sends you 13 USDC");
  await expect(steps.nth(3)).toContainText("you're paid back 198 HBAR on Hedera");
  await shot("settle-offer");

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("settle-progress")).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiting for your money" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(page.getByText("Order confirmed. Clip test Connector is sending 13 USDC.")).toBeVisible();
  await shot("settle-progress");

  await expect(page.getByText("13 USDC arrived. Approve to finish.")).toBeVisible();
  await shot("settle-arrived");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("Paid Magic Eden 25 USDC").first()).toBeVisible();
});

test("settle: the Connector misses its deadline, the cover is claimed on Hedera", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await start(page, "settle-late");

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("settle-progress")).toBeVisible();
  const late = page.getByTestId("settle-late");
  await expect(late).toContainText("Your payment didn't arrive in time — you've been paid back 198 HBAR on Hedera");
  await shot("settle-late");
  await late.getByRole("button", { name: "Claim 198 HBAR" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("Paid back 198 HBAR on Hedera").first()).toBeVisible();
});
