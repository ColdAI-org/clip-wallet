/**
 * Phase 2.5 wiring in the background: the security hooks (connect warnings, approval refine, spam hiding,
 * WalletConnect's isKnownScam, the sec* bus), Clip Plugins (off by default, gated by Advanced mode, insights kept
 * apart from the wallet's own analysis, a stuck plugin host is closed) and backup social sign-in.
 */
import { describe, expect, it, vi } from "vitest";
import type { DappRequest, DecodedRequest, Network, Warning } from "@clip-wallet/core";
import { hideKey } from "@clip-wallet/security";
import { PLUGIN_KEYS, type InstalledPlugin } from "@clip-wallet/plugins";
import { makeService, PASSWORD } from "./helpers";
import { createPlugins, type OffscreenApi } from "../src/background/plugins";
import { MemoryKV } from "../src/shared/storage";

const PHISHING: Warning = { level: "danger", code: "phishing-site", message: "This site is on a phishing list." };
const POISONED: Warning = { level: "danger", code: "address-poisoning", message: "This address only looks like one you used." };

function fakeSecurity(hidden = new Set<string>()) {
  const calls: string[] = [];
  return {
    calls,
    handle: vi.fn(async (m: { type: string }) => {
      calls.push(m.type);
      return m.type === "secThreatStatus" ? [] : { ok: true };
    }),
    refine: vi.fn(async (_r: DappRequest, d: DecodedRequest, _n: Network, _a: string) => ({ ...d, warnings: [...d.warnings, POISONED] })),
    assessSite: vi.fn(async (origin: string) => (origin.includes("magiceden") ? [PHISHING] : [])),
    threat: { isKnownScam: (o: string) => o === "https://scam.example" },
    cleanup: { hidden: async () => hidden },
  };
}

async function ready(pluginHost: OffscreenApi | null = null) {
  const ctx = makeService({ pluginHost });
  await ctx.service.handle({ type: "createWallet", password: PASSWORD });
  return ctx;
}

describe("security hooks", () => {
  it("are off without a security service: sec* answers plainly", async () => {
    const { service } = await ready();
    await expect(service.handle({ type: "secThreatStatus" })).rejects.toMatchObject({ code: "security/off" });
    expect(service.isKnownScam("https://scam.example")).toBe(false);
  });

  it("puts site warnings on the connect approval and refines every transaction", async () => {
    const { service } = await ready();
    const sec = fakeSecurity();
    service.attachSecurity(sec as never);
    const cid = await service.handle({ type: "devSimulateRequest", kind: "connect" });
    const connect = (await service.handle({ type: "getApproval", id: cid }))!;
    expect(connect.connect!.warnings).toEqual([PHISHING]);
    const pid = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const pay = (await service.handle({ type: "getApproval", id: pid }))!;
    expect(sec.refine).toHaveBeenCalledTimes(1);
    expect(pay.decoded!.warnings.map((w) => w.code)).toContain("address-poisoning");
    expect(service.isKnownScam("https://scam.example")).toBe(true);
    await service.handle({ type: "secThreatStatus" });
    expect(sec.calls).toEqual(["secThreatStatus"]);
  });

  it("hides tokens the user cleaned up from the portfolio", async () => {
    const { service } = await ready();
    const before = await service.handle({ type: "getPortfolio" });
    const token = before.balances.find((b) => b.asset.address)!;
    service.attachSecurity(fakeSecurity(new Set([hideKey(token.asset.networkId, token.asset.address!)])) as never);
    const after = await service.handle({ type: "getPortfolio", refresh: true });
    expect(after.balances.some((b) => b.asset.networkId === token.asset.networkId && b.asset.address === token.asset.address)).toBe(false);
    expect(after.balances.length).toBe(before.balances.length - 1);
  });
});

/* ------------------------------------------------------------------ plugins */

const PLUGIN: InstalledPlugin = {
  id: "clip-plugin-labels",
  version: "1.0.0",
  manifest: { name: "Labels", permissions: { transactionInsight: true, nameResolution: { suffixes: [".label"] } } } as never,
  source: "export default {}",
  integrity: "sha512-x",
  installedAt: 0,
  enabled: true,
};

