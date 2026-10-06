import { describe, expect, it } from "vitest";
import { describePermissions, parseManifest, ManifestError } from "../src/manifest.js";
import { InstallError, MAX_TARBALL_BYTES, prepareInstallFromNpm, untar } from "../src/npm.js";
import { parseFromSandbox, parseFromHost } from "../src/messages.js";
import { PluginRegistry, PLUGIN_KEYS } from "../src/registry.js";
import { PluginsService } from "../src/service.js";
import { SANDBOX_CSP, SANDBOX_MANIFEST } from "../src/sandbox.js";
import { exampleManifest, exampleSource, fakeRegistry, manifestFor, sha256, sri, tgz } from "./helpers.js";
import { gunzipSync } from "node:zlib";

const NAME = "clip-plugin-address-label";

function examplePackage(over: { manifest?: unknown; bundle?: string; pkg?: unknown } = {}) {
  return tgz({
    "package/package.json": JSON.stringify(over.pkg ?? { name: NAME, version: "1.0.0" }),
    "package/clip.plugin.json": JSON.stringify(over.manifest ?? exampleManifest()),
    "package/dist/bundle.js": over.bundle ?? exampleSource(),
  });
}

describe("manifest", () => {
  it("the example plugin's manifest is valid and its sha256 matches its bundle", () => {
    const m = parseManifest(exampleManifest());
    expect(m.bundle.sha256).toBe(sha256(exampleSource()));
    expect(describePermissions(m)).toEqual([
      'See the requests you\'re asked to approve and add notes to them. Notes are marked "from Address labels".',
      "It can never sign, move your funds, or see your recovery phrase or keys.",
    ]);
  });

  it.each([
    ["no capability", { permissions: {} }],
    ["an unknown permission (there is no signing permission)", { permissions: { transactionInsight: true, sign: true } }],
    ["a built-in suffix", { permissions: { nameResolution: { suffixes: [".eth"] } } }],
    ["a web TLD", { permissions: { nameResolution: { suffixes: [".com"] } } }],
    ["an http origin", { permissions: { transactionInsight: true, network: ["http://api.example"] } }],
    ["an origin with a path", { permissions: { transactionInsight: true, network: ["https://api.example/x"] } }],
    ["a wildcard origin", { permissions: { transactionInsight: true, network: ["https://*.example"] } }],
    // Audit PLG-01: private network addresses and local-only names.
    ["a private IP origin", { permissions: { transactionInsight: true, network: ["https://192.168.1.1"] } }],
    ["a loopback IP origin", { permissions: { transactionInsight: true, network: ["https://127.0.0.1"] } }],
    ["a .local origin", { permissions: { transactionInsight: true, network: ["https://router.local"] } }],
    ["a bundle outside the package", { bundle: { path: "../evil.js", sha256: "0".repeat(64) } }],
    ["a hidden-character name", { name: "Safe‮elbat" }],
    ["unknown top-level keys", { extra: 1 }],
  ])("rejects %s", (_why, over) => {
    expect(() => parseManifest({ ...(exampleManifest() as object), ...over })).toThrow(ManifestError);
  });

  it("warns plainly when a plugin that sees requests can also reach the network", () => {
    const m = manifestFor("x", { transactionInsight: true, network: ["https://api.labels.example"] });
    expect(describePermissions(m)).toContain("Connect to api.labels.example. It could send what it sees there.");
  });
});

