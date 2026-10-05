/** Clip Plugins on the engine (mobile): notes ride beside the decode, never for blind requests; plugin bus needs unlock; Advanced re-syncs. */
import { describe, expect, it, vi } from "vitest";
import { PluginRegistry, PluginsService, type InsightInput, type PluginInsight } from "@clip-wallet/plugins";
import { WalletEngine } from "../src/engine.js";
import { MemoryKV } from "../src/kv.js";
import { createEnginePluginsClient } from "../src/client.js";
import { BASE_SEPOLIA, FakeVault, makeDeps, makeEnv } from "./fixtures.js";

const BOB = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const NOTE: PluginInsight = { pluginId: "clip-plugin-x", pluginName: "Labels", from: "from Labels", lines: [{ label: "Address", value: "Burn address" }], warnings: [] };

async function setup() {
  const kv = new MemoryKV();
  const engine = new WalletEngine(makeDeps(new FakeVault()), kv, makeEnv());
  engine.start();
  const seen: InsightInput[] = [];
  const registry = new PluginRegistry({ kv, advanced: async () => (await engine.prefs()).advanced });
  const plugins = {
    service: new PluginsService(registry),
    sync: vi.fn(async () => undefined),
    insights: vi.fn(async (i: InsightInput) => (seen.push(i), [NOTE])),
  };
  engine.attachPlugins(plugins);
  return { engine, plugins, seen };
}

describe("engine + Clip Plugins", () => {
  it("adds plugin notes as pluginInsights, apart from the wallet's own lines and warnings", async () => {
    const { engine, seen } = await setup();
    await engine.handle({ type: "createWallet", password: "a long test password" });
    const id = await engine.handle({ type: "send", assetKey: "eth", networkId: BASE_SEPOLIA.id, to: BOB, amount: "0.1" });
    const view = await engine.handle({ type: "getApproval", id });
    const d = view!.decoded as { pluginInsights?: PluginInsight[]; lines: { value: string }[] };
    expect(d.pluginInsights).toEqual([NOTE]);
    expect(d.lines.some((l) => l.value === "Burn address")).toBe(false);
    // What the plugin saw: the decoded request and the public address, nothing else.
    expect(Object.keys(seen[0]!).sort()).toEqual(["account", "balanceChanges", "lines", "networkId", "origin", "title"]);
  });

  it("routes plugins* messages only while unlocked, and re-syncs when Advanced mode changes", async () => {
    const { engine, plugins } = await setup();
    const client = createEnginePluginsClient(engine);
    await expect(client.pluginsStatus()).rejects.toMatchObject({ code: "vault/locked" });
    await engine.handle({ type: "createWallet", password: "a long test password" });
    expect(await client.pluginsStatus()).toMatchObject({ advanced: false, enabled: false, active: false, plugins: [] });
    await expect(client.pluginsSetEnabled({ enabled: true })).rejects.toMatchObject({ code: "plugins/advanced-only" });
    plugins.sync.mockClear();
    await engine.handle({ type: "setPrefs", patch: { advanced: true } });
    expect(plugins.sync).toHaveBeenCalledTimes(1);
    await client.pluginsSetEnabled({ enabled: true });
    expect(await client.pluginsStatus()).toMatchObject({ advanced: true, enabled: true, active: true });
    await expect(engine.handleUntrusted({ type: "pluginsRemove", id: "x", extra: 1 })).rejects.toMatchObject({ code: "plugins/bad-request" });
  });
});
