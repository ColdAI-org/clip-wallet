/**
 * Clip Wallet desktop: main process bootstrap.
 *
 *   wallet window     packages/ui WalletApp (same screens, i18n and themes as the extension), clip-app: origin
 *   approval window   packages/ui ApprovalWindowApp, opened by the engine for every request (like the extension's)
 *   browser window    our toolbar + one sandboxed view per tab, one session per site (browser/browser.ts)
 *   engine + vault    here, in the main process (host/wallet.ts); renderers reach it only over checked IPC
 *
 * Security switches are set before anything loads: single instance, sandbox for every renderer, no remote content
 * in app windows (CSP + a request filter on the default session), no new windows, no <webview>, no navigation of
 * app windows, permission handlers that deny by default.
 */
import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  dialog,
  ipcMain,
  nativeTheme,
  powerMonitor,
  safeStorage,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createTonModule } from "@clip-wallet/chains-ton";
import type { LocaleCode } from "@clip-wallet/i18n";
import type { Notice } from "@clip-wallet/social";
import { CH, ChromeCall, DesktopCall, HidReply, WalletCall, type DesktopInfo, type Envelope, type HidJob, type OneMaskBoot } from "../shared/ipc";
import { DESKTOP } from "../shared/app-config";
import { desktopLocale, desktopT } from "../shared/i18n";
import { APP_ORIGIN, isAppSender, type Role } from "./ipc-guard";
import { handleAppScheme, registerAppScheme, walletCsp } from "./app-protocol";
import { createDesktopWallet, type DesktopWallet } from "./host/wallet";
import { HidRelay, ledgerDevices, LEDGER_VENDOR_ID } from "./hid";
import { OneMaskRelay, frameOrigin } from "./browser/onemask-relay";
import { DappBrowser } from "./browser/browser";
import { isNavigable } from "./browser/url-policy";
import { deepLinkFromArgv, parseDeepLink } from "./deeplink";
import { startAutoUpdate, updatesEnabled } from "./updater";

const here = fileURLToPath(new URL(".", import.meta.url));
const PRELOAD_APP = join(here, "../preload/wallet.cjs");
const PRELOAD_DAPP = join(here, "../preload/dapp.cjs");
const RENDERER_ROOT = join(here, "../renderer");
const DEV_URL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const DEV_ORIGIN = DEV_URL ? new URL(DEV_URL).origin : undefined;

/* ------------------------------------------------------------------ before ready */

// Tests and side-by-side profiles: a separate data folder. Ignored in packaged builds.
if (!app.isPackaged && process.env.CLIP_DESKTOP_USER_DATA) {
  app.setPath("userData", process.env.CLIP_DESKTOP_USER_DATA === "temp" ? mkdtempSync(join(tmpdir(), "clip-desktop-")) : process.env.CLIP_DESKTOP_USER_DATA);
}
app.setAppUserModelId(DESKTOP.appId);
registerAppScheme();
// Never offer Chromium's own password manager / autofill for anything here.
app.commandLine.appendSwitch("disable-features", "AutofillServerCommunication,PasswordManagerOnboarding");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

function pageUrl(page: "wallet" | "approval" | "browser", hash = ""): string {
  return DEV_URL ? `${DEV_URL}/${page}/index.html${hash}` : `${APP_ORIGIN}/${page}/index.html${hash}`;
}

