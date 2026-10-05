/**
 * Picker matrix, part 2: real public testnet dapps, loaded by URL, against the REAL build with the dapp matrix's
 * wallet. Only dapps that need no account, no sign-up, no captcha and no terms beyond dismissing a banner with its
 * most privacy-preserving option. For each: find Clip in the dapp's own connect UI, connect, and where it is free and
 * reversible do one signed action (a message signature; never a transaction, never mainnet).
 *
 *   pnpm --filter @clip-wallet/extension pickers -- e2e/hosted-dapps.spec.ts [-g <id>]
 *
 * Live sites change: a failure here means "this dapp no longer works with Clip the way the doc says", which is what
 * this suite is for. Results: shots/pickers/hosted.json and docs/r1/picker-matrix.md. Screenshots: shots/pickers/.
 * The phrase is never logged or captured (trace/screenshot/video off; onboarding happens before any screenshot).
 */
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { signatureVerify } from "@polkadot/util-crypto";
import { matrixPhrase } from "./matrix/env";
import { answer } from "./matrix/wallet";
import { addressOf } from "./matrix/chain";
import { PHRASE_MISSING, PICKER_SHOTS, checkIcon, launchWithMatrixWallet, saveRow, type Row, type Walleted } from "./pickers/wallet-context";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "default", timeout: 300_000 });

const RESULTS = "hosted.json";
let w: Walleted | undefined;

test.beforeAll(async () => {
  if (!matrixPhrase()) return;
  w = await launchWithMatrixWallet();
});
test.afterAll(async () => {
  await w?.context.close();
  w = undefined;
});

const debugShot = async (page: Page, name: string) => {
  if (process.env.PICKER_DEBUG) await page.screenshot({ path: path.join(process.env.PICKER_DEBUG, `hosted-${name}.png`) }).catch(() => undefined);
};

/** The announced icon (same identity icon on every connector). */
const ICON_FROM = (page: Page) => page.evaluate(() => (window as unknown as { clipwallet?: { info?: { icon?: string } } }).clipwallet?.info?.icon ?? "");

interface Ctx {
  page: Page;
  row: Row;
  failures: string[];
  shot(name: string): Promise<void>;
  icon(img: Locator): Promise<void>;
}

/** Runs one hosted dapp: opens it, hands the page to `body`, saves the row; fails the test on recorded failures. */
function hosted(id: string, meta: { ecosystem: string; picker: string; url: string }, body: (c: Ctx) => Promise<void>) {
  test(`hosted: ${id}`, async () => {
    test.skip(!w, PHRASE_MISSING);
    const { context } = w!;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 860 });
    const row: Row = { id, ecosystem: meta.ecosystem, picker: meta.picker, kind: "hosted-dapp", url: meta.url, notes: [], detail: {}, shots: [], at: new Date().toISOString() };
    const failures: string[] = [];
    const c: Ctx = {
      page,
      row,
      failures,
      shot: async (name) => {
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(PICKER_SHOTS, `hosted-${name}.png`) });
        row.shots.push(`hosted-${name}.png`);
      },
      icon: async (img) => {
        const r = await checkIcon(context, img, await ICON_FROM(page));
        row.icon = r.ok ? "pass" : "fail";
        row.detail!.icon = r;
        if (!r.ok) failures.push(`icon: ${JSON.stringify(r)}`);
      },
    };
    try {
      await page.goto(meta.url, { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(4000); // live apps hydrate after load
      await body(c);
    } catch (e) {
      failures.push(String((e as Error).message).split("\n")[0]!);
      await debugShot(page, `${id}-error`);
      // What the wallet showed, if anything (an approval window never shows the phrase).
      for (const [i, p] of context.pages().filter((x) => x.url().startsWith("chrome-extension://")).entries()) await debugShot(p, `${id}-wallet-${i}`);
    }
    saveRow(RESULTS, row);
    await page.close();
    expect(failures, failures.join("\n")).toEqual([]);
  });
}

