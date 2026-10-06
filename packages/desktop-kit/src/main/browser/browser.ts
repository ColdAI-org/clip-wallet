/**
 * The built-in dapp browser: one window (BaseWindow) with our toolbar on top (a WebContentsView showing the
 * clip-app: browser page, default session) and one WebContentsView per tab for the site.
 *
 * Isolation model
 *  - Every ORIGIN gets its own persistent session (url-policy.ts partitionFor). A tab whose top frame goes to another
 *    origin (link, redirect, address bar) gets a NEW view in that origin's session; the old view is closed. Cookies,
 *    storage, service workers and permission grants never cross sites, and dapp sessions don't have the clip-app:
 *    protocol, so a site can't load a wallet page.
 *  - Views are sandboxed, context-isolated, no Node, no <webview>, no preload in subframes. The only preload is
 *    preload/dapp.ts (1Mask), and the origin of every 1Mask request is set here from the committed frame.
 *  - New windows / popups never open: a link to an http(s) page opens as a new tab (phishing check first), anything
 *    else is dropped.
 *  - Permission requests (camera, microphone, notifications, clipboard, location) are denied unless the user allows
 *    them in a prompt for that site; everything else (HID, USB, serial, Bluetooth, MIDI, pointer lock…) is denied.
 *    Grants last until the app quits.
 *  - Downloads ask first (native dialog: what, from which site, how big), then a save dialog. Cancel = nothing saved.
 *  - Phishing: before a site loads, its host is checked against the security package's lists (MetaMask, ScamSniffer,
 *    Phantom, Polkadot); a listed site shows a warning instead and loads only if the user insists.
 */
import { BaseWindow, WebContentsView, dialog, session, type Session, type WebContents } from "electron";
import { CH, type ChromeState, type DistributiveOmit, type PromptView, type TabView } from "../../shared/ipc";
import type { DesktopMessageId } from "../../shared/i18n";
import type { MessageValues } from "@clip-wallet/i18n";
import type { OneMaskRelay } from "./onemask-relay";
import { displayHost, isNavigable, normalizeInput, partitionFor, promptFor, webOrigin } from "./url-policy";
import { stripAppTokens } from "./browser-ua";

export const CHROME_HEIGHT = 88;
const BOOKMARKS = "clip-desktop/bookmarks";

export interface BrowserDeps {
  relay: OneMaskRelay;
  preload: string;
  /** clip-app://wallet/browser/index.html */
  chromeUrl: string;
  chromePreload: string;
  /** The browser window's title: the wallet's name. */
  title: string;
  t(id: DesktopMessageId, values?: MessageValues): string;
  locale(): string;
  theme(): "light" | "dark";
  kv: { get<T>(k: string): Promise<T | undefined>; set<T>(k: string, v: T): Promise<void> };
  isKnownScam(origin: string): boolean;
  scamReasons(origin: string): Promise<string[]>;
  connectedOrigins(): Promise<string[]>;
  featured(): Promise<{ name: string; url: string; description?: string }[]>;
  /** The toolbar's webContents is ours: register it for IPC (role "chrome"). */
  registerChrome(wc: WebContents): void;
  hardenSession?(ses: Session): void;
  iconPath?: string;
}

interface Tab {
  id: number;
  view: WebContentsView | null;
  origin: string | null;
  url: string;
  title: string;
  loading: boolean;
  /** URLs before cross-origin swaps (each origin's own history lives in its view). */
  back: string[];
  fwd: string[];
}

interface Prompt {
  view: PromptView;
  resolve(choice: "allow" | "deny" | "leave" | "proceed"): void;
}

const hardened = new WeakSet<Session>();