async function main() {
  const pendingLinks: string[] = [];
  const first = deepLinkFromArgv(process.argv);
  if (first) pendingLinks.push(first);
  app.on("open-url", (e, url) => {
    e.preventDefault();
    pendingLinks.push(url);
    if (app.isReady()) flushLinks();
  });
  app.on("second-instance", (_e, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) {
      pendingLinks.push(link);
      flushLinks();
    } else showWallet();
  });

  await app.whenReady();
  // macOS registers clipwallet:// from Info.plist (CFBundleURLTypes); Windows and Linux need it at run time.
  if (app.isPackaged && process.platform !== "darwin" && !app.isDefaultProtocolClient(DESKTOP.scheme)) app.setAsDefaultProtocolClient(DESKTOP.scheme);
  handleAppScheme(RENDERER_ROOT, walletCsp(DESKTOP.config.services.mediaProxyUrl));

  /* ---------------------------------------------------------------- state */

  const roles = new Map<number, Role>();
  let walletWin: BrowserWindow | null = null;
  let approvalWin: BrowserWindow | null = null;
  let locale: LocaleCode = desktopLocale(undefined, app.getPreferredSystemLanguages());
  let t = desktopT(locale);
  let themePref: "system" | "light" | "dark" = "system";
  const theme = () => (themePref === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : themePref);

  const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed();

  const hid = new HidRelay({
    target: () => {
      const focused = BrowserWindow.getFocusedWindow();
      const pick = [focused, approvalWin, walletWin].find((w) => alive(w) && w.isVisible() && (w === approvalWin || w === walletWin));
      const w = (pick as BrowserWindow | undefined) ?? (alive(walletWin) ? walletWin : null);
      return w ? { send: (job: HidJob) => w.webContents.send(CH.hidJob, job) } : null;
    },
  });

  const notifier = {
    async show(n: Notice) {
      if (!Notification.isSupported()) return;
      const note = new Notification({ title: n.title, body: n.body, silent: true });
      note.on("click", () => showWallet(n.route ?? "/"));
      note.show();
    },
  };

  let browser!: DappBrowser;
  const wallet: DesktopWallet = createDesktopWallet({
    userData: app.getPath("userData"),
    platform: process.platform,
    safe: safeStorage,
    touchId: {
      can: () => process.platform === "darwin" && systemPreferences.canPromptTouchID(),
      prompt: (reason) => systemPreferences.promptTouchID(reason),
    },
    openApproval: (id) => openApproval(id),
    openRoute: (route) => showWallet(route),
    broadcast: () => broadcast(),
    locked: () => broadcast(),
    hidTransport: hid.transport,
    notifier,
    systemLanguages: () => app.getPreferredSystemLanguages(),
    openExternal: async (url) => {
      if (new URL(url).protocol === "https:") await shell.openExternal(url);
    },
    ...(DESKTOP.wcProjectId ? { wcProjectId: DESKTOP.wcProjectId } : {}),
    ...(process.env.CLIP_DESKTOP_KNOWN_DAPPS && !app.isPackaged ? { knownDapps: JSON.parse(process.env.CLIP_DESKTOP_KNOWN_DAPPS) as Record<string, string> } : {}),
  });

  const relay = new OneMaskRelay({
    attach: (port, origin) => wallet.attachDappPort(port, origin),
    replyChannel: CH.onemaskToPage,
    onActivity: () => browser?.push(),
  });

  const channel = `clip-${randomUUID()}`;
  const boot: OneMaskBoot = {
    channel,
    networks: wallet.browserNetworks.map((n) => ({ ...n, rpcUrls: n.rpcUrls.slice(0, 1) })),
    identity: DESKTOP.identity,
    tonConnect: { key: "clipwallet", appName: "clipwallet", appVersion: app.getVersion(), features: createTonModule().features },
  };

  browser = new DappBrowser({
    relay,
    preload: PRELOAD_DAPP,
    chromePreload: PRELOAD_APP,
    chromeUrl: pageUrl("browser"),
    t: (id, v) => t(id, v),
    locale: () => locale,
    theme,
    kv: wallet.kv,
    isKnownScam: (o) => wallet.isKnownScam(o),
    scamReasons: async (o) => (await wallet.checkSite(o)).reasons,
    connectedOrigins: () => wallet.connectedOrigins(),
    featured: () => wallet.featured(),
    registerChrome: (wc) => register(wc, "chrome"),
  });

  /* ---------------------------------------------------------------- app windows */

  function register(wc: WebContents, role: Role) {
    roles.set(wc.id, role);
    const id = wc.id;
    wc.once("destroyed", () => roles.delete(id));
  }

  const appWebPreferences = {
    preload: PRELOAD_APP,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: false,
    navigateOnDragDrop: false,
  } as const;

  function showWallet(route?: string) {
    if (!alive(walletWin)) {
      walletWin = new BrowserWindow({
        width: 440,
        height: 780,
        minWidth: 360,
        minHeight: 560,
        title: DESKTOP.config.name,
        show: false,
        backgroundColor: theme() === "dark" ? "#0E0F12" : "#FFFFFF",
        webPreferences: appWebPreferences,
      });
      register(walletWin.webContents, "wallet");
      void walletWin.loadURL(pageUrl("wallet", route ? `#${route}` : ""));
      walletWin.once("ready-to-show", () => walletWin?.show());
      walletWin.on("closed", () => (walletWin = null));
      return;
    }
    if (route) void walletWin.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`).catch(() => undefined);
    if (walletWin.isMinimized()) walletWin.restore();
    walletWin.show();
    walletWin.focus();
  }

  function openApproval(id: string) {
    if (alive(approvalWin)) {
      approvalWin.show();
      approvalWin.focus();
      return;
    }
    approvalWin = new BrowserWindow({
      width: 400,
      height: 680,
      minWidth: 360,
      minHeight: 520,
      title: DESKTOP.config.name,
      show: false,
      alwaysOnTop: true,
      fullscreenable: false,
      backgroundColor: theme() === "dark" ? "#0E0F12" : "#FFFFFF",
      webPreferences: appWebPreferences,
    });
    register(approvalWin.webContents, "approval");
    void approvalWin.loadURL(pageUrl("approval", `#${encodeURIComponent(id)}`));
    approvalWin.once("ready-to-show", () => {
      approvalWin?.show();
      approvalWin?.focus();
    });
    approvalWin.on("closed", () => (approvalWin = null));
  }

  async function broadcast() {
    for (const w of [walletWin, approvalWin]) if (alive(w)) w.webContents.send(CH.walletChanged);
    browser.push();
    // Language and theme follow Settings.
    const prefs = await wallet.engine.prefs().catch(() => null);
    if (prefs) {
      themePref = prefs.theme;
      const next = desktopLocale(prefs.locale, app.getPreferredSystemLanguages());
      if (next !== locale) {
        locale = next;
        t = desktopT(locale);
        buildMenu();
      }
    }
  }

  /* ---------------------------------------------------------------- sessions */

  const ses = session.defaultSession;
  // App windows load nothing from the network: only the bundle (clip-app:), data:/blob:, devtools, and NFT images
  // through the configured media proxy.
  const mediaOrigin = DESKTOP.config.services.mediaProxyUrl ? new URL(DESKTOP.config.services.mediaProxyUrl).origin : null;
  ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "file://*/*", "ftp://*/*"] }, (d, cb) => {
    const origin = (() => {
      try {
        return new URL(d.url).origin;
      } catch {
        return "";
      }
    })();
    const ok = (DEV_ORIGIN && origin === DEV_ORIGIN) || (mediaOrigin && origin === mediaOrigin && (d.resourceType === "image" || d.resourceType === "media"));
    cb({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const isApp = roles.has(wc.id) && details.isMainFrame && (details.requestingUrl.startsWith(`${APP_ORIGIN}/`) || (!!DEV_ORIGIN && details.requestingUrl.startsWith(DEV_ORIGIN)));
    const media = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    // The wallet's own QR scanner (WalletConnect, Keystone): camera only, never the microphone.
    if (isApp && permission === "media" && media.length > 0 && media.every((m) => m === "video")) return callback(true);
    if (isApp && permission === "clipboard-sanitized-write") return callback(true);
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (!wc || !roles.has(wc.id)) return false;
    const isApp = requestingOrigin === APP_ORIGIN || requestingOrigin === `${APP_ORIGIN}/` || (!!DEV_ORIGIN && requestingOrigin.startsWith(DEV_ORIGIN));
    return isApp && (permission === "hid" || permission === "media" || permission === "clipboard-sanitized-write");
  });
  // WebHID: Ledger only, for our own pages; the picker is a native dialog with an explicit choice.
  const pickedHid = new Set<string>();
  ses.setDevicePermissionHandler((d) => {
    const isApp = d.origin === APP_ORIGIN || d.origin === `${APP_ORIGIN}/` || (!!DEV_ORIGIN && d.origin.startsWith(DEV_ORIGIN));
    const dev = d.device as { vendorId?: number; deviceId?: string };
    // Only a Ledger the user picked in this run's chooser (so the approval window can reopen it without asking).
    return isApp && d.deviceType === "hid" && dev.vendorId === LEDGER_VENDOR_ID && !!dev.deviceId && pickedHid.has(dev.deviceId);
  });
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    // Only our windows use the default session (dapp tabs have their own sessions, which deny HID outright).
    const devices = ledgerDevices(details.deviceList);
    const parent = BrowserWindow.getFocusedWindow() ?? walletWin ?? undefined;
    if (!devices.length) {
      const opts = { type: "info" as const, message: t("d.hid.title"), detail: t("d.hid.none"), buttons: ["OK"] };
      void (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
      return callback("");
    }
    const opts = {
      type: "question" as const,
      message: t("d.hid.title"),
      detail: t("d.hid.body", { name: DESKTOP.config.name }),
      buttons: [...devices.map((d) => d.name || "Ledger"), t("d.common.cancel")],
      cancelId: devices.length,
      defaultId: devices.length,
    };
    void (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).then((r) => {
      const d = devices[r.response];
      if (!d) return callback("");
      pickedHid.add(d.deviceId);
      callback(d.deviceId);
    });
  });
  ses.on("select-serial-port", (e, _l, _wc, cb) => (e.preventDefault(), cb("")));
  ses.on("select-usb-device", (e, _d, cb) => (e.preventDefault(), cb()));
  ses.on("will-download", (e) => e.preventDefault());

  app.on("web-contents-created", (_e, wc) => {
    wc.on("will-attach-webview", (e) => e.preventDefault());
    // App windows never navigate and never open windows. (Dapp tabs replace both handlers in browser.ts.)
    wc.setWindowOpenHandler(({ url }) => {
      if (roles.has(wc.id) && /^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (e) => {
      if (!browser.isTabContents(wc.id)) e.preventDefault();
    });
  });

  /* ---------------------------------------------------------------- IPC */

  const toEnvelope = (e: unknown): Envelope => {
    const u = e as { userMessage?: unknown; code?: unknown } | null;
    if (u && typeof u.userMessage === "string" && typeof u.code === "string") return { ok: false, error: { userMessage: u.userMessage, code: u.code } };
    return { ok: false, error: { userMessage: "Something went wrong. Please try again.", code: "internal" } };
  };
  const denied: Envelope = { ok: false, error: { userMessage: "Something went wrong. Please try again.", code: "bus/forbidden" } };
  const invalid: Envelope = { ok: false, error: { userMessage: "Something went wrong. Please try again.", code: "bus/invalid" } };
  const guard = (e: IpcMainEvent | IpcMainInvokeEvent, allowed: Role[]) => isAppSender(e as never, roles, allowed, DEV_ORIGIN);

  ipcMain.handle(CH.walletCall, async (e, raw: unknown): Promise<Envelope> => {
    if (!guard(e, ["wallet", "approval"])) return denied;
    const msg = WalletCall.safeParse(raw);
    if (!msg.success) return invalid;
    try {
      return { ok: true, data: await wallet.handle(msg.data as never) };
    } catch (err) {
      return toEnvelope(err);
    }
  });

  ipcMain.handle(CH.desktopCall, async (e, raw: unknown): Promise<Envelope> => {
    if (!guard(e, ["wallet", "approval"])) return denied;
    const m = DesktopCall.safeParse(raw);
    if (!m.success) return invalid;
    try {
      const c = m.data;
      switch (c.op) {
        case "info": {
          const info: DesktopInfo = {
            platform: process.platform,
            appVersion: app.getVersion(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            storage: wallet.protection,
            biometrics: wallet.biometrics,
            updates: updatesEnabled() ? "enabled" : "disabled",
          };
          return { ok: true, data: info };
        }
        case "openBrowser":
          if (c.url && !isNavigable(c.url)) return invalid;
          browser.newTab(c.url);
          return { ok: true };
        case "openExternal":
          if (!c.url.startsWith("https://")) return invalid;
          await shell.openExternal(c.url);
          return { ok: true };
        case "showWallet":
          showWallet(c.route);
          return { ok: true };
        case "bioEnroll":
          return { ok: true, data: await wallet.bioEnroll(c.ceremonyId, c.prfInput, t("d.bio.enroll", { name: DESKTOP.config.name })) };
        case "bioEvaluate":
          await wallet.bioEvaluate(c.ceremonyId, c.credentialId, c.prfInput, t("d.bio.unlock", { name: DESKTOP.config.name }));
          return { ok: true };
        case "closeSelf":
          BrowserWindow.fromWebContents(e.sender)?.close();
          return { ok: true };
      }
    } catch (err) {
      return toEnvelope(err);
    }
  });

  ipcMain.on(CH.hidReply, (e, raw: unknown) => {
    if (!guard(e, ["wallet", "approval"])) return;
    const r = HidReply.safeParse(raw);
    if (r.success) hid.onReply(r.data);
  });

  ipcMain.handle(CH.chromeCall, async (e, raw: unknown): Promise<Envelope> => {
    if (!guard(e, ["chrome"])) return denied;
    const m = ChromeCall.safeParse(raw);
    if (!m.success) return invalid;
    const c = m.data;
    switch (c.op) {
      case "state":
        return { ok: true, data: await browser.state() };
      case "newTab":
        if (c.url !== undefined && !isNavigable(c.url)) return invalid;
        browser.newTab(c.url);
        return { ok: true };
      case "closeTab":
        browser.closeTab(c.tabId);
        return { ok: true };
      case "selectTab":
        browser.selectTab(c.tabId);
        return { ok: true };
      case "navigate":
        return browser.navigate(c.tabId, c.input) ? { ok: true } : { ok: false, error: { userMessage: t("d.browser.badUrl"), code: "browser/bad-url" } };
      case "back":
        browser.back(c.tabId);
        return { ok: true };
      case "forward":
        browser.forward(c.tabId);
        return { ok: true };
      case "reload":
        browser.reload(c.tabId);
        return { ok: true };
      case "stop":
        browser.stop(c.tabId);
        return { ok: true };
      case "toggleBookmark":
        await browser.toggleBookmark(c.tabId);
        return { ok: true };
      case "removeBookmark":
        await browser.removeBookmark(c.url);
        return { ok: true };
      case "answer":
        browser.answer(c.promptId, c.choice);
        return { ok: true };
      case "openWallet":
        showWallet(c.route);
        return { ok: true };
    }
  });

  // 1Mask: boot config and requests, only from the top frame of a dapp tab.
  ipcMain.on(CH.onemaskBoot, (e) => {
    e.returnValue = browser.isTabContents(e.sender.id) && frameOrigin(e.sender as never, e.senderFrame as never) ? boot : null;
  });
  ipcMain.on(CH.onemaskToMain, (e, raw: unknown) => {
    if (!browser.isTabContents(e.sender.id)) return;
    relay.onMessage(e.sender as never, e.senderFrame as never, raw);
  });

  /* ---------------------------------------------------------------- lifecycle */

  powerMonitor.on("lock-screen", () => void wallet.lock());
  powerMonitor.on("suspend", () => void wallet.lock());
  nativeTheme.on("updated", () => browser.push());

  function buildMenu() {
    const name = DESKTOP.config.name;
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin"
        ? [{ label: name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { type: "separator" }, { label: t("d.menu.quit", { name }), role: "quit" }] } as MenuItemConstructorOptions]
        : []),
      {
        label: t("d.menu.wallet"),
        submenu: [
          { label: t("d.menu.wallet"), accelerator: "CmdOrCtrl+1", click: () => showWallet() },
          { label: t("d.menu.lock"), accelerator: "CmdOrCtrl+Shift+L", click: () => void wallet.lock() },
          ...(process.platform === "darwin" ? [] : [{ type: "separator" } as MenuItemConstructorOptions, { label: t("d.menu.quit", { name }), role: "quit" } as MenuItemConstructorOptions]),
        ],
      },
      {
        label: t("d.menu.browser"),
        submenu: [
          { label: t("d.menu.browser"), accelerator: "CmdOrCtrl+2", click: () => (browser.window ? browser.focus() : browser.newTab()) },
          { label: t("d.menu.newTab"), accelerator: "CmdOrCtrl+T", click: () => browser.newTab() },
        ],
      },
      { label: t("d.menu.edit"), role: "editMenu" },
      { label: t("d.menu.view"), submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as MenuItemConstructorOptions])] },
      { label: t("d.menu.window"), role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function flushLinks() {
    while (pendingLinks.length) {
      const link = parseDeepLink(pendingLinks.shift());
      if (!link) continue;
      if (link.kind === "browse") browser.newTab(link.url);
      else if (link.kind === "trade") showWallet(link.route);
      else {
        showWallet();
        void wallet.pairWalletConnect(link.uri).catch(() => showWallet("/scan"));
      }
    }
  }

  app.on("activate", () => showWallet());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => wallet.dispose());

  await broadcast().catch(() => undefined);
  buildMenu();
  showWallet();
  flushLinks();
  void startAutoUpdate();
}