/** Waits until `f` returns a truthy value (or throws `what` after `ms`). */
async function until<T>(f: () => Promise<T | undefined | null | false>, what: string, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what} (after ${ms / 1000} s)`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Answers whichever approval the wallet shows first (a site may connect with Sign-In instead of a plain connect). */
async function approveFirst(buttons: string[], ms = 60_000): Promise<string> {
  const { context } = w!;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const b of buttons) if (await answer(context, b, 400).then(() => true, () => false)) return b;
  }
  throw new Error(`No approval window offered ${buttons.map((b) => `"${b}"`).join(" or ")}`);
}

const SIGN_TEXT = "Clip Wallet picker matrix: hosted dapp sign-in check (testnet)";

// ---------------------------------------------------------------------------------------------------------- Polkadot
hosted("polkadot-js", { ecosystem: "Polkadot (Westend)", picker: "polkadot.js apps", url: "https://polkadot.js.org/apps/?rpc=wss://westend-rpc.polkadot.io#/accounts" }, async ({ page, row, failures, shot }) => {
  const { context } = w!;
  // apps calls web3Enable on load: the wallet asks to connect this site.
  await answer(context, "Connect", 60_000);
  const account = page.getByText(/CLIP WALLET \(CLIP-WALLET\)/i).first();
  await account.waitFor({ timeout: 90_000 });
  row.listed = "pass";
  row.icon = "n/a";
  row.notes.push("apps lists injected accounts (name and source), not wallets: there is no wallet icon to show");
  await shot("polkadot-js-accounts");
  const metadataWarning = await page.getByText(/extension that needs to be updated/i).count();
  if (metadataWarning) row.notes.push("apps shows \"1 extension that needs to be updated with the latest chain properties\": Clip's metadata.provide() refuses dapp-supplied metadata by design (it reads metadata from the network)");

  // Developer → Sign and verify: sign a message with the Clip account; verify the signature in Node.
  // In-app navigation (a reload would reconnect and re-read every chain).
  await page.evaluate(() => (location.hash = "#/signing"));
  const data = page.locator('[data-testid="sign the following data"]');
  await data.waitFor({ timeout: 60_000 });
  // The account dropdown starts empty: open it and pick the Clip account.
  await page.locator('input[aria-autocomplete="list"]').first().click({ force: true });
  await page.waitForTimeout(1000);
  await debugShot(page, "polkadot-js-account-menu");
  await page.getByRole("option").filter({ hasText: /CLIP WALLET/i }).first().click({ timeout: 30_000 });
  await data.fill(SIGN_TEXT);
  await page.getByRole("button", { name: /Sign message/i }).click();
  await answer(context, "Approve", 60_000);
  // "signature of supplied data": 0x + the MultiSignature (type byte + 64 bytes) the extension returned.
  const sig = await until(async () => /0x[0-9a-f]{128,130}\b/i.exec(await page.locator("body").innerText())?.[0], "no signature shown", 60_000);
  const v = signatureVerify(SIGN_TEXT, sig, addressOf("substrate"));
  row.connects = "pass";
  row.reconnect = "n/a";
  row.reload = "n/a";
  row.signed = v.isValid ? "pass" : "fail";
  row.detail!.signature = { sig: `${sig.slice(0, 18)}…`, crypto: v.crypto, isWrapped: v.isWrapped, valid: v.isValid };
  if (!v.isValid) failures.push("signature didn't verify for the matrix account");
  await shot("polkadot-js-signed");
});

// ------------------------------------------------------------------------------------------------------------ Solana
hosted("solana-wallet-adapter-example", { ecosystem: "Solana (devnet)", picker: "Solana wallet-adapter example (anza-xyz.github.io)", url: "https://anza-xyz.github.io/wallet-adapter/example/" }, async ({ page, row, failures, shot, icon }) => {
  const { context } = w!;
  await page.getByRole("button", { name: "Select Wallet" }).last().click({ timeout: 30_000 });
  const entry = page.locator(".wallet-adapter-modal-list li button, [role=dialog] li", { hasText: "Clip Wallet" }).first();
  await entry.waitFor({ timeout: 20_000 });
  row.listed = "pass";
  await icon(entry.locator("img").first());
  await shot("solana-example-picker");
  await entry.click();
  // The example connects with Sign In With Solana (solana:signIn) when the wallet supports it, as Clip does: the
  // wallet asks to "Sign in to anza-xyz.github.io".
  const how = await approveFirst(["Connect", "Approve"]);
  row.notes.push(how === "Approve" ? "connect is Sign In With Solana (solana:signIn): approved in the wallet's sign-in window" : "plain connect");
  const short = `${addressOf("solana").slice(0, 4)}..${addressOf("solana").slice(-4)}`;
  await until(async () => (await page.locator("body").innerText()).includes(short), `the example doesn't show ${short}`);
  row.connects = "pass";
  row.detail!.account = short;
  // Sign Message: the example signs "Hello, world!" and checks the signature with ed25519 itself before notifying.
  await page.getByRole("button", { name: "Sign Message" }).first().click();
  await answer(context, "Approve", 60_000);
  const note = await until(async () => {
    const t = await page.locator("body").innerText();
    return /Message signature: \S+/.exec(t)?.[0] ?? (/Sign Message error[^\n]*/.exec(t)?.[0] ? `ERROR ${/Sign Message error[^\n]*/.exec(t)![0]}` : undefined);
  }, "no signature notification", 60_000);
  row.signed = note.startsWith("ERROR") ? "fail" : "pass";
  row.detail!.signature = note.slice(0, 40);
  if (row.signed === "fail") failures.push(note);
  await shot("solana-example-signed");
  row.reconnect = "n/a";
  row.reload = "n/a";
});

