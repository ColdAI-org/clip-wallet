/**
 * Clip Plugins on the phone: the mobile counterpart of the extension's background/plugins.ts + offscreen host.
 * Pure TypeScript (no React Native imports); test/plugins-host.vitest.ts runs it with the real runtime under SES.
 *
 *   registry   installed plugins + the switch (PluginRegistry), in app storage; runs nothing
 *   host       PluginHost (hash check before load, granted handlers only, schema-checked replies labelled
 *              "from <plugin>", 1.5 s per call, two misses stop the plugin, notification + network limits)
 *   channels   one hidden WebView per plugin (channels.ts + PluginSandboxes.tsx); a stopped plugin's WebView unmounts
 *
 * Nothing from the vault or app storage reaches a sandbox: it gets its own source, its grant, and
 * `toInsightInput(decoded, origin, address)` per request. Plugins run only while Advanced mode AND the Plugins
 * switch are on (`registry.runnable()`); `sync()` is called on attach, on every registry change and when Advanced
 * mode changes (engine.setPrefs).
 */
import {
  HostBridgeServer,
  PluginHost,
  PluginRegistry,
  PluginsService,
  type ChannelFactory,
  type InsightInput,
  type InstalledPlugin,
  type NpmOptions,
  type PluginInsight,
  type PluginKV,
  type PluginNameResult,
  type PluginNotification,
} from "@clip-wallet/plugins";

export const INSIGHT_TIMEOUT_MS = 2000;
export const SYNC_TIMEOUT_MS = 10_000;

export interface MobilePluginsOptions {
  kv: PluginKV;
  /** The wallet's Advanced-mode preference. */
  advanced: () => Promise<boolean>;
  channels: ChannelFactory;
  /** Install downloads (npm) and plugins' granted network (exact https origins, made here, never in the sandbox). */
  fetch?: typeof fetch;
  /** gunzip for npm tarballs (Hermes has no DecompressionStream): gunzip.ts. */
  gunzip?: NpmOptions["gunzip"];
  onNotify?: (n: PluginNotification) => void;
  callTimeoutMs?: number;
  loadTimeoutMs?: number;
}

export interface MobilePlugins {
  readonly service: PluginsService;
  readonly host: PluginHost;
  sync(): Promise<void>;
  insights(input: InsightInput): Promise<PluginInsight[]>;
  resolveName(name: string): Promise<PluginNameResult | null>;
  /** Name suffixes claimed by running plugins (the name resolver asks plugins only for these). */
  suffixes(): string[];
}

function race<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<"timeout">((r) => (t = setTimeout(() => r("timeout"), ms)))]).finally(() => clearTimeout(t));
}

export function createMobilePlugins(o: MobilePluginsOptions): MobilePlugins {
  let running: InstalledPlugin[] = [];
  const host = new PluginHost({
    channels: o.channels,
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.onNotify ? { onNotify: o.onNotify } : {}),
    ...(o.callTimeoutMs ? { callTimeoutMs: o.callTimeoutMs } : {}),
    ...(o.loadTimeoutMs ? { loadTimeoutMs: o.loadTimeoutMs } : {}),
  });
  const bridge = new HostBridgeServer(host);
  const registry = new PluginRegistry({
    kv: o.kv,
    advanced: o.advanced,
    npm: { ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.gunzip ? { gunzip: o.gunzip } : {}) },
    changed: () => void sync().catch(() => undefined),
  });

  /** A stuck plugin can't hold the wallet: drop every sandbox (their WebViews unmount). */
  const stopEverything = () => {
    host.stopAll();
    running = [];
  };

  // One sync at a time: two overlapping syncs would start the same plugin twice.
  let chain: Promise<void> = Promise.resolve();
  function sync(): Promise<void> {
    chain = chain.then(async () => {
      const want = await registry.runnable();
      if (!want.length) return stopEverything();
      const r = await race(bridge.sync(want), SYNC_TIMEOUT_MS);
      if (r === "timeout") return stopEverything();
      running = want.filter((p) => host.isRunning(p.id));
    });
    return chain;
  }

  return {
    service: new PluginsService(registry),
    host,
    sync,
    async insights(input) {
      if (!running.some((p) => p.manifest.permissions.transactionInsight)) return [];
      const r = await race(host.insights(input), INSIGHT_TIMEOUT_MS).catch(() => [] as PluginInsight[]);
      if (r === "timeout") {
        stopEverything();
        return [];
      }
      return r;
    },
    async resolveName(name) {
      if (!running.some((p) => p.manifest.permissions.nameResolution)) return null;
      const r = await race(host.resolveName(name), INSIGHT_TIMEOUT_MS).catch(() => null);
      return r === "timeout" ? null : r;
    },
    suffixes: () => running.flatMap((p) => p.manifest.permissions.nameResolution?.suffixes ?? []),
  };
}
