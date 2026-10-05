/**
 * Compatibility suite: real, unmodified dapp-side libraries against the built extension, with no Clip SDK anywhere.
 * Each scenario drives a library the way a production dapp does, answers the wallet's approval window, and
 * snapshots both what the library saw (step results) and what crossed 1Mask's wire (methods, result shapes, error
 * codes, events). The snapshot was recorded against the build before Clip Connect / EIP-5792 landed
 * (COMPAT_UPDATE=1 COMPAT_EXTENSION=<baseline build>), so a passing run means dapps that don't know Clip see no
 * difference. See docs/compat.md.
 *
 *   pnpm --filter @clip-wallet/extension exec playwright test e2e/compat.spec.ts
 *   COMPAT_EXTENSION=/path/to/other/chrome-mv3 …   run against another build
 *   COMPAT_UPDATE=1 …                              re-record (only for a deliberate, documented change)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { BrowserContext, Page } from "@playwright/test";
import { extensionTest, expect, openPage, onboard, REAL_BUILD } from "./fixtures";
import { WIRE_TAP, canonical, type WireTrace } from "./compat/wire";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = process.env.COMPAT_EXTENSION ? path.resolve(process.env.COMPAT_EXTENSION) : REAL_BUILD;
const UPDATE = process.env.COMPAT_UPDATE === "1";
const SNAP_FILE = path.join(here, "compat/snapshots/compat.json");
const OUT = path.join(here, "../.output-compat-dapps");
const ORIGIN = "https://compat-dapp.example";
const DAPPS = ["wagmi", "solana", "sui", "cardano", "polkadot", "appkit", "legacy"] as const;
type Dapp = (typeof DAPPS)[number];

const test = extensionTest(EXT);
test.describe.configure({ mode: "serial" });

const snapshots: Record<string, unknown> = existsSync(SNAP_FILE) ? JSON.parse(readFileSync(SNAP_FILE, "utf8")) : {};

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  await build({
    entryPoints: Object.fromEntries(DAPPS.map((d) => [d, path.join(here, `compat/dapps/${d}.ts`)])),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outdir: OUT,
    logLevel: "error",
    define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  });
});

test.afterAll(() => {
  if (UPDATE) {
    mkdirSync(path.dirname(SNAP_FILE), { recursive: true });
    writeFileSync(SNAP_FILE, `${JSON.stringify(snapshots, null, 2)}\n`);
  }
});

/** Serves the dapp on an https origin (1Mask injects there) and keeps the page off every other host. */
async function openDapp(context: BrowserContext, dapp: Dapp, opts: { otherWallet?: boolean } = {}): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(WIRE_TAP);
  if (opts.otherWallet) {
    // Another wallet that owns window.ethereum (as MetaMask would), installed before any page script.
    await page.addInitScript(`Object.defineProperty(window, "ethereum", { configurable: true, value: { isOther: true, request: async ({ method }) => method === "eth_chainId" ? "0x1" : null } });`);
  }
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/`) return route.fulfill({ contentType: "text/html", body: `<!doctype html><title>${dapp} compat dapp</title><h1>${dapp}</h1><script src="/${dapp}.js"></script>` });
    if (url === `${ORIGIN}/${dapp}.js`) return route.fulfill({ contentType: "text/javascript", body: readFileSync(path.join(OUT, `${dapp}.js`), "utf8") });
    return route.abort();
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => !!(window as unknown as { __compat?: unknown }).__compat, undefined, { timeout: 20_000 }).catch(() => {
    throw new Error(`${dapp} dapp didn't start: ${errors.join(" | ") || "no page error"}`);
  });
  return page;
}

const run = (page: Page, step: string) =>
  page.evaluate(async (s) => {
    try {
      return { ok: await (window as unknown as { __compat: { run(s: string): Promise<unknown> } }).__compat.run(s) };
    } catch (e) {
      return { threw: { name: (e as Error).name, code: (e as { code?: unknown }).code ?? null } };
    }
  }, step);