function fakeHost(answer: (request: { type: string }) => unknown) {
  let open = false;
  const sent: string[] = [];
  const api: OffscreenApi & { sent: string[]; isOpen: () => boolean } = {
    sent,
    isOpen: () => open,
    hasDocument: async () => open,
    create: async () => void (open = true),
    close: async () => void (open = false),
    send: async (m) => {
      sent.push(m.request.type);
      return answer(m.request);
    },
  };
  return api;
}

describe("Clip Plugins in the background", () => {
  it("run nothing until Advanced mode and the Plugins switch are both on, and stop when Advanced goes off", async () => {
    const host = fakeHost(() => ({ started: [], failed: [] }));
    const { service, kv } = await ready(host);
    await kv.set(PLUGIN_KEYS.state, { enabled: true, plugins: [PLUGIN] });
    await service.plugins.sync();
    expect(host.isOpen()).toBe(false);
    expect((await service.handle({ type: "pluginsStatus" })).active).toBe(false);

    await service.handle({ type: "setPrefs", patch: { advanced: true } });
    await vi.waitFor(() => expect(host.sent).toContain("pluginHostSync"));
    expect(host.isOpen()).toBe(true);
    expect(service.plugins.suffixes()).toEqual([".label"]);

    await service.handle({ type: "setPrefs", patch: { advanced: false } });
    await vi.waitFor(() => expect(host.isOpen()).toBe(false));
    expect(service.plugins.suffixes()).toEqual([]);
  });

  it("attaches insights beside the wallet's analysis (never inside it), and never for blind requests", async () => {
    const insight = { pluginId: PLUGIN.id, pluginName: "Labels", from: "from Labels", lines: [{ label: "Label", value: "Burn address" }], warnings: [] };
    const host = fakeHost((r) => (r.type === "pluginHostInsights" ? [insight] : { started: [PLUGIN.id], failed: [] }));
    const { service, kv } = await ready(host);
    await kv.set(PLUGIN_KEYS.state, { enabled: true, plugins: [PLUGIN] });
    await service.handle({ type: "setPrefs", patch: { advanced: true } });
    await vi.waitFor(() => expect(service.plugins.suffixes()).toEqual([".label"]));

    const id = await service.handle({ type: "devSimulateRequest", kind: "pay" });
    const view = (await service.handle({ type: "getApproval", id }))!;
    expect((view.decoded as { pluginInsights?: unknown[] }).pluginInsights).toEqual([insight]);
    expect(view.decoded!.lines.some((l) => l.value === "Burn address")).toBe(false);

    const blind = await service.handle({ type: "devSimulateRequest", kind: "blind" });
    expect(((await service.handle({ type: "getApproval", id: blind }))!.decoded as { pluginInsights?: unknown[] }).pluginInsights).toBeUndefined();
  });

  it("closes the plugin host when a plugin doesn't answer in time", async () => {
    const host = fakeHost((r) => (r.type === "pluginHostInsights" ? new Promise(() => undefined) : { started: [], failed: [] }));
    const kv = new MemoryKV();
    await kv.set(PLUGIN_KEYS.state, { enabled: true, plugins: [PLUGIN] });
    const plugins = createPlugins(kv, async () => ({ advanced: true }), host);
    await plugins.sync();
    expect(host.isOpen()).toBe(true);
    const t0 = Date.now();
    expect(await plugins.insights({ origin: "https://x.example", title: "t", lines: [], balanceChanges: [], networkId: "eip155:1", account: "0x0" })).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(host.isOpen()).toBe(false);
  });

  it("errors from the plugin registry reach the page in plain words", async () => {
    const { service } = await ready(fakeHost(() => null));
    await expect(service.handle({ type: "pluginsSetEnabled", enabled: true })).rejects.toMatchObject({ code: "plugins/advanced-only" });
  });
});

describe("backup social sign-in", () => {
  it("reports every provider off when this build has no backup service", async () => {
    const { service } = await ready();
    expect(await service.handle({ type: "backupProviders" })).toEqual({ email: false, google: false, apple: false });
    await expect(service.handle({ type: "backupSocialSignIn", provider: "google" })).rejects.toMatchObject({ code: "backup/provider-unavailable" });
  });
});