// ------------------------------------------------------------------------------------------------------------- Aptos
hosted("aptos-explorer", { ecosystem: "Aptos (testnet)", picker: "Aptos Explorer (explorer.aptoslabs.com, testnet)", url: "https://explorer.aptoslabs.com/?network=testnet" }, async ({ page, row, shot, icon }) => {
  const { context } = w!;
  await page.getByRole("button", { name: /connect wallet/i }).first().click({ timeout: 30_000 });
  const entry = page.locator("[role=dialog] *", { hasText: /^Clip Wallet$/ }).last().locator("xpath=ancestor::*[.//button][1]");
  await entry.waitFor({ timeout: 20_000 });
  row.listed = "pass";
  await icon(entry.locator("img").first());
  await shot("aptos-explorer-picker");
  await entry.getByRole("button", { name: /connect/i }).click();
  await approveFirst(["Connect", "Approve"]);
  const a = addressOf("aptos");
  await until(async () => (await page.locator("body").innerText()).toLowerCase().includes(a.slice(0, 6)), `the explorer doesn't show ${a.slice(0, 6)}…`);
  row.connects = "pass";
  row.signed = "n/a";
  row.notes.push("the explorer has no free signing action (its writes are transactions)");
  await shot("aptos-explorer-connected");
  row.reconnect = "n/a";
  row.reload = "n/a";
});

// --------------------------------------------------------------------------------------------------------------- Sui
hosted("suiscan", { ecosystem: "Sui (testnet)", picker: "Suiscan (suiscan.xyz/testnet)", url: "https://suiscan.xyz/testnet/home" }, async ({ page, row, shot, icon }) => {
  const { context } = w!;
  await page.getByText("Connect", { exact: true }).first().click({ timeout: 30_000 });
  const entry = page.locator("div, button, li").filter({ hasText: /^\s*Clip Wallet\s*$/ }).filter({ has: page.locator("img") }).last();
  await entry.waitFor({ timeout: 20_000 });
  row.listed = "pass";
  await icon(entry.locator("img").first());
  await shot("suiscan-picker");
  await entry.click();
  await approveFirst(["Connect", "Approve"]);
  const a = addressOf("sui");
  await until(async () => (await page.locator("body").innerText()).toLowerCase().includes(a.slice(0, 6)), `Suiscan doesn't show ${a.slice(0, 6)}…`);
  row.connects = "pass";
  row.signed = "n/a";
  row.notes.push("Suiscan has no free signing action");
  await shot("suiscan-connected");
  row.reconnect = "n/a";
  row.reload = "n/a";
});

// ------------------------------------------------------------------------------------------------------- Hedera EVM
hosted("hashscan", { ecosystem: "Hedera (testnet, EVM injected)", picker: "HashScan (hashscan.io/testnet)", url: "https://hashscan.io/testnet/" }, async ({ page, row, shot, icon }) => {
  const { context } = w!;
  // Cookie banner: the most privacy-preserving choice.
  await page.getByRole("button", { name: /^REJECT$/i }).click({ timeout: 20_000 }).catch(() => row.notes.push("no cookie banner"));
  await page.getByRole("button", { name: /connect wallet/i }).first().click({ timeout: 30_000 });
  // The tile's label wraps ("Clip / Wallet"): the innermost element with that text and an image.
  const entry = page.locator("div, button, label").filter({ hasText: /^\s*Clip\s*Wallet\s*$/ }).filter({ has: page.locator("img") }).last();
  await entry.waitFor({ timeout: 20_000 });
  row.listed = "pass";
  await icon(entry.locator("img").first());
  await shot("hashscan-picker");
  await entry.click();
  await page.getByRole("button", { name: /^CONNECT$/i }).last().click();
  // HashScan then asks to AGREE to a third-party-wallet disclaimer before it calls the wallet. That is a terms
  // acceptance the brief rules out, so the run stops here (Cancel) and records it.
  const disclaimer = page.getByText("Disclaimer", { exact: true });
  if (await disclaimer.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
    await shot("hashscan-disclaimer");
    await page.getByRole("button", { name: /^CANCEL$/i }).last().click();
    row.connects = "skip";
    row.signed = "n/a";
    row.notes.push("connect not attempted: after picking Clip, HashScan requires AGREE on a third-party-wallet disclaimer (a terms acceptance), so the run cancels there");
  } else {
    await approveFirst(["Connect", "Approve"]);
    await until(async () => /0\.0\.10872695|0x05ac/i.test(await page.locator("body").innerText()), "HashScan doesn't show the matrix EVM account (0.0.10872695)");
    row.connects = "pass";
    row.signed = "n/a";
    row.notes.push("HashScan's wallet actions are contract calls (transactions); none is free");
    await shot("hashscan-connected");
  }
  row.reconnect = "n/a";
  row.reload = "n/a";
});

