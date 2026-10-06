/**
 * End to end, without a simulator: the REAL injected bundle (inpage.generated.ts: 1Mask inpage + content bridge)
 * runs in a DOM window wired to the native bridge (bridge.ts) and a real WalletEngine. A page discovers the
 * wallet with EIP-6963, connects (eth_requestAccounts) and asks for personal_sign; the "user" approves.
 * The engine's vault is a test double (no keys in tests; see packages/engine/test/fixtures.ts).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Window as HappyWindow } from "happy-dom";
import { WalletEngine, MemoryKV } from "@clip-wallet/engine";
import { INPAGE_JS } from "../src/browser/inpage.generated";
import { createWebViewBridge, webOrigin } from "../src/browser/bridge";
import { BASE_SEPOLIA, EVM_ADDRESS, FakeVault, SEPOLIA, makeDeps, makeEnv } from "../../engine/test/fixtures";

const ICON = "data:image/svg+xml;base64,PHN2Zy8+";
const mobileDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await wait(5);
  }
}

async function setup(url = "https://dapp.test/app") {
  const opened: string[] = [];
  const vault = new FakeVault();
  const engine = new WalletEngine(makeDeps(vault), new MemoryKV(), makeEnv((id) => void opened.push(id)));
  engine.start();
  await engine.handle({ type: "createWallet", password: "a long test password" });

  const win = new HappyWindow({ url, settings: { disableJavaScriptEvaluation: false } }) as unknown as Window & { eval(js: string): unknown; happyDOM?: unknown };
  let currentUrl = url;
  const bridge = createWebViewBridge({
    attach: (port, origin) => engine.attachDappPort(port, origin),
    // WebView.injectJavaScript runs asynchronously in the page.
    inject: (js) => void setTimeout(() => win.eval(js), 0),
    inpageJs: INPAGE_JS,
    channel: "clip-test-channel",
    networks: [SEPOLIA, BASE_SEPOLIA],
    identity: { name: "Clip Wallet", icon: ICON, rdns: "org.coldai.clipwallet" },
  });
  // react-native-webview (patched, see MOB-02 below): window.ReactNativeWebView.postMessage from the top frame →
  // onMessage({ data, url: <main frame URL>, isMainFrame: true }).
  (win as unknown as { ReactNativeWebView: { postMessage(d: string): void } }).ReactNativeWebView = {
    postMessage: (d) => setTimeout(() => bridge.onMessage(d, currentUrl, true), 0),
  };
  bridge.onNavigation(url);
  // happy-dom evaluates scripts in a VM context whose window global is not the Window object it reports as
  // MessageEvent.source; give the page browser postMessage semantics (async, source === window).
  win.eval(
    "window.postMessage = function (data) { var w = window; setTimeout(function () { w.dispatchEvent(new MessageEvent('message', { data: data, source: w, origin: location.origin })); }, 0); };",
  );
  win.eval(bridge.injectedBeforeLoad);
  return { engine, vault, bridge, win, opened, navigate: (u: string) => ((currentUrl = u), bridge.onNavigation(u)) };
}

/** What a dapp does: EIP-6963 discovery. */
function discover(win: Window) {
  const found: { info: { name: string; rdns: string; uuid: string }; provider: { request(a: { method: string; params?: unknown }): Promise<unknown> } }[] = [];
  win.addEventListener("eip6963:announceProvider", (e: Event) => found.push((e as CustomEvent).detail));
  win.dispatchEvent(new win.Event("eip6963:requestProvider"));
  return found;
}

