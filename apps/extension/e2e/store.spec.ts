/**
 * Store screenshots (Chrome Web Store / Edge / AMO): the e2e fixture flows captured at 2x, framed at 1280x800
 * with one plain caption each. Only runs with STORE_SHOTS=1 (`pnpm --filter @clip-wallet/extension store:shots`):
 * the normal e2e run already covers these flows.
 *
 * Chrome Web Store: 1280x800 or 640x400, at least 1, at most 5 (https://developer.chrome.com/docs/webstore/images).
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_BUILD, onboard } from "./fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const OUT = path.resolve(here, "../store/screenshots");
const RAW = path.resolve(here, "../store/screenshots/raw");

test.skip(process.env.STORE_SHOTS !== "1", "store screenshots: set STORE_SHOTS=1");

/** Caption, sub-line, raw capture. Order is the listing order. */
const SHOTS = [
  { file: "01-home", title: "One balance. No network maze.", line: "Your assets, merged across every CLPR network. USDC is one USDC." },
  { file: "02-approval", title: "Know what you sign.", line: "Every request decoded into plain words, with the fee and what changes." },
  { file: "03-send", title: "Asked once, only when it matters.", line: "The network shows up only where a mistake could lose money." },
  { file: "04-swap", title: "Swap, stake and buy in one place.", line: "Every action ends in the same clear approval." },
  { file: "05-security", title: "Scam checks before you sign.", line: "Open scam lists checked on your device. App permissions you can take back." },
] as const;

async function launch(): Promise<{ context: BrowserContext; id: string }> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 360, height: 600 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${FIXTURE_BUILD}`, `--load-extension=${FIXTURE_BUILD}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  return { context, id: new URL(sw.url()).host };
}

async function open(context: BrowserContext, id: string): Promise<Page> {
  const welcome = await context.waitForEvent("page", { predicate: (p) => p.url().endsWith("/tab.html#/"), timeout: 5000 }).catch(() => undefined);
  await welcome?.close();
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  return page;
}

const settle = (page: Page) => expect(page.locator(".clip-spinner")).toHaveCount(0, { timeout: 45_000 });

test("store screenshots", async () => {
  test.setTimeout(240_000);
  mkdirSync(RAW, { recursive: true });
  const { context, id } = await launch();
  const page = await open(context, id);
  const raw = async (name: string) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(RAW, `${name}.png`) });
  };

  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toHaveText(/\$/);
  await settle(page);
  await raw("01-home");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "pay", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pay 25 USDC" })).toBeVisible();
  // The fixture dapp borrows a real marketplace's name; a store listing must not suggest an endorsement, so the
  // marketing capture shows a neutral example shop instead (text only, the screen is otherwise untouched).
  await page.evaluate(() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      n.nodeValue = n.nodeValue!.replace(/Magic Eden/g, "Example Shop").replace(/magiceden\.io/g, "shop.example").replace(/^M$/, "E");
    }
  });
  await raw("02-approval");
  await page.getByRole("button", { name: "Reject" }).click();

  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByLabel("To", { exact: true }).fill("0x1111111111111111111111111111111111111111");
  await page.getByLabel("Amount").fill("5");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Where should the USDC arrive?" })).toBeVisible();
  await page.getByRole("radio", { name: /Ethereum Sepolia/ }).check();
  await raw("03-send");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Reject" }).click();

  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: /Swap/ }).first().click();
  await page.getByLabel("Amount").fill("10");
  await page.getByRole("button", { name: "Get price" }).click();
  await expect(page.getByText(/You get ~/)).toBeVisible();
  await raw("04-swap");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("button", { name: "Scam protection" }).click();
  await settle(page);
  await raw("05-security");
  await context.close();

  // Frame each capture at 1280x800: brand field on the left, the popup at its real proportions on the right.
  const browser = await chromium.launch();
  const frame = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const inter = readFileSync(require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).toString("base64");
  const mark = readFileSync(path.resolve(here, "../../../brand/clip-glyph-white.svg")).toString("base64");
  for (const s of SHOTS) {
    const png = readFileSync(path.join(RAW, `${s.file}.png`)).toString("base64");
    await frame.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format("woff2"); font-weight: 100 900; }
      html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: Inter, sans-serif; }
      .field { position: absolute; inset: 0; background: #FF3C00; }
      .copy { position: absolute; left: 96px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; gap: 22px; color: #fff; }
      .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 26px; letter-spacing: -0.02em; }
      h1 { margin: 0; font-size: 54px; line-height: 1.05; letter-spacing: -0.03em; font-weight: 750; }
      p { margin: 0; font-size: 24px; line-height: 1.35; font-weight: 500; }
      .shot { position: absolute; right: 120px; top: 50%; transform: translateY(-50%); width: 396px; height: 660px; border-radius: 22px; overflow: hidden;
              box-shadow: 0 24px 64px rgba(80, 20, 0, .35), 0 0 0 1px rgba(0,0,0,.06); background: #fff; }
      .shot img { width: 396px; height: 660px; display: block; }
    </style></head><body><div class="field"></div>
      <div class="copy"><div class="brand"><img src="data:image/svg+xml;base64,${mark}" width="44" height="44">Clip Wallet</div>
      <h1>${s.title}</h1><p>${s.line}</p></div>
      <div class="shot"><img src="data:image/png;base64,${png}"></div></body></html>`);
    await frame.evaluate(() => document.fonts.ready);
    await frame.screenshot({ path: path.join(OUT, `${s.file}.png`) });
  }
  await browser.close();
});
