/**
 * PluginHost: the wallet's side of every running plugin. Lives in the offscreen host document (see
 * docs/phase25/integration/extensibility.md); talks to each plugin's sandbox over a Channel and nothing else.
 *
 * What it enforces, regardless of what the plugin does:
 *  - the stored bundle still matches the manifest's sha256 before it is loaded;
 *  - only granted handlers are called; every reply is schema-checked (messages.ts) and labelled with the
 *    plugin's name ("from Address labels") so it can't pass for the wallet's own analysis;
 *  - per-call timeouts; a plugin that stops answering is shut down;
 *  - notifications: at most NOTIFY_LIMITS per plugin;
 *  - network: only GET to the manifest's exact https origins, no credentials, no redirects, size-capped.
 */
import type { PluginManifest } from "./manifest.js";
import {
  type Grant,
  type InsightInput,
  type SandboxToHost,
  InsightOutputSchema,
  LIMITS,
  NameOutputSchema,
  parseFromSandbox,
} from "./messages.js";
import { pluginIdOf, sha256Hex } from "./npm.js";
import type { Channel, ChannelFactory } from "./sandbox.js";

export interface InstalledPlugin {
  /** npm package name. */
  id: string;
  version: string;
  manifest: PluginManifest;
  source: string;
  integrity: string;
  installedAt: number;
  enabled: boolean;
}

/** One plugin's contribution to an approval. Rendered apart from the wallet's own lines, under `from`. */
export interface PluginInsight {
  pluginId: string;
  pluginName: string;
  /** "from Address labels" — always shown with the lines. */
  from: string;
  lines: { label: string; value: string }[];
  warnings: { level: "info" | "caution" | "danger"; message: string }[];
}

export interface PluginNameResult {
  name: string;
  address: string;
  family: string;
  pluginId: string;
  pluginName: string;
  from: string;
}

export interface PluginNotification {
  pluginId: string;
  pluginName: string;
  from: string;
  text: string;
}

export const NOTIFY_LIMITS = { perHour: 3, perDay: 10 } as const;
const FETCH_PER_MINUTE = 30;

export interface PluginHostOptions {
  channels: ChannelFactory;
  fetch?: typeof fetch;
  onNotify?: (n: PluginNotification) => void;
  now?: () => number;
  /** Per handler call. Default 1500 ms (an approval never waits longer for plugins). */
  callTimeoutMs?: number;
  loadTimeoutMs?: number;
}

interface Running {
  plugin: InstalledPlugin;
  channel: Channel;
  handlers: Set<"onTransaction" | "onNameLookup">;
  pending: Map<string, (m: Extract<SandboxToHost, { type: "result" }> | null) => void>;
  notifyTimes: number[];
  fetchTimes: number[];
  timeouts: number;
}

export class PluginError extends Error {
  constructor(
    readonly code: "tampered" | "load-failed" | "not-responding",
    message: string,
  ) {
    super(message);
  }
}

export function grantOf(m: PluginManifest): Grant {
  return {
    transactionInsight: !!m.permissions.transactionInsight,
    nameResolution: !!m.permissions.nameResolution,
    notifications: !!m.permissions.notifications,
    network: !!m.permissions.network,
  };
}

const fromLabel = (name: string) => `from ${name}`;

export class PluginHost {
  private readonly running = new Map<string, Running>();
  private readonly now: () => number;
  private seq = 0;

  constructor(private readonly o: PluginHostOptions) {
    this.now = o.now ?? Date.now;
  }

