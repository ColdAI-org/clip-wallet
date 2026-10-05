/**
 * EIP-5792 wallet_sendCalls with ERC-7682 auxiliary funds, fixture mode (mock chains, mock Connector, real vault,
 * real 1Mask router). 12 USDC on Base Sepolia, 400 on Ethereum Sepolia; the app wants 25 on Base.
 *
 *  1. Dev simulator batch (two payments, 10 + 15): one approval lists both, the Connector brings in the shortfall,
 *     then both calls run in order and Activity shows one entry.
 *  2. A real page using Clip Connect: connect() finds Clip over EIP-6963, capabilities advertise auxiliaryFunds on
 *     Base Sepolia, pay() sends wallet_sendCalls with requiredAssets, the approval window funds and runs it, and
 *     the app follows wallet_getCallsStatus to "confirmed".
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { BrowserContext, Page } from "@playwright/test";
import { extensionTest, expect, openPage, onboard, SHOTS, FIXTURE_BUILD, REAL_BUILD } from "./fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const test = extensionTest(FIXTURE_BUILD);
const ORIGIN = "https://shop.example";
let bundle = "";

test.beforeAll(async () => {
  const out = await build({
    entryPoints: [path.join(here, "calls/dapp.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    conditions: ["development"],
    logLevel: "error",
  });
  bundle = out.outputFiles[0]!.text;
});

async function wallet(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await openPage(context, extensionId, "popup.html");
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toBeVisible({ timeout: 30_000 });
  return page;
}

async function approvalWindow(context: BrowserContext): Promise<Page> {
  const open = context.pages().find((p) => !p.isClosed() && p.url().includes("/approval.html"));
  const w = open ?? (await context.waitForEvent("page", { predicate: (p) => p.url().includes("/approval.html"), timeout: 30_000 }));
  await w.setViewportSize({ width: 360, height: 640 });
  return w;
}

test("sendCalls: one approval for a two-payment batch, funded by the Connector, then both calls run", async ({ context, extensionId }) => {
  const page = await wallet(context, extensionId);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "send-calls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 steps for magiceden.io" })).toBeVisible();
  await expect(page.locator(".clip-row", { hasText: "Step 1" })).toContainText("Pay 10 USDC");
  await expect(page.locator(".clip-row", { hasText: "Step 2" })).toContainText("Pay 15 USDC");
  await expect(page.getByTestId("batch-sequential")).toContainText("These steps run one after another");
  await expect(page.locator(".clip-row", { hasText: "From" })).toContainText("Your other balance, through Clip test Connector");
  await page.getByRole("button", { name: /Details/ }).click();
  const steps = page.locator(".clip-step");
  await expect(steps.nth(2)).toContainText("Clip test Connector sends you 13 USDC");
  await expect(page.locator(".clip-step--action")).toHaveCount(2);
  await page.screenshot({ path: path.join(SHOTS, "send-calls-offer.png") });

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("settle-progress")).toBeVisible();
  await expect(page.getByText("13 USDC arrived. Approve to finish.")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  // The batch is in Activity at once (in progress), then finished: one entry, a leg per call.
  const entry = page.locator(".clip-activity", { hasText: "2 steps on Magic Eden" });
  await expect(entry).toHaveCount(1);
  await expect(async () => {
    await page.getByRole("button", { name: "Home" }).click();
    await page.getByRole("button", { name: "Activity" }).click();
    await expect(entry).not.toContainText("In progress", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await entry.locator(".clip-activity__main").click();
  await expect(entry).toContainText("Pay 10 USDC");
  await expect(entry).toContainText("Pay 15 USDC");
  await page.screenshot({ path: path.join(SHOTS, "send-calls-activity.png") });
});

test("Clip Connect pay(): auxiliary funds through wallet_sendCalls from a real page", async ({ context, extensionId }) => {
  const popup = await wallet(context, extensionId);
  // Arm the mock Connector (it only quotes while the simulator says so), and leave that request unanswered.
  await popup.getByRole("button", { name: "Settings" }).click();
  await popup.getByRole("button", { name: "send-calls", exact: true }).click();
  await popup.getByRole("button", { name: "Reject" }).click();

  const dapp = await context.newPage();
  await dapp.route(`${ORIGIN}/**`, (r) =>
    r.request().url().endsWith("/dapp.js")
      ? r.fulfill({ contentType: "text/javascript", body: bundle })
      : r.fulfill({ contentType: "text/html", body: '<!doctype html><title>Shop</title><h1>Shop</h1><script src="/dapp.js"></script>' }),
  );
  await dapp.goto(`${ORIGIN}/`);
  await dapp.waitForFunction(() => !!(window as unknown as { __dapp?: unknown }).__dapp);
  const run = (s: string) => dapp.evaluate((x) => (window as unknown as { __dapp: { run(s: string): Promise<unknown> } }).__dapp.run(x), s);

  const connecting = run("connect");
  const connectWindow = await approvalWindow(context);
  await connectWindow.getByRole("button", { name: "Connect", exact: true }).click();
  expect(await connecting).toEqual({ wallet: "Clip Wallet", preferred: true, accounts: [expect.stringMatching(/^eip155:\d+$/)] });

  expect(await run("capabilities")).toEqual({
    "eip155:84532": { atomic: { status: "unsupported" }, auxiliaryFunds: { supported: true, assets: expect.arrayContaining(["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"]) } },
    "eip155:11155111": { atomic: { status: "unsupported" }, auxiliaryFunds: { supported: true, assets: expect.any(Array) } },
  });

  const paying = run("pay");
  const w = await approvalWindow(context);
  await expect(w.getByRole("heading", { name: "Pay 25 USDC" })).toBeVisible();
  await expect(w.locator(".clip-row", { hasText: "From" })).toContainText("Your other balance, through Clip test Connector");
  await w.screenshot({ path: path.join(SHOTS, "send-calls-dapp-offer.png") });
  await w.getByRole("button", { name: "Approve" }).click();
  await expect(w.getByText("13 USDC arrived. Approve to finish.")).toBeVisible({ timeout: 20_000 });
  await w.getByRole("button", { name: "Approve" }).click();
  expect(await paying).toEqual({ method: "wallet_sendCalls", auxiliaryFunds: true, fallback: null, id: true });
  expect(await run("wait")).toEqual({ status: "confirmed", txs: 1 });
});

/** Real wiring (testnets, no funds): the Wallet Call API is live on the shipped build, and a batch is one approval. */
extensionTest(REAL_BUILD)("real build: wallet_getCapabilities and a two-call wallet_sendCalls the user declines (4001)", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const dapp = await context.newPage();
  await dapp.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Shop</title>" }));
  await dapp.goto(`${ORIGIN}/`);
  const call = (method: string, params?: unknown) =>
    dapp.evaluate(
      async ([m, p]) => {
        const list: { info: { rdns: string }; provider: { request(a: unknown): Promise<unknown> } }[] = [];
        window.addEventListener("eip6963:announceProvider", (e) => list.push((e as CustomEvent).detail));
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        await new Promise((r) => setTimeout(r, 150));
        const clip = list.find((x) => x.info.rdns === "org.coldai.clipwallet")!;
        try {
          return { result: await clip.provider.request({ method: m, params: p }) };
        } catch (e) {
          return { code: (e as { code?: number }).code };
        }
      },
      [method, params] as const,
    );
  // Before connecting: 4100, like every account-revealing method.
  expect(await call("wallet_getCapabilities", ["0x0000000000000000000000000000000000000001"])).toEqual({ code: 4100 });
  const connecting = call("eth_requestAccounts");
  await (await approvalWindow(context)).getByRole("button", { name: "Connect", exact: true }).click();
  const me = ((await connecting) as { result: string[] }).result[0]!;
  const caps = (await call("wallet_getCapabilities", [me, ["0xaa36a7"]])) as { result: Record<string, unknown> };
  expect(caps.result["0xaa36a7"]).toMatchObject({ atomic: { status: "unsupported" } });

  const sending = call("wallet_sendCalls", [
    { version: "2.0.0", chainId: "0xaa36a7", from: me, atomicRequired: false, calls: [{ to: me, value: "0x0" }, { to: me, value: "0x0" }] },
  ]);
  const w = await approvalWindow(context);
  await expect(w.getByRole("heading", { name: /^2 steps for shop\.example$/ })).toBeVisible({ timeout: 45_000 });
  await expect(w.getByTestId("batch-sequential")).toBeVisible();
  await w.getByRole("button", { name: "Reject" }).click();
  expect(await sending).toEqual({ code: 4001 });
  expect(await call("wallet_sendCalls", [{ version: "2.0.0", chainId: "0xaa36a7", from: me, atomicRequired: true, calls: [{ to: me }] }])).toEqual({ code: 5760 });
});
