/**
 * README media: screenshots (light and dark) and frame recordings of key flows, on the REAL build with the dapp
 * matrix's testnet wallet (fresh throwaway wallets for onboarding), plus the fixture build for Collectibles.
 *
 *   pnpm --filter @clip-wallet/extension media      (README_MEDIA=1; writes MEDIA_OUT, default .media/)
 *   node ../../tools/media/build.mjs                 turns the output into docs/media (WebP stills, GIFs)
 *
 * Privacy: trace, video and failure screenshots are off for the whole file, because the matrix phrase is typed into
 * the import screen. Nothing is captured until the import screen is gone. Recordings are back-to-back screenshots that
 * stop (and drop any capture still in flight) before "Show my phrase" is pressed; they resume only once the phrase
 * check is done and its screens are gone.
 * tools/media/build.mjs OCRs every frame it keeps and refuses one that reads like a recovery phrase.
 */
import { chromium, test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_BUILD, REAL_BUILD, importWallet } from "./fixtures";
import { matrixPhrase } from "./matrix/env";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

const OUT = path.resolve(process.env.MEDIA_OUT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../.media"));
const STILLS = path.join(OUT, "stills");
const REC = path.join(OUT, "rec");
const PASSWORD = "calm orange harbour 42";
const SELF_EVM = "0x05ACD02A8E18c130D902FB732bb6AD22DA4f2717"; // the matrix wallet's own public testnet address
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SPENDER = "0x1111111254EEB25477B68fb85Ed929f73A960582";
/** The approval window's page size (background/main.ts opens a 376×640 popup); long requests scroll to their buttons. */
const APPROVAL = { width: 360, height: 600 };
mkdirSync(STILLS, { recursive: true });
mkdirSync(REC, { recursive: true });

/* ------------------------------------------------------------------ browser and pages */

async function launch(ext: string, scale = 2): Promise<{ context: BrowserContext; id: string }> {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 360, height: 600 },
    deviceScaleFactor: scale,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  await context.waitForEvent("page", { predicate: (p) => p.url().endsWith("/tab.html#/"), timeout: 5000 }).catch(() => undefined);
  for (const p of context.pages()) await p.close().catch(() => undefined);
  return { context, id };
}

async function popup(context: BrowserContext, id: string, route = ""): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html#/${route}`);
  return page;
}

/** Both themes of whatever is on screen. */
async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(STILLS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function importMatrixWallet(page: Page) {
  const phrase = matrixPhrase();
  test.skip(!phrase, "No DAPP_MATRIX_MNEMONIC: create .env.dapp-matrix (see docs/r1/dapp-matrix.md).");
  await importWallet(page, phrase!, { password: PASSWORD });
}

async function balancesLoaded(page: Page) {
  // Every family reports in; wait until the list stops growing.
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const n = await page.locator(".clip-asset-row").count();
    if (n === last && n >= 8) break;
    last = n;
    await page.waitForTimeout(2000);
  }
}

/* ------------------------------------------------------------------ the demo dapp (served on an https origin) */