/** Answers the next approval window with `button` ("Connect", "Approve", "Reject"). */
async function answer(context: BrowserContext, button: string) {
  // The window of the previous request may still be closing: poll every open approval page until one shows `button`.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const w of context.pages().filter((p) => !p.isClosed() && p.url().includes("/approval.html"))) {
      try {
        const b = w.getByRole("button", { name: button, exact: true });
        if ((await b.count()) > 0 && (await b.isEnabled())) {
          await b.click({ timeout: 5_000 });
          return;
        }
      } catch {
        /* closed under us: look again */
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No approval window offered "${button}"`);
}

/** run(step) while answering the approval it raises. */
async function runApproved(context: BrowserContext, page: Page, step: string, button: string) {
  const pending = run(page, step);
  await answer(context, button);
  return pending;
}

async function wallet(context: BrowserContext, extensionId: string) {
  const page = await openPage(context, extensionId, "popup.html");
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toBeVisible({ timeout: 60_000 });
}

/** Compares (or records) a scenario: the library's step results plus the canonical wire trace. */
async function check(name: string, page: Page, steps: Record<string, unknown>) {
  // Let in-flight answers land (a library may still be waiting for eth_accounts when its own step resolves).
  await page
    .waitForFunction(() => (window as unknown as { __wire: WireTrace }).__wire.requests.every((r) => "result" in r || "error" in r), undefined, { timeout: 10_000 })
    .catch(() => undefined);
  const wire = canonical((await page.evaluate(() => (window as unknown as { __wire: WireTrace }).__wire)) as WireTrace);
  const got = { steps, wire };
  if (UPDATE) {
    snapshots[name] = got;
    return;
  }
  expect(snapshots[name], `no snapshot for ${name}: record one with COMPAT_UPDATE=1`).toBeDefined();
  expect(got).toEqual(snapshots[name]);
}

test("compat: wagmi/viem — EIP-6963 discovery, connect, signMessage, sendTransaction", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const page = await openDapp(context, "wagmi");
  const discover = await run(page, "discover");
  expect(discover).toMatchObject({ ok: { id: "org.coldai.clipwallet", name: "Clip Wallet" } });
  const connect = await runApproved(context, page, "connect", "Connect");
  expect(connect).toMatchObject({ ok: { accounts: 1 } });
  const sign = await runApproved(context, page, "sign", "Approve");
  expect(sign).toEqual({ ok: { valid: true } });
  // No testnet funds in CI: the user declines the transaction and wagmi must see EIP-1193 4001.
  const send = await runApproved(context, page, "send", "Reject");
  expect(send).toEqual({ ok: { error: "TransactionExecutionError", code: 4001 } });
  await check("wagmi", page, { discover, connect, sign, send });
});

test("compat: @solana/wallet-adapter — Wallet Standard detection, connect, signMessage", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const page = await openDapp(context, "solana");
  const detect = await run(page, "detect");
  expect(detect).toMatchObject({ ok: { name: "Clip Wallet" } });
  const connect = await runApproved(context, page, "connect", "Connect");
  expect(connect).toEqual({ ok: { connected: true, publicKey: "base58" } });
  const signMessage = await runApproved(context, page, "signMessage", "Approve");
  expect(signMessage).toEqual({ ok: { bytes: 64 } });
  await check("solana", page, { detect, connect, signMessage });
});

test("compat: Sui wallet-standard (dapp-kit detection) — detect and connect", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const page = await openDapp(context, "sui");
  const detect = await run(page, "detect");
  expect(detect).toMatchObject({ ok: { name: "Clip Wallet" } });
  const connect = await runApproved(context, page, "connect", "Connect");
  expect(connect).toMatchObject({ ok: { accounts: 1 } });
  await check("sui", page, { detect, connect });
});

test("compat: Cardano CIP-30 — detect, enable, getNetworkId", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const page = await openDapp(context, "cardano");
  const detect = await run(page, "detect");
  expect(detect).toMatchObject({ ok: { apiVersion: expect.any(String), enabled: false } });
  const enable = await runApproved(context, page, "enable", "Connect");
  expect(enable).toEqual({ ok: { networkId: 0, enabled: true } });
  await check("cardano", page, { detect, enable });
});

test("compat: polkadot extension-dapp — web3Enable, web3Accounts", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const page = await openDapp(context, "polkadot");
  const enable = await runApproved(context, page, "enable", "Connect");
  expect(enable).toMatchObject({ ok: { extensions: [{ name: "clip-wallet" }] } });
  const accounts = await run(page, "accounts");
  expect(accounts).toMatchObject({ ok: { accounts: [{ source: "clip-wallet" }] } });
  await check("polkadot", page, { enable, accounts });
});

test("compat: Reown AppKit lists Clip Wallet from EIP-6963 (no project id needed)", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const page = await openDapp(context, "appkit");
  const discover = await run(page, "discover");
  expect(discover).toMatchObject({ ok: { name: "Clip Wallet", rdns: "org.coldai.clipwallet" } });
  await check("appkit", page, { discover });
});

test("compat: plain window.ethereum dapp — with and without another wallet", async ({ context, extensionId }) => {
  await wallet(context, extensionId);
  const alone = await openDapp(context, "legacy");
  const probeAlone = await run(alone, "probe");
  const rdnsAlone = await run(alone, "announcements");
  expect(rdnsAlone).toEqual({ ok: { rdns: ["org.coldai.clipwallet"] } });
  await check("legacy-alone", alone, { probe: probeAlone, announcements: rdnsAlone });

  const shared = await openDapp(context, "legacy", { otherWallet: true });
  const probe = await run(shared, "probe");
  // Clip Wallet never takes over a window.ethereum another wallet set.
  expect(probe).toEqual({ ok: { ethereum: "other-wallet", chainId: "0x1" } });
  await check("legacy-other-wallet", shared, { probe, announcements: await run(shared, "announcements") });
});
