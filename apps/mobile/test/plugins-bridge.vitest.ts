/**
 * The WebView wire for Clip Plugins, without SES (plugins-sandbox.vitest.ts runs the real page under SES):
 * the strict schema both ways, the about:blank origin check, the boot queue, per-frame keys, destroy/crash,
 * the navigation rule, and the generated sandbox page's CSP.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { LIMITS } from "@clip-wallet/plugins";
import { SANDBOX_URL, allowSandboxLoad, decodeFromSandbox, encodeForSandbox } from "../src/plugins/protocol";
import { createWebViewChannels } from "../src/plugins/channels";
import { PLUGIN_SANDBOX_CSP, PLUGIN_SANDBOX_HTML, PLUGIN_SANDBOX_JS } from "../src/plugins/sandbox.generated";

const GRANT = { transactionInsight: true, nameResolution: false, notifications: false, network: false };

describe("protocol", () => {
  it("only schema-valid host messages are sent", () => {
    expect(encodeForSandbox({ type: "load", pluginId: "p1", source: "1", grant: GRANT })).toBe(JSON.stringify({ type: "load", pluginId: "p1", source: "1", grant: GRANT }));
    expect(encodeForSandbox({ type: "load", pluginId: "bad id!", source: "1", grant: GRANT })).toBeNull();
    expect(encodeForSandbox({ type: "load", pluginId: "p1", source: "1", grant: GRANT, vault: "x" } as never)).toBeNull();
    expect(encodeForSandbox({ type: "invoke", id: "c1", handler: "onSign", params: {} } as never)).toBeNull();
  });

  it("drops sandbox messages from any page but about:blank, oversized, non-JSON or outside the schema", () => {
    const ok = JSON.stringify({ type: "ready", handlers: ["onTransaction"] });
    expect(decodeFromSandbox(ok, SANDBOX_URL)).toEqual({ type: "ready", handlers: ["onTransaction"] });
    expect(decodeFromSandbox(ok, "https://evil.example/")).toBeNull();
    expect(decodeFromSandbox(ok, "about:srcdoc")).toBeNull();
    expect(decodeFromSandbox(ok, undefined)).toBeNull();
    expect(decodeFromSandbox({ type: "ready", handlers: [] }, SANDBOX_URL)).toBeNull();
    expect(decodeFromSandbox("{not json", SANDBOX_URL)).toBeNull();
    expect(decodeFromSandbox(JSON.stringify({ type: "notify", text: "x".repeat(LIMITS.maxMessageBytes) }), SANDBOX_URL)).toBeNull();
    expect(decodeFromSandbox(JSON.stringify({ type: "ready", handlers: ["onSign"] }), SANDBOX_URL)).toBeNull();
    expect(decodeFromSandbox(JSON.stringify({ type: "sign", payload: "0x" }), SANDBOX_URL)).toBeNull();
    // A notification can't hide text with bidi overrides.
    expect(decodeFromSandbox(JSON.stringify({ type: "notify", text: "pay ‮evil" }), SANDBOX_URL)).toBeNull();
    expect(decodeFromSandbox(JSON.stringify({ type: "result", id: "c1", ok: true, value: 1, extra: 1 }), SANDBOX_URL)).toBeNull();
  });

  it("the WebView may only load the inline sandbox page", () => {
    expect(allowSandboxLoad({ url: "about:blank" })).toBe(true);
    for (const url of ["https://example.com/", "http://localhost:8787/", "file:///etc/hosts", "data:text/html,hi", "javascript:alert(1)", "about:srcdoc", "clipwallet://wc?uri=x"]) {
      expect(allowSandboxLoad({ url }), url).toBe(false);
    }
    expect(allowSandboxLoad({ url: "about:blank", isTopFrame: false })).toBe(false);
  });
});

describe("channels", () => {
  function frameWith() {
    const ch = createWebViewChannels();
    const channel = ch.factory("clip-plugin-x");
    const [frame] = ch.frames();
    const got: unknown[] = [];
    const posted: string[] = [];
    channel.onMessage((m) => got.push(m));
    return { ch, channel, frame: frame!, got, posted };
  }

  it("queues until the page boots, then delivers in order; replies only through the frame's own key", () => {
    const { ch, channel, frame, got, posted } = frameWith();
    channel.send({ type: "load", pluginId: "p1", source: "1", grant: GRANT });
    ch.attach(frame.key, (d) => posted.push(d));
    expect(posted).toEqual([]);
    ch.receive(frame.key, JSON.stringify({ type: "booted" }), SANDBOX_URL);
    expect(posted.map((p) => JSON.parse(p).type)).toEqual(["load"]);
    channel.send({ type: "invoke", id: "c1", handler: "onNameLookup", params: { name: "abc.label" } });
    expect(posted).toHaveLength(2);
    ch.receive("someone-else#9", JSON.stringify({ type: "ready", handlers: [] }), SANDBOX_URL);
    ch.receive(frame.key, JSON.stringify({ type: "ready", handlers: [] }), "https://evil.example/");
    ch.receive(frame.key, JSON.stringify({ type: "ready", handlers: [] }), SANDBOX_URL);
    expect(got).toEqual([{ type: "booted" }, { type: "ready", handlers: [] }]);
  });

  it("destroy unmounts the WebView and silences it; a restart gets a fresh frame", () => {
    const { ch, channel, frame, got } = frameWith();
    let renders = 0;
    ch.subscribe(() => renders++);
    channel.destroy();
    expect(ch.frames()).toEqual([]);
    expect(renders).toBe(1);
    ch.receive(frame.key, JSON.stringify({ type: "booted" }), SANDBOX_URL);
    expect(got).toEqual([]);
    ch.factory("clip-plugin-x");
    expect(ch.frames()[0]!.key).not.toBe(frame.key);
  });

  it("a crashed WebView (render process gone) is dropped", () => {
    const { ch, frame } = frameWith();
    ch.crashed(frame.key);
    expect(ch.frames()).toEqual([]);
  });
});

describe("generated sandbox page", () => {
  it("allows only its own script (by hash) and eval, and no network, frames, workers or forms", () => {
    const hash = createHash("sha256").update(PLUGIN_SANDBOX_JS, "utf8").digest("base64");
    const csp = Object.fromEntries(PLUGIN_SANDBOX_CSP.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]));
    expect(csp["default-src"]).toBe("'none'");
    expect(csp["script-src"]).toBe(`'sha256-${hash}' 'unsafe-eval'`);
    for (const d of ["connect-src", "img-src", "style-src", "font-src", "media-src", "object-src", "frame-src", "child-src", "worker-src", "form-action", "base-uri"]) expect(csp[d], d).toBe("'none'");
    expect(PLUGIN_SANDBOX_CSP).not.toMatch(/unsafe-inline|https?:|\*/);
    expect(PLUGIN_SANDBOX_HTML).toContain(`<meta http-equiv="Content-Security-Policy" content="${PLUGIN_SANDBOX_CSP}">`);
    // Exactly one script, inline, and the bundle can't close it early.
    expect(PLUGIN_SANDBOX_HTML.match(/<script/g)).toHaveLength(1);
    expect(PLUGIN_SANDBOX_JS).not.toMatch(/<\/script/i);
    // Nothing outside the inline script loads anything.
    const shell = PLUGIN_SANDBOX_HTML.replace(PLUGIN_SANDBOX_JS, "");
    expect(shell).not.toMatch(/src=|href=|<link|<iframe|<img/i);
  });
});
