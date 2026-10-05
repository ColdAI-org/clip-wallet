/**
 * The desktop app end to end, with the real vault and real chain modules on testnets (no funds needed):
 *   onboarding → home; a local dapp in the built-in browser discovers Clip Wallet over EIP-6963, connects and gets a
 *   personal_sign signature from the approval window, which recovers to the connected address. Then the security
 *   properties: the page can't reach Node/Electron/IPC, can't spoof its origin, subframes get nothing, and a second
 *   site's session (storage and wallet permission) is separate. Screenshots go to apps/desktop/screenshots.
 *
 * Run: pnpm --filter @clip-wallet/desktop e2e (builds first). macOS / Windows / Linux (Linux needs a display: xvfb).
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverMessageAddress } from "viem";
import { startDapps, type Dapps } from "./dapp/server";

const root = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = join(root, "screenshots");
const PASSWORD = "calm orange harbour 42";

let app: ElectronApplication;
let dapps: Dapps;
let userData: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dapps = await startDapps();
  userData = mkdtempSync(join(tmpdir(), "clip-desktop-e2e-"));
  app = await electron.launch({
    args: ["."],
    cwd: root,
    env: { ...process.env, CLIP_DESKTOP_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: "0" },
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await dapps?.close();
  rmSync(userData, { recursive: true, force: true });
});

async function pageWhere(pred: (url: string) => boolean, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => pred(w.url()));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`no page matched; have: ${app.windows().map((w) => w.url()).join(", ")}`);
}

const isApproval = (u: string) => u.startsWith("clip-app://wallet/approval/");

/** Opens a URL in the built-in browser the way the OS hands over a deep link. */
async function browse(url: string) {
  await app.evaluate(({ app: a }, link) => {
    a.emit("open-url", { preventDefault() {} }, link);
  }, `clipwallet://browse?url=${encodeURIComponent(url)}`);
}

/** EIP-6963 discovery, then an EIP-1193 request on Clip Wallet's provider. */
async function eip6963(page: Page, method: string, params?: unknown) {
  return page.evaluate(
    async ([m, p]) => {
      const found: { info: { name: string; rdns: string; uuid: string }; provider: { request(a: unknown): Promise<unknown> } }[] = [];
      window.addEventListener("eip6963:announceProvider", (e) => found.push((e as CustomEvent).detail));
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      await new Promise((r) => setTimeout(r, 250));
      const clip = found.find((x) => x.info.rdns === "org.coldai.clipwallet");
      if (!clip) return { error: "no provider", names: found.map((x) => x.info.name) };
      try {
        return { result: await clip.provider.request({ method: m, params: p }), name: clip.info.name };
      } catch (e) {
        return { error: String((e as Error).message), code: (e as { code?: number }).code };
      }
    },
    [method, params] as const,
  );
}

/** Composes the browser window (toolbar view over the tab view) and the approval window side by side into one PNG. */
async function shootBrowserWithApproval(file: string) {
  const png = await app.evaluate(async ({ BaseWindow, BrowserWindow, nativeImage }) => {
    const browserWin = BaseWindow.getAllWindows().find((w) => !(w instanceof BrowserWindow) && w.contentView.children.length > 1);
    if (!browserWin) return null;
    const views = browserWin.contentView.children as unknown as { webContents: Electron.WebContents; getBounds(): Electron.Rectangle; getVisible(): boolean }[];
    const { width, height } = browserWin.getContentBounds();
    const approval = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("clip-app://wallet/approval/"));
    const parts: { img: Electron.NativeImage; x: number; y: number; blend?: boolean }[] = [];
    const tab = views.find((v) => !v.webContents.getURL().startsWith("clip-app:") && v.getVisible());
    const chrome = views.find((v) => v.webContents.getURL().startsWith("clip-app://wallet/browser/"));
    if (tab) parts.push({ img: await tab.webContents.capturePage(), x: 0, y: tab.getBounds().y });
    // The toolbar view grows over the page (transparent backdrop) while a prompt is up: blend all of it.
    if (chrome) parts.push({ img: await chrome.webContents.capturePage({ x: 0, y: 0, width, height: chrome.getBounds().height }), x: 0, y: 0, blend: true });
    let total = width;
    if (approval) {
      const img = await approval.webContents.capturePage();
      parts.push({ img, x: width + 24, y: 24 });
      total = width + 24 + approval.getContentBounds().width + 24;
    }
    // Device pixels: capturePage returns images at the display's scale factor.
    const scale = parts[0] ? parts[0].img.getSize().width / (tab ? tab.getBounds().width : width) : 1;
    const W = Math.round(total * scale);
    const H = Math.round(height * scale);
    const canvas = Buffer.alloc(W * H * 4, 0xee);
    for (const p of parts) {
      const { width: w, height: h } = p.img.getSize();
      const bmp = p.img.toBitmap();
      const ox = Math.round(p.x * scale);
      const oy = Math.round(p.y * scale);
      for (let row = 0; row < h && oy + row < H; row++) {
        const len = Math.min(w, W - ox) * 4;
        if (len <= 0) continue;
        if (!p.blend) {
          bmp.copy(canvas, ((oy + row) * W + ox) * 4, row * w * 4, row * w * 4 + len);
          continue;
        }
        // Premultiplied BGRA "over" blend.
        for (let i = 0; i < len; i += 4) {
          const src = row * w * 4 + i;
          const dst = ((oy + row) * W + ox) * 4 + i;
          const a = bmp[src + 3]! / 255;
          for (let c = 0; c < 3; c++) canvas[dst + c] = Math.round(bmp[src + c]! + canvas[dst + c]! * (1 - a));
          canvas[dst + 3] = 255;
        }
      }
    }
    return nativeImage.createFromBitmap(canvas, { width: W, height: H }).toPNG().toString("base64");
  });
  if (png) writeFileSync(file, Buffer.from(png, "base64"));
}

