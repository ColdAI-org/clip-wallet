import { ses } from "./ses.js";
import { describe, expect, it } from "vitest";
import type { DecodedRequest } from "@clip-wallet/core";
import { PluginHost } from "../src/host.js";
import { parseManifest } from "../src/manifest.js";
import { HostBridgeServer, toInsightInput, withPluginInsights } from "../src/service.js";
import { exampleManifest, exampleSource, memoryChannels } from "./helpers.js";

const decoded = (to: string): DecodedRequest => ({
  requestId: "r1",
  title: `Send 1 ETH to ${to}`,
  lines: [{ label: "To", value: to }],
  balanceChanges: [{ asset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: "eip155:11155111" }, delta: "-1000000000000000000" }],
  simulated: true,
  blind: false,
  warnings: [],
  networkId: "eip155:11155111",
});

describe("example plugin: Address labels", () => {
  const plugin = { id: "clip-plugin-address-label", version: "1.0.0", manifest: parseManifest(exampleManifest()), source: exampleSource(), integrity: "sha512-x", installedAt: 0, enabled: true };

  it("labels the burn address in an approval, marked as from the plugin; the wallet's own fields are untouched", async () => {
    const { factory } = memoryChannels(ses);
    const bridge = new HostBridgeServer(new PluginHost({ channels: factory }));
    expect(await bridge.sync([plugin])).toEqual({ started: [plugin.id], failed: [] });
    const d = decoded("0x000000000000000000000000000000000000dEaD");
    const insights = (await bridge.handle({ type: "pluginHostInsights", input: toInsightInput(d, "https://app.example", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94") })) as Awaited<ReturnType<PluginHost["insights"]>>;
    const out = withPluginInsights(d, insights);
    expect(out.pluginInsights).toEqual([
      {
        pluginId: plugin.id,
        pluginName: "Address labels",
        from: "from Address labels",
        lines: [{ label: "Address", value: "Burn address" }],
        warnings: [{ level: "danger", message: "Funds sent to the burn address are gone for good." }],
      },
    ]);
    expect(out.lines).toEqual(d.lines);
    expect(out.warnings).toEqual([]);
    expect(out.title).toBe(d.title);
  });

  it("says nothing about ordinary addresses, and sync([]) stops it", async () => {
    const { factory } = memoryChannels(ses);
    const host = new PluginHost({ channels: factory });
    const bridge = new HostBridgeServer(host);
    await bridge.sync([plugin]);
    expect(await host.insights(toInsightInput(decoded("0x9858EfFD232B4033E47d90003D41EC34EcaEda94"), "https://a.example", "0x1"))).toEqual([]);
    await bridge.sync([]);
    expect(host.runningIds()).toEqual([]);
  });
});