// -------------------------------------------------------------------------------------------------------- EVM Sepolia
hosted("appkit-lab", { ecosystem: "EVM (Sepolia)", picker: "Reown AppKit Lab (lab.reown.com, wagmi)", url: "https://lab.reown.com/appkit/?name=wagmi" }, async ({ page, row, failures, shot, icon }) => {
  const { context } = w!;
  // Network first (the lab starts on Ethereum mainnet): pick Sepolia before connecting, and check it before signing.
  await page.locator("appkit-network-button").click({ timeout: 30_000 });
  await page.locator("wui-list-network, wui-list-item", { hasText: /^\s*Sepolia\s*$/ }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  const onSepolia = async () => (await page.locator("appkit-network-button").getByText("Sepolia", { exact: true }).count()) > 0;
  if (!(await onSepolia())) throw new Error("couldn't switch the lab to Sepolia; not connecting");
  await page.locator("appkit-button").first().click();
  const entry = page.locator("wui-list-wallet", { hasText: "Clip Wallet" }).first();
  await entry.waitFor({ timeout: 20_000 });
  row.listed = "pass";
  await icon(entry.locator("img").first());
  await shot("appkit-lab-picker");
  await entry.click();
  await approveFirst(["Connect", "Approve"]);
  const a = addressOf("evm").toLowerCase();
  await until(async () => (await page.content()).toLowerCase().includes(a), "the lab doesn't show the matrix account", 30_000);
  row.connects = "pass";
  await page.keyboard.press("Escape").catch(() => undefined);
  if (!(await onSepolia())) {
    failures.push("connected, but the lab isn't on Sepolia: not signing");
    return;
  }
  await page.getByRole("button", { name: /^Sign Message$/ }).first().click({ timeout: 20_000 });
  await answer(context, "Approve", 60_000);
  const toast = await until(async () => /Signing Succeeded|Signing Failed[^\n]*/i.exec(await page.locator("body").innerText())?.[0], "no signing result toast", 60_000);
  row.signed = /Succeeded/i.test(toast) ? "pass" : "fail";
  row.detail!.result = toast;
  if (row.signed === "fail") failures.push(toast);
  await shot("appkit-lab-signed");
  row.reconnect = "n/a";
  row.reload = "n/a";
});

// ------------------------------------------------------------------------------------------------------------- Tezos
hosted("tezos-faucet", { ecosystem: "Tezos (shadownet)", picker: "Tezos Shadownet Faucet (faucet.shadownet.teztnets.com), Beacon modal", url: "https://faucet.shadownet.teztnets.com/" }, async ({ page, row, failures, shot, icon }) => {
  const { context } = w!;
  // Only the wallet connect is used: the faucet's own request needs a captcha and is never touched.
  await page.getByRole("button", { name: /^Connect wallet$/i }).first().click({ timeout: 30_000 });
  await page.getByText("Show more", { exact: true }).click({ timeout: 20_000 });
  const entry = page.locator("div", { hasText: /^Clip Wallet$/ }).last();
  await entry.waitFor({ timeout: 20_000 });
  row.listed = "pass";
  await icon(entry.locator("xpath=..").locator("img").first());
  await shot("tezos-faucet-picker");
  await entry.click();
  const approved = await answer(context, "Connect", 15_000).then(() => true, () => false);
  row.connects = approved ? "pass" : "fail";
  if (approved) failures.push("picking Clip in Beacon's modal now connects: update docs/r1/picker-matrix.md");
  else row.notes.push("Beacon lists Clip but its tile does nothing usable for an unlisted Chromium extension (no \"Use Extension\"), as in part 1; the faucet's captcha-gated request was not used");
  row.signed = "n/a";
  row.reconnect = "n/a";
  row.reload = "n/a";
});

// ----------------------------------------------------------------------------------------------------------- Cardano
hosted("cardano-connect-demo", { ecosystem: "Cardano", picker: "Cardano Foundation cardano-connect-with-wallet storybook, Testnet Button story", url: "https://cardano-foundation.github.io/cardano-connect-with-wallet/react-storybook/iframe.html?id=components-connectwalletbutton--testnet-button&viewMode=story" }, async ({ page, row, shot }) => {
  await page.getByText(/Connect Wallet/i).first().click({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const listed = (await page.getByText(/clip ?wallet/i).count()) > 0;
  row.listed = listed ? "pass" : "expected-no";
  await shot("cardano-connect-demo-picker");
  if (!listed) row.notes.push("the demo uses the library's default supportedWallets (its wallet registry); Clip isn't in it (part 1 shows it works once listed)");
  row.connects = listed ? "fail" : "n/a";
  row.signed = "n/a";
  row.reconnect = "n/a";
  row.reload = "n/a";
});
