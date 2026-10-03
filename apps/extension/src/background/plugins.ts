/**
 * Clip Plugins in the background (docs/phase25/integration/extensibility.md §1c).
 *
 * Plugins run only in the offscreen document (entrypoints/plugin-host), one sandboxed iframe each
 * (entrypoints/plugin-sandbox: opaque origin, no extension APIs, SES). The background:
 *  - keeps the offscreen document open only while something should run (Advanced mode AND the Plugins switch,
 *    `PluginRegistry.runnable()`), and closes it when nothing should;
 *  - asks it for transaction insights / names with a timeout, and closes it on a timeout so a plugin stuck in a
 *    loop can't hold the wallet;
 *  - never passes a plugin anything from the vault: insights get `toInsightInput(decoded, origin, address)`.
 * Firefox has no chrome.offscreen: `available` is false there and the UI says plugins aren't available.
 */
import {
  PluginRegistry,
  PluginsService,
  type HostBridgeRequest,
  type InsightInput,
  type InstalledPlugin,
  type PluginInsight,
  type PluginNameResult,
} from "@clip-wallet/plugins";
import type { KV } from "../shared/storage";

export const PLUGIN_HOST_URL = "plugin-host.html";
export const INSIGHT_TIMEOUT_MS = 2000;
export const SYNC_TIMEOUT_MS = 10_000;

/** The slice of chrome.offscreen + runtime messaging this needs (injected in tests). */
export interface OffscreenApi {
  hasDocument(): Promise<boolean>;
  create(url: string): Promise<void>;
  close(): Promise<void>;
  /** runtime.sendMessage to the offscreen document. */
  send(msg: { target: "plugin-host"; request: HostBridgeRequest }): Promise<unknown>;
}

interface ChromeLike {
  offscreen?: {
    hasDocument?: () => Promise<boolean>;
    createDocument(o: { url: string; reasons: string[]; justification: string }): Promise<void>;
    closeDocument(): Promise<void>;
    Reason?: Record<string, string>;
  };
  runtime: { sendMessage(msg: unknown): Promise<unknown>; getContexts?: (f: { contextTypes: string[] }) => Promise<unknown[]> };
}

/** chrome.offscreen, or null where it doesn't exist (Firefox, tests). */
export function chromeOffscreen(): OffscreenApi | null {
  const c = (globalThis as { chrome?: ChromeLike }).chrome;
  const off = c?.offscreen;
  if (!c || !off) return null;
  return {
    async hasDocument() {
      if (off.hasDocument) return off.hasDocument();
      // Chrome 116+: runtime.getContexts lists the offscreen document.
      const ctx = (await c.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] })) ?? [];
      return ctx.length > 0;
    },
    create: (url) => off.createDocument({ url, reasons: [off.Reason?.IFRAME_SCRIPTING ?? "IFRAME_SCRIPTING"], justification: "Run sandboxed plugins" }),
    close: () => off.closeDocument(),
    send: (msg) => c.runtime.sendMessage(msg),
  };
}

export interface BackgroundPlugins {
  /** Whether this browser can run plugins at all. */
  readonly available: boolean;
  readonly service: PluginsService;
  /** Starts/stops plugins to match the registry (call after prefs change too: Advanced mode gates everything). */
  sync(): Promise<void>;
  /** Notes from running insight plugins; [] when none, on timeout or on error. */
  insights(input: InsightInput): Promise<PluginInsight[]>;
  resolveName(name: string): Promise<PluginNameResult | null>;
  /** Name suffixes claimed by running plugins. */
  suffixes(): string[];
}

export function createPlugins(kv: KV, prefs: () => Promise<{ advanced: boolean }>, api: OffscreenApi | null = chromeOffscreen()): BackgroundPlugins {
  let running: InstalledPlugin[] = [];
  let creating: Promise<void> | undefined;
  const registry = new PluginRegistry({ kv, advanced: async () => (await prefs()).advanced, changed: () => void sync() });

  async function ensureHost(a: OffscreenApi) {
    if (await a.hasDocument()) return;
    // Two callers at once would both try to create it; Chrome allows only one offscreen document.
    creating ??= a.create(PLUGIN_HOST_URL).finally(() => (creating = undefined));
    await creating;
  }

  async function toHost<T>(request: HostBridgeRequest, timeoutMs: number): Promise<T | null> {
    if (!api) return null;
    await ensureHost(api);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), timeoutMs)));
    const res = await Promise.race([api.send({ target: "plugin-host", request }).catch(() => null), timeout]);
    clearTimeout(timer);
    if (res === "timeout") {
      // A plugin that doesn't answer (an endless loop) freezes only the offscreen document: close it.
      await api.close().catch(() => undefined);
      running = [];
      return null;
    }
    return (res ?? null) as T | null;
  }

  async function sync() {
    running = api ? await registry.runnable() : [];
    if (!api) return;
    if (!running.length) {
      if (await api.hasDocument().catch(() => false)) await api.close().catch(() => undefined);
      return;
    }
    await toHost({ type: "pluginHostSync", plugins: running }, SYNC_TIMEOUT_MS);
  }

  return {
    available: !!api,
    service: new PluginsService(registry),
    sync,
    async insights(input) {
      if (!running.some((p) => p.manifest.permissions.transactionInsight)) return [];
      return (await toHost<PluginInsight[]>({ type: "pluginHostInsights", input }, INSIGHT_TIMEOUT_MS)) ?? [];
    },
    async resolveName(name) {
      if (!running.some((p) => p.manifest.permissions.nameResolution)) return null;
      return toHost<PluginNameResult>({ type: "pluginHostResolveName", name }, INSIGHT_TIMEOUT_MS);
    },
    suffixes: () => running.flatMap((p) => p.manifest.permissions.nameResolution?.suffixes ?? []),
  };
}