describe("install from npm", () => {
  it("audit PLG-02: stops downloading a tarball past the size limit instead of reading all of it", async () => {
    let sent = 0;
    let cancelled = false;
    const chunk = new Uint8Array(65_536);
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 50_000_000) return c.close();
        sent += chunk.length;
        c.enqueue(chunk.slice());
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }); // no read-ahead: `sent` is exactly what the reader asked for
    const reg = fakeRegistry(NAME, "1.0.0", examplePackage());
    const f = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(".tgz") ? new Response(endless) : reg.f(input, init)) as typeof fetch;
    await expect(prepareInstallFromNpm(NAME, { fetch: f })).rejects.toMatchObject({ code: "too-large" });
    expect(sent).toBeLessThanOrEqual(MAX_TARBALL_BYTES + chunk.length);
    expect(cancelled).toBe(true);
  });

  it("audit PLG-02: refuses a tarball whose Content-Length is over the limit without reading it", async () => {
    let read = false;
    const body = new ReadableStream<Uint8Array>({ pull: () => void (read = true) }, { highWaterMark: 0 });
    const reg = fakeRegistry(NAME, "1.0.0", examplePackage());
    const f = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(".tgz") ? new Response(body, { headers: { "content-length": String(MAX_TARBALL_BYTES + 1) } }) : reg.f(input, init)) as typeof fetch;
    await expect(prepareInstallFromNpm(NAME, { fetch: f })).rejects.toMatchObject({ code: "too-large" });
    expect(read).toBe(false);
  });

  it("verifies npm's sha512 integrity, the package identity and the bundle sha256", async () => {
    const tar = examplePackage();
    const reg = fakeRegistry(NAME, "1.0.0", tar);
    const p = await prepareInstallFromNpm(NAME, { fetch: reg.f });
    expect(p).toMatchObject({ id: NAME, version: "1.0.0", integrity: sri(tar) });
    expect(p.manifest.name).toBe("Address labels");
    expect(p.source).toBe(exampleSource());
    expect(reg.urls).toEqual([`https://registry.npmjs.org/${NAME}`, `https://registry.npmjs.org/${NAME}/-/${NAME}-1.0.0.tgz`]);
  });

  it("untar reads what our fixture writer (ustar, like npm pack) produces", () => {
    const files = untar(new Uint8Array(gunzipSync(examplePackage())));
    expect([...files.keys()]).toEqual(["package/package.json", "package/clip.plugin.json", "package/dist/bundle.js"]);
  });

  const cases: [string, () => ReturnType<typeof fakeRegistry>, InstallError["code"]][] = [
    ["a tarball that doesn't match npm's integrity", () => fakeRegistry(NAME, "1.0.0", examplePackage(), { integrity: sri(examplePackage({ bundle: "x" })) }), "integrity"],
    ["a non-sha512 integrity", () => fakeRegistry(NAME, "1.0.0", examplePackage(), { integrity: "sha1-abc" }), "integrity"],
    ["a bundle that doesn't match the manifest", () => fakeRegistry(NAME, "1.0.0", examplePackage({ bundle: exampleSource() + "\n// changed" })), "integrity"],
    ["a tarball hosted elsewhere", () => fakeRegistry(NAME, "1.0.0", examplePackage(), { tarballUrl: "https://evil.example/x.tgz" }), "bad-package"],
    ["a package.json naming another package", () => fakeRegistry(NAME, "1.0.0", examplePackage({ pkg: { name: "other", version: "1.0.0" } })), "bad-package"],
    ["an invalid manifest", () => fakeRegistry(NAME, "1.0.0", examplePackage({ manifest: { ...(exampleManifest() as object), permissions: {} } })), "bad-manifest"],
  ];
  it.each(cases)("refuses %s", async (_w, make, code) => {
    await expect(prepareInstallFromNpm(NAME, { fetch: make().f })).rejects.toMatchObject({ code });
  });

  it("refuses invalid package names without a network call", async () => {
    const reg = fakeRegistry(NAME, "1.0.0", examplePackage());
    await expect(prepareInstallFromNpm("../../etc/passwd", { fetch: reg.f })).rejects.toMatchObject({ code: "bad-name" });
    await expect(prepareInstallFromNpm("Capital", { fetch: reg.f })).rejects.toMatchObject({ code: "bad-name" });
    expect(reg.urls).toEqual([]);
  });

  it("not found on npm", async () => {
    const reg = fakeRegistry(NAME, "1.0.0", examplePackage());
    await expect(prepareInstallFromNpm("clip-plugin-nope", { fetch: reg.f })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("message schema validation", () => {
  it("drops unknown, extended, oversized or disguised messages from a sandbox", () => {
    expect(parseFromSandbox({ type: "ready", handlers: ["onTransaction"] })).not.toBeNull();
    expect(parseFromSandbox({ type: "sign", payload: "0x" })).toBeNull();
    expect(parseFromSandbox({ type: "ready", handlers: ["onTransaction"], vault: true })).toBeNull();
    expect(parseFromSandbox({ type: "ready", handlers: ["onSign"] })).toBeNull();
    expect(parseFromSandbox({ type: "notify", text: "x".repeat(141) })).toBeNull();
    expect(parseFromSandbox({ type: "notify", text: "Approve ‮now" })).toBeNull();
    expect(parseFromSandbox({ type: "result", id: "c1", ok: true, value: "x".repeat(300_000) })).toBeNull();
    expect(parseFromSandbox("ready")).toBeNull();
    expect(parseFromSandbox(null)).toBeNull();
  });

  it("the sandbox drops anything but load/invoke/fetch-result", () => {
    expect(parseFromHost({ type: "eval", source: "1" })).toBeNull();
    expect(parseFromHost({ type: "invoke", id: "c1", handler: "onSign", params: {} })).toBeNull();
    expect(parseFromHost({ type: "invoke", id: "c1", handler: "onNameLookup", params: { name: "a.label" } })).not.toBeNull();
  });
});

describe("sandbox manifest", () => {
  it("CSP: sandboxed, scripts only from the extension, no network, never same-origin", () => {
    expect(SANDBOX_CSP.startsWith("sandbox allow-scripts;")).toBe(true);
    expect(SANDBOX_CSP).not.toMatch(/allow-same-origin|allow-forms|allow-popups|allow-top-navigation|allow-modals/);
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("script-src 'self' 'unsafe-eval'");
    expect(SANDBOX_MANIFEST.sandbox.pages).toEqual(["plugin-sandbox.html"]);
  });
});

function memKv() {
  const m = new Map<string, unknown>();
  return { m, kv: { get: async <T,>(k: string) => m.get(k) as T | undefined, set: async <T,>(k: string, v: T) => void m.set(k, structuredClone(v)) } };
}

describe("registry: off by default, Advanced mode only, explicit confirm", () => {
  it("is off by default and nothing runs", async () => {
    const { kv } = memKv();
    const r = new PluginRegistry({ kv, advanced: async () => true });
    expect(await r.status()).toMatchObject({ enabled: false, active: false, plugins: [] });
    expect(await r.runnable()).toEqual([]);
  });

  it("refuses to install or switch on outside Advanced mode", async () => {
    const { kv } = memKv();
    const svc = new PluginsService(new PluginRegistry({ kv, advanced: async () => false }));
    await expect(svc.handle({ type: "pluginsSetEnabled", enabled: true })).rejects.toMatchObject({ code: "plugins/advanced-only" });
    await expect(svc.handle({ type: "pluginsPrepareInstall", name: NAME })).rejects.toMatchObject({ code: "plugins/advanced-only" });
  });

  it("installs only after confirm, for the exact version shown; Advanced off stops everything", async () => {
    const { kv, m } = memKv();
    let advanced = true;
    const reg = fakeRegistry(NAME, "1.0.0", examplePackage());
    const r = new PluginRegistry({ kv, advanced: async () => advanced, npm: { fetch: reg.f } });
    const svc = new PluginsService(r);
    await svc.handle({ type: "pluginsSetEnabled", enabled: true });
    const pending = (await svc.handle({ type: "pluginsPrepareInstall", name: NAME })) as { id: string; version: string; permissions: string[] };
    expect(pending.permissions.at(-1)).toMatch(/never sign/);
    expect(await r.runnable()).toEqual([]);
    await expect(svc.handle({ type: "pluginsConfirmInstall", id: NAME, version: "2.0.0" })).rejects.toMatchObject({ code: "plugins/no-pending" });
    await svc.handle({ type: "pluginsConfirmInstall", id: pending.id, version: pending.version });
    expect((await r.runnable()).map((p) => p.id)).toEqual([NAME]);
    expect(JSON.stringify(m.get(PLUGIN_KEYS.state))).toContain("Address labels");
    advanced = false;
    expect(await r.runnable()).toEqual([]);
  });

  it("rejects malformed bus messages", async () => {
    const { kv } = memKv();
    const svc = new PluginsService(new PluginRegistry({ kv, advanced: async () => true }));
    await expect(svc.handle({ type: "pluginsRemove" })).rejects.toMatchObject({ code: "plugins/bad-request" });
    expect(svc.handles("pluginsStatus")).toBe(true);
    expect(svc.handles("vaultExport")).toBe(false);
  });
});