export class DappBrowser {
  private win: BaseWindow | null = null;
  private chrome: WebContentsView | null = null;
  private tabs: Tab[] = [];
  private active: number | null = null;
  private seq = 0;
  private prompts = new Map<string, Prompt>();
  private promptSeq = 0;
  /** Site permission grants for this run: `${origin} ${kind}`. */
  private grants = new Set<string>();
  /** Listed sites the user chose to open anyway (this run only). */
  private riskAccepted = new Set<string>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: BrowserDeps) {}

  get window(): BaseWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** Every tab's webContents (tests, IPC routing). */
  tabContents(): WebContents[] {
    return this.tabs.flatMap((t) => (t.view ? [t.view.webContents] : []));
  }

  isTabContents(id: number): boolean {
    return this.tabs.some((t) => t.view?.webContents.id === id);
  }

  /* ------------------------------------------------------------------ window */

  private ensureWindow(): BaseWindow {
    if (this.window) return this.win!;
    const win = new BaseWindow({ width: 1200, height: 820, minWidth: 640, minHeight: 480, title: this.d.title, show: false, ...(this.d.iconPath ? { icon: this.d.iconPath } : {}) });
    const chrome = new WebContentsView({
      webPreferences: { preload: this.d.chromePreload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false },
    });
    chrome.setBackgroundColor("#00000000");
    this.d.registerChrome(chrome.webContents);
    void chrome.webContents.loadURL(this.d.chromeUrl);
    win.contentView.addChildView(chrome);
    win.on("resize", () => this.layout());
    win.on("closed", () => {
      for (const t of this.tabs) this.destroyView(t);
      this.tabs = [];
      this.active = null;
      for (const p of this.prompts.values()) p.resolve("deny");
      this.prompts.clear();
      this.win = null;
      this.chrome = null;
    });
    chrome.webContents.once("did-finish-load", () => {
      this.push();
      win.show();
    });
    this.win = win;
    this.chrome = chrome;
    return win;
  }

  focus() {
    const w = this.ensureWindow();
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }

  private layout() {
    const win = this.window;
    if (!win || !this.chrome) return;
    const { width, height } = win.getContentBounds();
    const tab = this.tab(this.active);
    for (const t of this.tabs) t.view?.setVisible(t === tab);
    const covered = !tab?.view || [...this.prompts.values()].some((p) => p.view.tabId === tab.id);
    if (tab?.view) tab.view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
    // The toolbar view covers the page (transparent backdrop) while a prompt or the start page is up.
    this.chrome.setBounds({ x: 0, y: 0, width, height: covered ? height : CHROME_HEIGHT });
    win.contentView.addChildView(this.chrome); // re-adding moves it to the top
  }

  /* ------------------------------------------------------------------ tabs */

  private tab(id: number | null): Tab | undefined {
    return id === null ? undefined : this.tabs.find((t) => t.id === id);
  }

  /** Opens a new tab (start page when no URL). Returns its id. */
  newTab(url?: string): number {
    this.ensureWindow();
    const t: Tab = { id: ++this.seq, view: null, origin: null, url: "", title: "", loading: false, back: [], fwd: [] };
    this.tabs.push(t);
    this.active = t.id;
    if (url) this.go(t, url, { history: false });
    this.layout();
    this.push();
    this.focus();
    return t.id;
  }

  closeTab(id: number) {
    const t = this.tab(id);
    if (!t) return;
    this.destroyView(t);
    for (const [pid, p] of this.prompts) if (p.view.tabId === id) (p.resolve("deny"), this.prompts.delete(pid));
    const i = this.tabs.indexOf(t);
    this.tabs.splice(i, 1);
    if (this.active === id) this.active = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? null;
    if (!this.tabs.length) {
      this.window?.close();
      return;
    }
    this.layout();
    this.push();
  }

  selectTab(id: number) {
    if (!this.tab(id)) return;
    this.active = id;
    this.layout();
    this.push();
  }

  /** Address bar. Returns false when the input isn't an address. */
  navigate(id: number, input: string): boolean {
    const t = this.tab(id);
    const url = normalizeInput(input);
    if (!t || !url) return false;
    this.go(t, url, { history: true });
    return true;
  }

  back(id: number) {
    const t = this.tab(id);
    if (!t) return;
    const h = t.view?.webContents.navigationHistory;
    if (h?.canGoBack()) return h.goBack();
    const prev = t.back.pop();
    if (prev !== undefined) {
      if (t.url) t.fwd.push(t.url);
      this.load(t, prev);
    }
  }

  forward(id: number) {
    const t = this.tab(id);
    if (!t) return;
    const h = t.view?.webContents.navigationHistory;
    if (h?.canGoForward()) return h.goForward();
    const next = t.fwd.pop();
    if (next !== undefined) {
      if (t.url) t.back.push(t.url);
      this.load(t, next);
    }
  }

  reload(id: number) {
    this.tab(id)?.view?.webContents.reload();
  }

  stop(id: number) {
    this.tab(id)?.view?.webContents.stop();
  }

  /* ------------------------------------------------------------------ bookmarks */

  async bookmarks(): Promise<{ url: string; title: string }[]> {
    return (await this.d.kv.get<{ url: string; title: string }[]>(BOOKMARKS)) ?? [];
  }

  async toggleBookmark(id: number) {
    const t = this.tab(id);
    if (!t?.origin) return;
    const list = await this.bookmarks();
    const has = list.some((b) => b.url === t.url);
    await this.d.kv.set(BOOKMARKS, has ? list.filter((b) => b.url !== t.url) : [...list, { url: t.url, title: (t.title || displayHost(t.origin)).slice(0, 120) }].slice(-200));
    this.push();
  }

  async removeBookmark(url: string) {
    await this.d.kv.set(
      BOOKMARKS,
      (await this.bookmarks()).filter((b) => b.url !== url),
    );
    this.push();
  }

  /* ------------------------------------------------------------------ prompts */

  answer(promptId: string, choice: "allow" | "deny" | "leave" | "proceed") {
    const p = this.prompts.get(promptId);
    if (!p) return;
    this.prompts.delete(promptId);
    p.resolve(choice);
    this.layout();
    this.push();
  }

  private ask(view: DistributiveOmit<PromptView, "id">): Promise<"allow" | "deny" | "leave" | "proceed"> {
    const id = `p${++this.promptSeq}`;
    return new Promise((resolve) => {
      this.prompts.set(id, { view: { ...view, id } as PromptView, resolve });
      this.layout();
      this.push();
    });
  }

  /* ------------------------------------------------------------------ navigation core */

  /** Loads `url` in a tab: same origin → same view; another origin → that origin's own session and a new view. */
  private go(t: Tab, url: string, o: { history: boolean }) {
    const origin = webOrigin(url);
    if (!origin) return;
    if (o.history && t.url && origin !== t.origin) {
      t.back.push(t.url);
      t.fwd = [];
    }
    this.load(t, url);
  }

  private load(t: Tab, url: string) {
    const origin = webOrigin(url);
    if (!origin) return;
    if (this.d.isKnownScam(origin) && !this.riskAccepted.has(origin)) {
      void this.warnPhishing(t, url, origin);
      return;
    }
    if (t.view && t.origin === origin) {
      void t.view.webContents.loadURL(url).catch(() => undefined);
      return;
    }
    this.destroyView(t);
    t.origin = origin;
    t.url = url;
    t.title = displayHost(origin);
    t.view = this.createView(t, origin);
    this.window?.contentView.addChildView(t.view);
    this.layout();
    void t.view.webContents.loadURL(url).catch(() => undefined);
    this.push();
  }

  private async warnPhishing(t: Tab, url: string, origin: string) {
    const reasons = await this.d.scamReasons(origin).catch(() => []);
    const choice = await this.ask({ tabId: t.id, kind: "phishing", origin, reasons });
    if (choice === "proceed") {
      this.riskAccepted.add(origin);
      this.load(t, url);
    }
  }

  private destroyView(t: Tab) {
    const v = t.view;
    t.view = null;
    if (!v) return;
    this.window?.contentView.removeChildView(v);
    const wc = v.webContents;
    this.d.relay.destroyed(wc.id);
    if (!wc.isDestroyed()) wc.close();
  }

  private createView(t: Tab, origin: string): WebContentsView {
    const partition = partitionFor(origin);
    const ses = session.fromPartition(partition);
    this.harden(ses);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: this.d.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        autoplayPolicy: "user-gesture-required",
      },
    });
    view.setBackgroundColor("#FFFFFF");
    const wc = view.webContents;
    const relay = this.d.relay;

    wc.setWindowOpenHandler(({ url }) => {
      // Popups and target=_blank: never a new window. http(s) pages open as a tab (with the same checks).
      if (isNavigable(url)) setImmediate(() => this.newTab(url));
      return { action: "deny" };
    });
    const crossOrigin = (e: { preventDefault(): void }, url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      if (!isNavigable(url)) return e.preventDefault();
      if (webOrigin(url) !== t.origin) {
        e.preventDefault();
        setImmediate(() => this.go(t, url, { history: true }));
      }
    };
    wc.on("will-frame-navigate", (e) => crossOrigin(e, e.url, e.isMainFrame));
    wc.on("will-redirect", (e) => crossOrigin(e, e.url, e.isMainFrame));
    wc.on("did-start-navigation", (e) => {
      if (e.isMainFrame && !e.isSameDocument) relay.navigated(wc.id);
    });
    const committed = () => {
      if (t.view?.webContents !== wc) return;
      t.url = wc.getURL();
      this.push();
    };
    wc.on("did-navigate", committed);
    wc.on("did-navigate-in-page", (_e, _url, isMainFrame) => isMainFrame && committed());
    wc.on("page-title-updated", (_e, title) => {
      if (t.view?.webContents !== wc) return;
      t.title = title.slice(0, 200);
      this.push();
    });
    wc.on("did-start-loading", () => t.view?.webContents === wc && ((t.loading = true), this.push()));
    wc.on("did-stop-loading", () => t.view?.webContents === wc && ((t.loading = false), this.push()));
    wc.on("select-bluetooth-device", (e, _list, cb) => {
      e.preventDefault();
      cb("");
    });
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.once("destroyed", () => relay.destroyed(wc.id));
    return view;
  }

  /** Session rules for a dapp origin (once per session). */
  private harden(ses: Session) {
    if (hardened.has(ses)) return;
    hardened.add(ses);
    ses.setUserAgent(stripAppTokens(ses.getUserAgent(), this.d.title));
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const kind = promptFor(permission, (details as { mediaTypes?: string[] }).mediaTypes ?? []);
      const origin = webOrigin(details.requestingUrl);
      const t = this.tabs.find((x) => x.view?.webContents === wc);
      // Only the top frame's own origin can ask; iframes are denied.
      if (!kind || !origin || !t || origin !== t.origin || !details.isMainFrame) return callback(false);
      if (this.grants.has(`${origin} ${kind}`)) return callback(true);
      void this.ask({ tabId: t.id, kind: "permission", origin, permission: kind }).then((c) => {
        if (c === "allow") this.grants.add(`${origin} ${kind}`);
        callback(c === "allow");
      });
    });
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const kind = promptFor(permission, details.mediaType ? [details.mediaType] : []);
      const origin = webOrigin(requestingOrigin);
      if (!kind || !origin || !wc) return false;
      return this.grants.has(`${origin} ${kind}`);
    });
    ses.setDevicePermissionHandler(() => false);
    ses.on("select-hid-device", (e, _d, cb) => {
      e.preventDefault();
      cb("");
    });
    ses.on("select-serial-port", (e, _l, _wc, cb) => {
      e.preventDefault();
      cb("");
    });
    ses.on("select-usb-device", (e, _d, cb) => {
      e.preventDefault();
      cb();
    });
    ses.on("will-download", (e, item, wc) => {
      const win = this.window;
      const site = webOrigin(wc?.getURL?.() ?? "") ?? "";
      const file = item.getFilename().slice(0, 120);
      const bytes = item.getTotalBytes();
      const size = bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(bytes > 1024 * 1024 ? 1 : 2)} MB` : this.d.t("d.download.unknownSize");
      const opts = {
        type: "question" as const,
        buttons: [this.d.t("d.download.save"), this.d.t("d.download.cancel")],
        defaultId: 1,
        cancelId: 1,
        message: this.d.t("d.download.title", { file }),
        detail: this.d.t("d.download.body", { site: displayHost(site), size }),
      };
      const choice = win ? dialog.showMessageBoxSync(win as never, opts) : dialog.showMessageBoxSync(opts);
      if (choice !== 0) return e.preventDefault();
      const path = win
        ? dialog.showSaveDialogSync(win as never, { title: this.d.t("d.download.saveTitle"), defaultPath: file })
        : dialog.showSaveDialogSync({ title: this.d.t("d.download.saveTitle"), defaultPath: file });
      if (!path) return e.preventDefault();
      item.setSavePath(path);
    });
    this.d.hardenSession?.(ses);
  }

  /* ------------------------------------------------------------------ toolbar state */

  async state(): Promise<ChromeState> {
    const [bookmarks, connected, featured] = await Promise.all([
      this.bookmarks(),
      this.d.connectedOrigins().catch(() => [] as string[]),
      this.tabs.some((t) => !t.view) ? this.d.featured().catch(() => []) : Promise.resolve([]),
    ]);
    const tabs: TabView[] = this.tabs.map((t) => {
      const wc = t.view?.webContents;
      const h = wc && !wc.isDestroyed() ? wc.navigationHistory : undefined;
      return {
        id: t.id,
        title: t.title || (t.origin ? displayHost(t.origin) : ""),
        url: t.view ? t.url : "",
        origin: t.view ? t.origin : null,
        secure: !!t.origin && t.origin.startsWith("https:"),
        loading: t.loading,
        canGoBack: !!h?.canGoBack() || t.back.length > 0,
        canGoForward: !!h?.canGoForward() || t.fwd.length > 0,
        bookmarked: !!t.view && bookmarks.some((b) => b.url === t.url),
        connected: !!t.origin && connected.includes(t.origin),
        risk: t.origin && this.d.isKnownScam(t.origin) ? "danger" : "ok",
      };
    });
    return {
      tabs,
      activeId: this.active,
      bookmarks,
      featured,
      prompts: [...this.prompts.values()].map((p) => p.view),
      locale: this.d.locale(),
      theme: this.d.theme(),
    };
  }

  /** Sends the toolbar a fresh state (debounced). */
  push() {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      const wc = this.chrome?.webContents;
      if (!wc || wc.isDestroyed()) return;
      void this.state().then((s) => !wc.isDestroyed() && wc.send(CH.chromeState, s));
    }, 30);
  }
}