const DAPP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Harbor (testnet demo)</title>
<style>
  :root { color-scheme: light; font: 15px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  body { margin: 0; background: #F4F6FB; color: #0F172A; }
  header { display: flex; align-items: center; gap: 10px; padding: 16px 22px; background: #fff; border-bottom: 1px solid #E5E7EB; }
  .logo { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg,#2563EB,#7C3AED); }
  header b { font-size: 16px; } header span { margin-left: auto; font-size: 12px; color: #64748B; background: #EEF2FF; padding: 3px 8px; border-radius: 99px; }
  main { padding: 26px 22px; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
  p { margin: 0 0 18px; color: #475569; }
  .card { background: #fff; border: 1px solid #E5E7EB; border-radius: 16px; padding: 18px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 12px; padding: 12px 16px; cursor: pointer; background: #2563EB; color: #fff; width: 100%; margin-top: 10px; }
  button.secondary { background: #EEF2FF; color: #1E3A8A; }
  #status { margin-top: 14px; font-size: 13px; color: #334155; word-break: break-all; min-height: 40px; }
  .ok { color: #15803D; font-weight: 600; }
</style></head><body>
<header><div class="logo"></div><b>Harbor</b><span>Sepolia testnet · demo</span></header>
<main>
  <h1>Earn on your ETH</h1>
  <p>A demo page served by the media script. It finds wallets through EIP-6963, like any dapp.</p>
  <div class="card">
    <button id="connect">Connect wallet</button>
    <button id="signin" class="secondary">Sign in with Ethereum</button>
    <div id="status">Not connected.</div>
  </div>
</main>
<script>
  let wallet; let account;
  window.addEventListener("eip6963:announceProvider", (e) => { if (e.detail.info.rdns === "org.coldai.clipwallet") wallet = e.detail; });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const status = (html) => (document.getElementById("status").innerHTML = html);
  window.clipDemo = {
    connect: async () => {
      [account] = await wallet.provider.request({ method: "eth_requestAccounts" });
      status('<span class="ok">Connected</span> with ' + wallet.info.name + ': ' + account.slice(0, 6) + '…' + account.slice(-4));
      return account;
    },
    signIn: async () => {
      const msg = "harbor.example wants you to sign in with your Ethereum account:\\n" + account + "\\n\\nSign in to Harbor (testnet demo).\\n\\nURI: https://harbor.example\\nVersion: 1\\nChain ID: 11155111\\nNonce: 8f2c41d0\\nIssued At: 2026-10-06T12:00:00Z";
      const sig = await wallet.provider.request({ method: "personal_sign", params: ["0x" + Array.from(new TextEncoder().encode(msg), (b) => b.toString(16).padStart(2, "0")).join(""), account] });
      status('<span class="ok">Signed in.</span> Signature ' + sig.slice(0, 18) + '…');
      return sig;
    },
    request: (method, params) => wallet.provider.request({ method, params }),
  };
  document.getElementById("connect").onclick = () => window.clipDemo.connect();
  document.getElementById("signin").onclick = () => window.clipDemo.signIn();
</script></body></html>`;

async function openDapp(context: BrowserContext, size = { width: 480, height: APPROVAL.height }): Promise<Page> {
  await context.route("https://harbor.example/**", (route) => route.fulfill({ contentType: "text/html", body: DAPP_HTML }));
  const dapp = await context.newPage();
  await dapp.setViewportSize(size);
  await dapp.goto("https://harbor.example/");
  await dapp.waitForFunction(() => (window as unknown as { clipDemo?: unknown }).clipDemo);
  await dapp.waitForTimeout(400);
  return dapp;
}

const nextApproval = (context: BrowserContext) => context.waitForEvent("page", { predicate: (p) => p.url().includes("/approval.html"), timeout: 30_000 });

/* ------------------------------------------------------------------ recording: screenshots with a privacy gate */

class Recorder {
  private on = false;
  private n = 0;
  private loop?: Promise<void>;
  readonly frames: { t: number; file: string }[] = [];
  readonly cuts: number[] = [];
  closedAt?: number;
  constructor(
    private page: Page,
    private dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
    page.on("close", () => {
      this.closedAt ??= Date.now();
      this.on = false;
    });
  }
  /** Device-scale screenshots back to back (CDP screencast only delivers CSS-pixel frames). */
  private async capture() {
    while (this.on) {
      const t = Date.now();
      const buf = await this.page.screenshot({ type: "png" }).catch(() => undefined);
      if (!this.on || !buf) break; // paused (or closed) while this one was taken: never written
      const file = path.join(this.dir, `${String(this.n++).padStart(5, "0")}.png`);
      writeFileSync(file, buf);
      this.frames.push({ t, file });
    }
  }
  async start() {
    await this.resume();
  }
  /** Stops capture before anything sensitive appears; returns only once no capture is in flight. */
  async pause() {
    this.on = false;
    this.cuts.push(Date.now());
    await this.loop;
  }
  async resume() {
    this.on = true;
    this.loop = this.capture();
  }
  async stop() {
    this.on = false;
    await this.loop;
    this.closedAt ??= Date.now();
    writeFileSync(path.join(this.dir, "frames.json"), JSON.stringify({ frames: this.frames, cuts: this.cuts, closedAt: this.closedAt }, null, 2));
  }
}

/** A visible pointer for recordings (screenshots have no cursor): glide to the target, pulse, then click. */
async function tap(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.evaluate(
      ([x, y]) => {
        let c = document.getElementById("__media_cursor");
        if (!c) {
          c = document.createElement("div");
          c.id = "__media_cursor";
          c.style.cssText =
            "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(20,20,20,.28);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .45s cubic-bezier(.2,.7,.2,1);transform:translate(180px,560px)";
          document.documentElement.appendChild(c);
        }
        c.style.transform = `translate(${x}px,${y}px)`;
      },
      [box.x + box.width / 2, box.y + box.height / 2] as const,
    );
    await page.waitForTimeout(550);
    await page.evaluate(() => {
      const c = document.getElementById("__media_cursor");
      c?.animate([{ boxShadow: "0 0 0 0 rgba(255,60,0,.55)" }, { boxShadow: "0 0 0 16px rgba(255,60,0,0)" }], { duration: 420 });
    });
    await page.waitForTimeout(120);
  }
  await target.click();
}

async function typeSlowly(target: Locator, text: string, delay = 45) {
  await target.click();
  await target.pressSequentially(text, { delay });
}

/* ------------------------------------------------------------------ stills */

test("stills: onboarding (fresh testnet wallet; the phrase stays hidden)", async () => {
  test.setTimeout(180_000);
  const { context, id } = await launch(REAL_BUILD);
  const page = await popup(context, id);
  await expect(page.getByRole("heading", { name: "Clip Wallet" })).toBeVisible();
  await shoot(page, "onboarding-welcome");
  await page.getByRole("button", { name: "Create a new wallet" }).click();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Type it again").fill(PASSWORD);
  await shoot(page, "onboarding-password");
  await page.getByRole("button", { name: "Create wallet" }).click();
  await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".clip-phrase.is-hidden")).toBeVisible();
  await shoot(page, "onboarding-phrase-hidden");
  await context.close();
});

test("stills: home, send, swap, settings, dapp connect and approvals (matrix testnet wallet)", async () => {
  test.setTimeout(300_000);
  const { context, id } = await launch(REAL_BUILD);
  const page = await popup(context, id);
  await importMatrixWallet(page); // nothing is captured before this returns: the phrase field is gone by then
  await balancesLoaded(page);
  await shoot(page, "home");

  await page.getByRole("button", { name: "Send", exact: true }).click();
  const what = page.locator("select").first();
  await what.selectOption((await what.evaluate((s: HTMLSelectElement) => [...s.options].find((o) => o.text.startsWith("ETH"))?.value))!);
  await page.getByPlaceholder("Name, @handle or address").fill(SELF_EVM);
  await page.getByPlaceholder("0").fill("0.0001");
  await page.waitForTimeout(600);
  await shoot(page, "send");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Where should the ETH arrive?" })).toBeVisible({ timeout: 30_000 });
  await shoot(page, "send-network");

  await page.goto(`chrome-extension://${id}/popup.html#/swap`);
  await expect(page.getByRole("heading", { name: "Swap" })).toBeVisible();
  const pay = page.locator("select").first();
  await pay.selectOption({ label: "HBAR" }).catch(() => undefined);
  await page.getByPlaceholder("0").fill("5");
  await page.waitForTimeout(600);
  await shoot(page, "swap");

  await page.goto(`chrome-extension://${id}/popup.html#/settings`);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.waitForTimeout(800);
  await shoot(page, "settings");

  // A dapp connects over EIP-6963; the connect screen, then decoded requests (rejected: nothing is sent).
  const dapp = await openDapp(context);
  let win = nextApproval(context);
  const connecting = dapp.evaluate(() => (window as unknown as { clipDemo: { connect(): Promise<string> } }).clipDemo.connect());
  let approval = await win;
  await approval.setViewportSize(APPROVAL);
  await expect(approval.getByRole("heading", { name: /Connect to harbor\.example/ })).toBeVisible();
  await shoot(approval, "dapp-connect");
  await approval.getByRole("button", { name: "Connect" }).click();
  await connecting;
  await dapp.waitForTimeout(500);
  await dapp.screenshot({ path: path.join(STILLS, "dapp-connected-light.png") });
  await dapp.evaluate(() => (window as unknown as { clipDemo: { request(m: string, p: unknown): Promise<unknown> } }).clipDemo.request("wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }])).catch(() => undefined);

  // An unlimited ERC-20 approval, decoded and called out.
  const approveData = `0x095ea7b3${SPENDER.slice(2).toLowerCase().padStart(64, "0")}${"f".repeat(64)}`;
  win = nextApproval(context).catch(() => approval);
  const approving = dapp
    .evaluate(([to, data, from]) => (window as unknown as { clipDemo: { request(m: string, p: unknown): Promise<unknown> } }).clipDemo.request("eth_sendTransaction", [{ from, to, data, value: "0x0" }]), [SEPOLIA_USDC, approveData, SELF_EVM] as const)
    .catch(() => "rejected");
  approval = await win;
  await approval.setViewportSize(APPROVAL);
  await expect(approval.locator(".clip-approval__title")).toBeVisible({ timeout: 30_000 });
  await approval.waitForTimeout(2500); // simulation and checks settle
  await shoot(approval, "approval-unlimited");
  await approval.getByRole("button", { name: "Reject" }).click();
  await approving;

  // A plain send request, decoded with fee and time.
  win = nextApproval(context).catch(() => approval);
  const sending = dapp
    .evaluate(([to, from]) => (window as unknown as { clipDemo: { request(m: string, p: unknown): Promise<unknown> } }).clipDemo.request("eth_sendTransaction", [{ from, to, value: "0x5af3107a4000" }]), [SELF_EVM, SELF_EVM] as const)
    .catch(() => "rejected");
  approval = await win;
  await approval.setViewportSize(APPROVAL);
  await expect(approval.locator(".clip-approval__title")).toBeVisible({ timeout: 30_000 });
  await approval.waitForTimeout(2500);
  await shoot(approval, "approval-send");
  await approval.getByRole("button", { name: "Reject" }).click();
  await sending;
  await context.close();
});

test("stills: collectibles (fixture build: mock data, no real NFTs on the matrix wallet)", async () => {
  test.setTimeout(120_000);
  const { context, id } = await launch(FIXTURE_BUILD);
  const page = await popup(context, id);
  await page.getByRole("button", { name: "Create a new wallet" }).click();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Type it again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create wallet" }).click();
  await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible({ timeout: 30_000 });
  // Fixture-build throwaway phrase: read only to answer the check; never captured.
  await page.getByRole("button", { name: "Show my phrase" }).click();
  const words = await page.locator(".clip-phrase__w").allTextContents();
  await page.getByRole("checkbox", { name: "I wrote these words down" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  for (const label of await page.locator(".clip-field__label").allTextContents()) await page.getByLabel(label, { exact: true }).fill(words[Number(label.replace("Word #", "")) - 1]!);
  words.length = 0;
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await page.getByRole("button", { name: "Collectibles" }).click();
  await expect(page.getByRole("heading", { name: /Clip Founders/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shoot(page, "collectibles");
  await context.close();
});

/* ------------------------------------------------------------------ recordings */

test("record: onboarding → home (fresh testnet wallet; capture is off while the phrase is shown)", async () => {
  test.setTimeout(180_000);
  const { context, id } = await launch(REAL_BUILD);
  const page = await popup(context, id);
  await expect(page.getByRole("heading", { name: "Clip Wallet" })).toBeVisible();
  await page.waitForTimeout(300);
  const rec = new Recorder(page, path.join(REC, "onboarding"));
  await rec.start();
  await page.waitForTimeout(1200);
  await tap(page, page.getByRole("button", { name: "Create a new wallet" }));
  await page.waitForTimeout(500);
  await typeSlowly(page.getByLabel("Password", { exact: true }), PASSWORD, 35);
  await typeSlowly(page.getByLabel("Type it again"), PASSWORD, 35);
  await page.waitForTimeout(400);
  await tap(page, page.getByRole("button", { name: "Create wallet" }));
  await expect(page.getByRole("heading", { name: "Your recovery phrase" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1600);

  await rec.pause(); // ---- nothing below is captured until resume()
  await page.getByRole("button", { name: "Show my phrase" }).click();
  const words = await page.locator(".clip-phrase__w").allTextContents();
  await page.getByRole("checkbox", { name: "I wrote these words down" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  for (const label of await page.locator(".clip-field__label").allTextContents()) await page.getByLabel(label, { exact: true }).fill(words[Number(label.replace("Word #", "")) - 1]!);
  words.length = 0;
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Unlock with Face ID or Touch ID?" })).toBeVisible();
  await expect(page.locator(".clip-phrase, .clip-field__label")).toHaveCount(0);
  await rec.resume(); // ---- the phrase screens are gone

  await page.waitForTimeout(1200);
  await tap(page, page.getByRole("button", { name: "Not now" }));
  await page.waitForTimeout(900);
  await tap(page, page.getByRole("button", { name: "Open my wallet" }));
  await expect(page.getByTestId("total")).toHaveText(/\$\d/, { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await rec.stop();
  await context.close();
});

test("record: a dapp connects and signs in (matrix testnet wallet)", async () => {
  test.setTimeout(300_000);
  const { context, id } = await launch(REAL_BUILD);
  const page = await popup(context, id);
  await importMatrixWallet(page);
  await page.close();

  // The stage's right-hand panel between requests: the Clip mark on a quiet panel.
  const mark = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../brand/clip-glyph-ink.svg"), "utf8");
  const idle = await context.newPage();
  await idle.setViewportSize(APPROVAL);
  await idle.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#F1F0EC"><div style="width:72px;opacity:.18">${mark.replace(/width="\d+" height="\d+"/, 'width="72" height="72"')}</div></body>`);
  await idle.screenshot({ path: path.join(REC, "idle.png") });
  await idle.close();

  const dapp = await openDapp(context);
  const recDapp = new Recorder(dapp, path.join(REC, "connect-dapp"));
  await recDapp.start();
  await dapp.waitForTimeout(1200);
  const recApprovals: Recorder[] = [];
  const watch = (n: number) =>
    nextApproval(context).then(async (w) => {
      await w.setViewportSize(APPROVAL);
      const r = new Recorder(w, path.join(REC, `connect-approval-${n}`));
      await r.start();
      recApprovals.push(r);
      return w;
    });

  let win = watch(0);
  await tap(dapp, dapp.getByRole("button", { name: "Connect wallet" }));
  let approval = await win;
  await expect(approval.getByRole("heading", { name: /Connect to harbor\.example/ })).toBeVisible();
  await approval.waitForTimeout(1800);
  await tap(approval, approval.getByRole("button", { name: "Connect" }));
  await expect(dapp.getByText("Connected", { exact: true })).toBeVisible({ timeout: 30_000 });
  await recApprovals[0]?.stop();
  await dapp.waitForTimeout(1300);

  win = watch(1);
  await tap(dapp, dapp.getByRole("button", { name: "Sign in with Ethereum" }));
  approval = await win;
  await expect(approval.locator(".clip-approval__title")).toBeVisible({ timeout: 30_000 });
  await approval.waitForTimeout(2200);
  await tap(approval, approval.getByRole("button", { name: "Approve" }));
  await expect(dapp.getByText("Signed in.")).toBeVisible({ timeout: 30_000 });
  await recApprovals[1]?.stop();
  await dapp.waitForTimeout(2200);
  await recDapp.stop();
  await context.close();
});

test("record: send asks where the ETH should arrive (matrix testnet wallet; stops at review)", async () => {
  test.setTimeout(300_000);
  const { context, id } = await launch(REAL_BUILD);
  const page = await popup(context, id);
  await importMatrixWallet(page);
  await balancesLoaded(page);
  await page.waitForTimeout(500);
  const rec = new Recorder(page, path.join(REC, "send"));
  await rec.start();
  await page.waitForTimeout(1500);
  await tap(page, page.getByRole("button", { name: "Send", exact: true }));
  await page.waitForTimeout(700);
  const what = page.locator("select").first();
  await tap(page, what);
  await what.selectOption((await what.evaluate((s: HTMLSelectElement) => [...s.options].find((o) => o.text.startsWith("ETH"))?.value))!);
  await page.waitForTimeout(600);
  await tap(page, page.getByPlaceholder("Name, @handle or address"));
  await page.getByPlaceholder("Name, @handle or address").pressSequentially(SELF_EVM, { delay: 18 });
  await typeSlowly(page.getByPlaceholder("0"), "0.0001", 90);
  await page.waitForTimeout(500);
  await tap(page, page.getByRole("button", { name: "Review" }));
  await expect(page.getByRole("heading", { name: "Where should the ETH arrive?" })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await tap(page, page.getByRole("radio").first());
  await page.waitForTimeout(700);
  await tap(page, page.getByRole("button", { name: "Continue" }));
  await page.waitForTimeout(3500);
  await rec.stop();
  await context.close();
});