  runningIds(): string[] {
    return [...this.running.keys()];
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  async start(plugin: InstalledPlugin): Promise<void> {
    if (this.running.has(plugin.id)) return;
    if ((await sha256Hex(plugin.source)) !== plugin.manifest.bundle.sha256) {
      throw new PluginError("tampered", `${plugin.manifest.name} changed since it was installed, so it wasn't started. Remove it and install it again.`);
    }
    const channel = this.o.channels(pluginIdOf(plugin.id));
    const r: Running = { plugin, channel, handlers: new Set(), pending: new Map(), notifyTimes: [], fetchTimes: [], timeouts: 0 };
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new PluginError("not-responding", `${plugin.manifest.name} didn't start.`)), this.o.loadTimeoutMs ?? 5000);
      channel.onMessage((raw) => {
        const m = parseFromSandbox(raw);
        if (!m) return; // malformed: dropped
        if (m.type === "ready") {
          clearTimeout(timer);
          const grant = grantOf(plugin.manifest);
          for (const h of m.handlers) {
            if ((h === "onTransaction" && grant.transactionInsight) || (h === "onNameLookup" && grant.nameResolution)) r.handlers.add(h);
          }
          resolve();
        } else if (m.type === "load-failed") {
          clearTimeout(timer);
          reject(new PluginError("load-failed", `${plugin.manifest.name} couldn't start.`));
        } else this.onMessage(r, m);
      });
    });
    channel.send({ type: "load", pluginId: pluginIdOf(plugin.id), source: plugin.source, grant: grantOf(plugin.manifest) });
    try {
      await ready;
    } catch (e) {
      channel.destroy();
      throw e;
    }
    this.running.set(plugin.id, r);
  }

  stop(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    for (const p of r.pending.values()) p(null);
    r.channel.destroy();
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  private onMessage(r: Running, m: SandboxToHost) {
    if (m.type === "result") {
      const p = r.pending.get(m.id);
      if (p) {
        r.pending.delete(m.id);
        p(m);
      }
    } else if (m.type === "notify") {
      if (!r.plugin.manifest.permissions.notifications) return;
      const t = this.now();
      r.notifyTimes = r.notifyTimes.filter((x) => t - x < 24 * 3600_000);
      const lastHour = r.notifyTimes.filter((x) => t - x < 3600_000).length;
      if (lastHour >= NOTIFY_LIMITS.perHour || r.notifyTimes.length >= NOTIFY_LIMITS.perDay) return;
      r.notifyTimes.push(t);
      this.o.onNotify?.({ pluginId: r.plugin.id, pluginName: r.plugin.manifest.name, from: fromLabel(r.plugin.manifest.name), text: m.text });
    } else if (m.type === "fetch") {
      void this.proxyFetch(r, m.id, m.url);
    }
  }

  /** The only network a plugin gets: GET to an origin listed in its manifest, made by the host. */
  private async proxyFetch(r: Running, id: string, url: string) {
    const deny = () => r.channel.send({ type: "fetch-result", id, ok: false, status: 0, body: "" });
    const allowed = r.plugin.manifest.permissions.network ?? [];
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return deny();
    }
    if (u.protocol !== "https:" || !allowed.includes(u.origin) || u.username || u.password) return deny();
    const t = this.now();
    r.fetchTimes = r.fetchTimes.filter((x) => t - x < 60_000);
    if (r.fetchTimes.length >= FETCH_PER_MINUTE) return deny();
    r.fetchTimes.push(t);
    try {
      const f = this.o.fetch ?? globalThis.fetch.bind(globalThis);
      const res = await f(u.toString(), { method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
      const body = (await res.text()).slice(0, LIMITS.maxFetchBody);
      if (this.running.get(r.plugin.id) !== r) return;
      r.channel.send({ type: "fetch-result", id, ok: res.ok, status: Math.min(599, Math.max(0, res.status)), body });
    } catch {
      deny();
    }
  }

  private call(r: Running, handler: "onTransaction" | "onNameLookup", params: unknown): Promise<unknown | undefined> {
    const id = `c${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        r.pending.delete(id);
        if (++r.timeouts >= 2) this.stop(r.plugin.id);
        resolve(undefined);
      }, this.o.callTimeoutMs ?? 1500);
      r.pending.set(id, (m) => {
        clearTimeout(timer);
        if (m) r.timeouts = 0;
        resolve(m && m.ok ? m.value : undefined);
      });
      r.channel.send({ type: "invoke", id, handler, params } as never);
    });
  }

  /** Asks every running insight plugin, in parallel. Failures and timeouts are dropped silently. */
  async insights(input: InsightInput): Promise<PluginInsight[]> {
    const list = [...this.running.values()].filter((r) => r.handlers.has("onTransaction"));
    const results = await Promise.all(
      list.map(async (r) => {
        const v = await this.call(r, "onTransaction", input);
        // The sandbox already validated, but the host never trusts it: re-validate here.
        const ok = v === undefined ? null : InsightOutputSchema.safeParse(v);
        if (!ok?.success) return null;
        const lines = ok.data.lines ?? [];
        const warnings = ok.data.warnings ?? [];
        if (!lines.length && !warnings.length) return null;
        const name = r.plugin.manifest.name;
        return { pluginId: r.plugin.id, pluginName: name, from: fromLabel(name), lines, warnings } satisfies PluginInsight;
      }),
    );
    return results.filter((x): x is PluginInsight => !!x);
  }

  /** Only plugins that declared the name's suffix are asked; the first answer wins (install order). */
  async resolveName(name: string): Promise<PluginNameResult | null> {
    const n = name.trim().toLowerCase();
    for (const r of this.running.values()) {
      const sfx = r.plugin.manifest.permissions.nameResolution?.suffixes ?? [];
      if (!r.handlers.has("onNameLookup") || !sfx.some((s) => n.endsWith(s) && n.length > s.length)) continue;
      const v = await this.call(r, "onNameLookup", { name: n });
      const ok = v === undefined ? null : NameOutputSchema.safeParse(v);
      if (ok?.success && ok.data) {
        const pn = r.plugin.manifest.name;
        return { name: n, address: ok.data.address, family: ok.data.family, pluginId: r.plugin.id, pluginName: pn, from: fromLabel(pn) };
      }
    }
    return null;
  }
}