test("desktop: onboarding, browser + 1Mask connect/sign, isolation, RTL", async () => {
  /* ------------------------------------------------------------ onboarding (real vault, testnets) */
  const wallet = await pageWhere((u) => u.startsWith("clip-app://wallet/wallet/"));
  await wallet.setViewportSize({ width: 440, height: 760 }).catch(() => undefined);
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
  // Networks stay invisible on Home.
  await expect(wallet.getByText(/Sepolia|Testnet|Devnet/)).toHaveCount(0);
  await wallet.waitForTimeout(500);
  await wallet.screenshot({ path: join(SHOTS, "wallet-home.png") });

  // The wallet window runs no eval and loads nothing remote; it has the typed bridge and nothing of Node.
  const walletSandbox = await wallet.evaluate(async () => {
    // Code strings and inline scripts must not run. (CDP's own evaluate is exempt from CSP, so the probes run later,
    // from the page: a string timer and an injected inline <script>.)
    const w = window as unknown as { __evalRan?: boolean; __inlineRan?: boolean };
    (setTimeout as unknown as (code: string, ms: number) => void)("window.__evalRan = true", 0);
    const s = document.createElement("script");
    s.textContent = "window.__inlineRan = true";
    document.head.append(s);
    await new Promise((r) => setTimeout(r, 200));
    const evalResult = w.__evalRan || w.__inlineRan ? "allowed" : "blocked";
    const remote = await fetch("https://example.com/").then(() => "loaded", () => "blocked");
    return { eval: evalResult, remote, require: typeof (window as { require?: unknown }).require, process: typeof (window as { process?: unknown }).process, bridge: Object.keys(window.clipDesktop).sort() };
  });
  expect(walletSandbox).toEqual({ eval: "blocked", remote: "blocked", require: "undefined", process: "undefined", bridge: ["call", "chrome", "desktop", "onChange", "onChromeState", "onHidJob", "platform"] });
  // A forged desktop call is refused by the schema.
  expect(await wallet.evaluate(() => window.clipDesktop.desktop({ op: "openExternal", url: "file:///etc/hosts" } as never))).toMatchObject({ ok: false, error: { code: "bus/invalid" } });

  // The vault file is wrapped by the OS store (Keychain on macOS) on top of the vault's own encryption.
  const info = await wallet.evaluate(() => window.clipDesktop.desktop({ op: "info" }));
  expect(info).toMatchObject({ ok: true, data: { storage: expect.stringMatching(/keychain|dpapi|libsecret|kwallet|basic|none/) } });

  /* ------------------------------------------------------------ the built-in browser */
  await browse(`${dapps.a}/`);
  const dapp = await pageWhere((u) => u.startsWith(dapps.a));
  await expect(dapp.getByRole("heading", { name: "Test Dapp" })).toBeVisible();
  const chrome = await pageWhere((u) => u.startsWith("clip-app://wallet/browser/"));
  // The address bar shows the origin the browser committed, flagged as not secure (plain http, this computer only).
  await expect(chrome.getByTestId("address-origin")).toContainText(new URL(dapps.a).host);
  await expect(chrome.getByText("Not secure")).toBeVisible();
  // The browser toolbar shares the preload but not the wallet channels: the main process checks the sender's role.
  expect(await chrome.evaluate((password) => window.clipDesktop.call({ type: "revealPhrase", password }), PASSWORD)).toMatchObject({ ok: false, error: { code: "bus/forbidden" } });

  // Nothing of Node, Electron or the wallet's IPC is reachable from the page.
  const reach = await dapp.evaluate(() => ({
    require: typeof (window as { require?: unknown }).require,
    process: typeof (window as { process?: unknown }).process,
    module: typeof (window as { module?: unknown }).module,
    electron: typeof (window as { electron?: unknown }).electron,
    ipcRenderer: typeof (window as { ipcRenderer?: unknown }).ipcRenderer,
    clipDesktop: typeof (window as { clipDesktop?: unknown }).clipDesktop,
    buffer: typeof (window as { Buffer?: unknown }).Buffer,
  }));
  expect(reach).toEqual({ require: "undefined", process: "undefined", module: "undefined", electron: "undefined", ipcRenderer: "undefined", clipDesktop: "undefined", buffer: "undefined" });
  // The wallet's own pages don't exist in a dapp's session.
  const appScheme = await dapp.evaluate(() => fetch("clip-app://wallet/wallet/index.html").then(() => "loaded", () => "blocked"));
  expect(appScheme).toBe("blocked");

  // EIP-6963 discovery + connect: the approval window shows the site's real origin.
  const connecting = eip6963(dapp, "eth_requestAccounts");
  const approval = await pageWhere(isApproval);
  await expect(approval.getByRole("heading", { name: new RegExp(`Connect to ${new URL(dapps.a).hostname}`) })).toBeVisible();
  await approval.getByRole("button", { name: "Connect" }).click();
  const connected = await connecting;
  expect(connected).toMatchObject({ name: "Clip Wallet", result: [expect.stringMatching(/^0x[0-9a-fA-F]{40}$/)] });
  const address = (connected as { result: string[] }).result[0]!;
  await expect(chrome.getByRole("img", { name: "Connected to your wallet" })).toBeVisible();

  // personal_sign: decoded, approved in the approval window, signed by the vault; the signature recovers to the account.
  const message = "Hello from the Clip Wallet desktop e2e";
  const hexMsg = `0x${Buffer.from(message, "utf8").toString("hex")}`;
  const signing = eip6963(dapp, "personal_sign", [hexMsg, address]);
  const signWin = await pageWhere(isApproval);
  await expect(signWin.locator(".clip-approval__title")).toBeVisible();
  await signWin.waitForTimeout(400);
  await shootBrowserWithApproval(join(SHOTS, "browser-dapp-approval.png"));
  await signWin.getByRole("button", { name: "Approve" }).click();
  const signed = await signing;
  expect(signed).toMatchObject({ result: expect.stringMatching(/^0x[0-9a-f]{130}$/i) });
  const recovered = await recoverMessageAddress({ message, signature: (signed as { result: `0x${string}` }).result });
  expect(recovered.toLowerCase()).toBe(address.toLowerCase());

  /* ------------------------------------------------------------ origin spoofing */
  // The page learns the 1Mask channel by watching its own postMessages, then forges a request with a different
  // origin: the content bridge's strict schema refuses the extra field, and the main process would overwrite it anyway.
  const spoof = await dapp.evaluate(async () => {
    let channel = "";
    const seen = (e: MessageEvent) => {
      const d = e.data as { channel?: string; source?: string } | null;
      if (d?.source === "1mask-inpage" && d.channel) channel = d.channel;
    };
    window.addEventListener("message", seen);
    const found: { info: { rdns: string }; provider: { request(a: unknown): Promise<unknown> } }[] = [];
    window.addEventListener("eip6963:announceProvider", (e) => found.push((e as CustomEvent).detail));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((r) => setTimeout(r, 200));
    await found.find((x) => x.info.rdns === "org.coldai.clipwallet")!.provider.request({ method: "eth_chainId" });
    window.removeEventListener("message", seen);
    const reply = new Promise<unknown>((resolve) => {
      const on = (e: MessageEvent) => {
        const d = e.data as { id?: string; source?: string } | null;
        if (d?.source === "1mask-content" && d.id === "spoof-1") {
          window.removeEventListener("message", on);
          resolve(d);
        }
      };
      window.addEventListener("message", on);
      setTimeout(() => resolve("timeout"), 3000);
    });
    window.postMessage({ channel, source: "1mask-inpage", type: "request", id: "spoof-1", family: "evm", method: "eth_accounts", origin: "https://app.uniswap.org" }, "*");
    return { channel: channel.length > 0, reply: await reply };
  });
  expect(spoof.channel).toBe(true);
  expect(spoof.reply).toMatchObject({ error: { code: -32602 } });

  /* ------------------------------------------------------------ subframes */
  await browse(`${dapps.a}/framed`);
  const framed = await pageWhere((u) => u.startsWith(`${dapps.a}/framed`));
  const frame = framed.frameLocator("#frame");
  await expect(frame.locator("body")).toHaveText("frame");
  const sub = await framed.frames().find((f) => f.url().startsWith(dapps.b))!.evaluate(async () => {
    const found: unknown[] = [];
    window.addEventListener("eip6963:announceProvider", (e) => found.push((e as CustomEvent).detail));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((r) => setTimeout(r, 300));
    // Try to reach the top frame's bridge with a well-formed request: it only accepts its own window's messages.
    window.parent.postMessage({ channel: "clip-guess", source: "1mask-inpage", type: "request", id: "f1", family: "evm", method: "eth_accounts" }, "*");
    return { providers: found.length, ethereum: typeof (window as { ethereum?: unknown }).ethereum };
  });
  expect(sub).toEqual({ providers: 0, ethereum: "undefined" });

  /* ------------------------------------------------------------ a second site is isolated */
  await dapp.evaluate(() => {
    localStorage.setItem("clip-e2e", "site-a");
    document.cookie = "clip_e2e=site-a; path=/";
  });
  await browse(`${dapps.b}/`);
  const siteB = await pageWhere((u) => u.startsWith(dapps.b) && !u.includes("/frame"));
  await expect(siteB.getByRole("heading", { name: "Site B" })).toBeVisible();
  const bStore = await siteB.evaluate(() => ({ ls: localStorage.getItem("clip-e2e"), cookie: document.cookie }));
  expect(bStore).toEqual({ ls: null, cookie: "" });
  // Site A's connection doesn't carry over: site B sees no accounts.
  expect(await eip6963(siteB, "eth_accounts")).toMatchObject({ result: [] });
  // Each site has its own Electron session (partition).
  const partitions = await app.evaluate(({ webContents }, origins) => {
    const out: Record<string, string> = {};
    for (const wc of webContents.getAllWebContents()) {
      const o = (() => {
        try {
          return new URL(wc.getURL()).origin;
        } catch {
          return "";
        }
      })();
      if (origins.includes(o)) out[o] = wc.session.storagePath ?? "";
    }
    return out;
  }, [dapps.a, dapps.b]);
  expect(Object.keys(partitions).sort()).toEqual([dapps.a, dapps.b].sort());
  expect(partitions[dapps.a]).not.toBe(partitions[dapps.b]);

  /* ------------------------------------------------------------ permissions and popups */
  // A permission request waits on a prompt in the toolbar; "Don't allow" denies it.
  const asking = siteB.evaluate(() => Notification.requestPermission());
  const dialog = chrome.getByRole("alertdialog");
  await expect(dialog).toContainText(`${new URL(dapps.b).host} wants to use your notifications`);
  await siteB.waitForTimeout(300);
  await shootBrowserWithApproval(join(SHOTS, "browser-permission-prompt.png"));
  await dialog.getByRole("button", { name: "Don't allow" }).click();
  expect(await asking).toBe("denied");
  // Device APIs are refused outright, without a prompt.
  expect(await siteB.evaluate(() => (navigator as unknown as { hid: { requestDevice(o: unknown): Promise<unknown[]> } }).hid.requestDevice({ filters: [] }).then((d) => d.length, (e: Error) => e.name))).not.toBe(1);
  // window.open never makes a window: the link opens as a contained tab.
  const before = app.windows().length;
  const opened = await siteB.evaluate((url) => window.open(url, "_blank") === null, `${dapps.a}/?popup=1`);
  expect(opened).toBe(true);
  await pageWhere((u) => u.startsWith(`${dapps.a}/?popup=1`));
  expect(app.windows().length).toBe(before + 1);
  expect((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()))).some((u) => u.includes("popup=1"))).toBe(false);

  /* ------------------------------------------------------------ Arabic, right to left */
  await wallet.evaluate(() => window.clipDesktop.call({ type: "setPrefs", patch: { locale: "ar" } }));
  await expect(wallet.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(chrome.locator("html")).toHaveAttribute("dir", "rtl");
  await wallet.waitForTimeout(600);
  await wallet.screenshot({ path: join(SHOTS, "wallet-home-ar.png") });
  await browse(`${dapps.a}/`);
  await chrome.waitForTimeout(600);
  await shootBrowserWithApproval(join(SHOTS, "browser-ar.png"));
  await wallet.evaluate(() => window.clipDesktop.call({ type: "setPrefs", patch: { locale: "system" } }));
});
