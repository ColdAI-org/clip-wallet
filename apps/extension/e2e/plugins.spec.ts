/**
 * Clip Plugins in real Chrome (default build): the offscreen host page frames the manifest sandbox page, SES locks
 * the frame down, and the example plugin (packages/plugins/examples/address-label) answers an insight request sent
 * from the service worker over the same runtime messages the background uses (background/plugins.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extensionTest, expect, onboard, openPage, REAL_BUILD } from "./fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(here, "../../../packages/plugins/examples/address-label");
const test = extensionTest(REAL_BUILD);

test("plugin host + sandbox: the example plugin runs under SES and labels the burn address", async ({ context, extensionId }) => {
  const host = await openPage(context, extensionId, "plugin-host.html");
  const manifest = JSON.parse(readFileSync(path.join(EXAMPLE, "clip.plugin.json"), "utf8"));
  const source = readFileSync(path.join(EXAMPLE, "dist/bundle.js"), "utf8");
  const plugin = { id: "clip-plugin-address-label", version: "1.0.0", manifest, source, integrity: "sha512-x", installedAt: 0, enabled: true };
  const [sw] = context.serviceWorkers();
  const send = (request: unknown) => sw!.evaluate((r) => (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome.runtime.sendMessage({ target: "plugin-host", request: r }), request);

  const synced = (await send({ type: "pluginHostSync", plugins: [plugin] })) as { started: string[]; failed: unknown[] };
  expect(synced).toEqual({ started: [plugin.id], failed: [] });
  // One sandboxed iframe per plugin, on the sandbox page (opaque origin, no extension APIs).
  await expect(host.locator('iframe[src$="plugin-sandbox.html"]')).toHaveCount(1);

  const insights = await send({
    type: "pluginHostInsights",
    input: { origin: "https://app.example", title: "Send 1 ETH", lines: [{ label: "To", value: "0x000000000000000000000000000000000000dEaD" }], balanceChanges: [], networkId: "eip155:11155111", account: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94" },
  });
  expect(insights).toEqual([
    expect.objectContaining({ pluginName: "Address labels", from: "from Address labels", lines: [{ label: "Address", value: "Burn address" }] }),
  ]);
  await host.close();
});

test("background: plugins start in an offscreen document only with Advanced mode on, and stop when it goes off", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "tab.html");
  await onboard(page); // plugin settings need an unlocked wallet
  const manifest = JSON.parse(readFileSync(path.join(EXAMPLE, "clip.plugin.json"), "utf8"));
  const source = readFileSync(path.join(EXAMPLE, "dist/bundle.js"), "utf8");
  const plugin = { id: "clip-plugin-address-label", version: "1.0.0", manifest, source, integrity: "sha512-x", installedAt: 0, enabled: true };
  const [sw] = context.serviceWorkers();
  type Chrome = { storage: { local: { set(v: unknown): Promise<void> } }; runtime: { getContexts(f: unknown): Promise<unknown[]>; sendMessage(m: unknown): Promise<unknown> } };
  const offscreen = () => sw!.evaluate(async () => (await (globalThis as unknown as { chrome: Chrome }).chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length);
  // An installed, enabled plugin with the Plugins switch on (as PluginRegistry stores it), Advanced mode still off.
  await sw!.evaluate((p) => (globalThis as unknown as { chrome: Chrome }).chrome.storage.local.set({ "clip/plugins": { enabled: true, plugins: [p] } }), plugin);
  const bus = (m: unknown) => page.evaluate((msg) => (globalThis as unknown as { chrome: Chrome }).chrome.runtime.sendMessage(msg), m);
  expect(await bus({ type: "pluginsStatus" })).toMatchObject({ ok: true, data: { advanced: false, enabled: true, active: false } });
  expect(await offscreen()).toBe(0);

  await bus({ type: "setPrefs", patch: { advanced: true } });
  await expect.poll(offscreen).toBe(1);
  expect(await bus({ type: "pluginsStatus" })).toMatchObject({ ok: true, data: { active: true, plugins: [expect.objectContaining({ name: "Address labels" })] } });

  await bus({ type: "setPrefs", patch: { advanced: false } });
  await expect.poll(offscreen).toBe(0);
});
