/**
 * Settings → Linked devices in fixture mode (r1/connect): the screen, "Link your phone" showing a pairing QR (the
 * relay may be unreachable from CI; the QR shows before anyone connects), and the sync switch.
 */
import path from "node:path";
import { extensionTest, expect, openPage, onboard, SHOTS, FIXTURE_BUILD } from "./fixtures";

const test = extensionTest(FIXTURE_BUILD);

test("linked devices: phone pairing QR, Clip Desktop entry, sync switch", async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const page = await openPage(context, extensionId, "popup.html");
  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Linked devices" }).click();
  await expect(page.getByRole("heading", { name: "Linked devices" })).toBeVisible();
  await expect(page.getByText("No linked devices yet")).toBeVisible();
  await expect(page.getByTestId("signer-mode")).toHaveText("This browser signs with its own wallet.");
  await expect(page.getByRole("button", { name: "Use Clip Desktop" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Sync between your devices" })).toHaveAttribute("aria-checked", "false");
  await shot("r1-linked-devices");

  await page.getByRole("button", { name: "Link your phone" }).click();
  await expect(page.getByRole("heading", { name: "Link your phone" })).toBeVisible();
  await expect(page.getByTestId("pair-qr").getByRole("img", { name: "Pairing code" })).toBeVisible();
  await shot("r1-link-phone-qr");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Linked devices" })).toBeVisible();
});