describe("in-app browser: 1Mask in a WebView, origin from the native side", () => {
  it("announces via EIP-6963 and completes connect + personal_sign after the user approves", async () => {
    const { engine, vault, win, opened } = await setup();
    const [wallet] = await until(() => {
      const f = discover(win);
      return f.length ? f : undefined;
    });
    expect(wallet!.info.name).toBe("Clip Wallet");
    expect(wallet!.info.rdns).toBe("org.coldai.clipwallet");

    expect(await wallet!.provider.request({ method: "eth_chainId" })).toMatch(/^0x/);
    const accountsP = wallet!.provider.request({ method: "eth_requestAccounts" });
    const connectId = await until(() => opened[0]);
    const connect = await engine.handle({ type: "getApproval", id: connectId });
    expect(connect).toMatchObject({ kind: "connect", dapp: { domain: "dapp.test", verified: true } });
    await engine.handle({ type: "approve", id: connectId });
    expect(await accountsP).toEqual([EVM_ADDRESS]);

    const sigP = wallet!.provider.request({ method: "personal_sign", params: ["0x68656c6c6f", EVM_ADDRESS] });
    const signId = await until(() => opened[1]);
    const view = await engine.handle({ type: "getApproval", id: signId });
    expect(view?.decoded?.title).toBe("Sign in to dapp.test");
    await engine.handle({ type: "approve", id: signId });
    expect(await sigP).toBe(`0x${"07".repeat(64)}1c`);
    expect(vault.signed).toHaveLength(1);
  });

  it("ignores an origin the page claims and uses the WebView's URL", async () => {
    const { engine, win, opened } = await setup("https://evil.test/");
    const rn = (win as unknown as { ReactNativeWebView: { postMessage(d: string): void } }).ReactNativeWebView;
    rn.postMessage(JSON.stringify({ clip1mask: { type: "request", id: "x1", origin: "https://dapp.test", family: "evm", method: "eth_requestAccounts" } }));
    const id = await until(() => opened[0]);
    const view = await engine.handle({ type: "getApproval", id });
    expect(view?.dapp.origin).toBe("https://evil.test");
    expect(view?.dapp.verified).toBe(false);
  });

  it("drops messages from a URL other than the main frame's, and closes the port on navigation", async () => {
    const { bridge, engine, opened, navigate } = await setup();
    bridge.onMessage(JSON.stringify({ clip1mask: { type: "request", id: "x2", family: "evm", method: "eth_requestAccounts" } }), "https://other.test/", true);
    await wait(20);
    expect(opened).toHaveLength(0);
    expect(engine).toBeDefined();
    bridge.onMessage(JSON.stringify({ clip1mask: { type: "request", id: "x3", family: "evm", method: "eth_chainId" } }), "https://dapp.test/app", true);
    await wait(10);
    expect(bridge.origin).toBe("https://dapp.test");
    navigate("https://next.test/");
    expect(bridge.origin).toBeNull();
  });

  it("only http(s) pages talk to the wallet; plain http only for local development hosts", () => {
    expect(webOrigin("https://app.uniswap.org/swap")).toBe("https://app.uniswap.org");
    expect(webOrigin("http://localhost:8787/")).toBe("http://localhost:8787");
    expect(webOrigin("http://example.com/")).toBeNull();
    expect(webOrigin("about:blank")).toBeNull();
    expect(webOrigin("data:text/html,hi")).toBeNull();
    expect(webOrigin("javascript:alert(1)")).toBeNull();
  });
});

describe("audit MOB-01: plain http only for real LAN addresses", () => {
  it("accepts private IP literals and refuses public names that merely start like one", () => {
    expect(webOrigin("http://10.0.0.2:3000/")).toBe("http://10.0.0.2:3000");
    expect(webOrigin("http://192.168.1.20/")).toBe("http://192.168.1.20");
    expect(webOrigin("http://10.evil.com/")).toBeNull();
    expect(webOrigin("http://192.168.1.1.attacker.net/")).toBeNull();
    expect(webOrigin("http://printer.local/")).toBeNull();
  });
});

describe("audit MOB-02: only the top frame talks to the wallet, and only through the frame-aware bridge", () => {
  const request = (id: string) => JSON.stringify({ clip1mask: { type: "request", id, family: "evm", method: "eth_requestAccounts" } });

  it("drops a message from a subframe even when the URL matches the top page (Android's old JS-interface bridge reports the top URL)", async () => {
    const { bridge, opened } = await setup();
    bridge.onMessage(request("f1"), "https://dapp.test/app", false);
    await wait(20);
    expect(opened).toHaveLength(0); // no connect approval was opened for it
  });

  it("fails closed when the native side doesn't say which frame sent it (an unpatched or fallback bridge)", async () => {
    const { bridge, opened } = await setup();
    (bridge.onMessage as (d: string, u: string) => void)(request("f2"), "https://dapp.test/app");
    await wait(20);
    expect(opened).toHaveLength(0);
  });

  it("serves the top frame", async () => {
    const { bridge, opened } = await setup();
    bridge.onMessage(request("f3"), "https://dapp.test/app", true);
    await until(() => opened[0]);
    expect(bridge.origin).toBe("https://dapp.test");
  });

  it("the installed react-native-webview is patched: no addJavascriptInterface fallback, subframes dropped, isMainFrame sent", () => {
    const req = createRequire(join(mobileDir, "package.json"));
    const pkg = dirname(req.resolve("react-native-webview/package.json"));
    const android = readFileSync(join(pkg, "android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java"), "utf8");
    const code = android.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/addJavascriptInterface\s*\(/);
    expect(code).toMatch(/if\s*\(!isMainFrame\)\s*return;/);
    expect(code).toMatch(/putBoolean\("isMainFrame", isMainFrame\)/);
    const ios = readFileSync(join(pkg, "apple/RNCWebViewImpl.m"), "utf8");
    expect(ios).toMatch(/if \(!message\.frameInfo\.isMainFrame\) return;/);
    expect(ios).toMatch(/@"isMainFrame": @YES/);
  });
});
