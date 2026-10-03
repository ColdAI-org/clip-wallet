/**
 * Glue for the extension:
 *
 *  - `PluginsService` (background): zod-validated `plugins*` bus messages from the UI → PluginRegistry.
 *  - `HostBridgeServer` (offscreen host document): `pluginHost*` messages from the background → PluginHost.
 *  - `toInsightInput`: what a plugin is shown of a DecodedRequest (title, lines, balance changes, network,
 *    origin, the account's public address). Never the raw payload, keys or anything from the vault.
 */
import type { DecodedRequest } from "@clip-wallet/core";
import { z } from "zod";
import type { InstalledPlugin, PluginHost, PluginInsight, PluginNameResult } from "./host.js";
import type { InsightInput } from "./messages.js";
import { type PluginRegistry, PluginRegistryError } from "./registry.js";

/* ------------------------------------------------------------------ UI ↔ background */

export const PluginsRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pluginsStatus") }).strict(),
  z.object({ type: z.literal("pluginsSetEnabled"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("pluginsPrepareInstall"), name: z.string().min(1).max(214) }).strict(),
  z.object({ type: z.literal("pluginsConfirmInstall"), id: z.string().min(1).max(214), version: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal("pluginsCancelInstall") }).strict(),
  z.object({ type: z.literal("pluginsRemove"), id: z.string().min(1).max(214) }).strict(),
  z.object({ type: z.literal("pluginsSetPluginEnabled"), id: z.string().min(1).max(214), enabled: z.boolean() }).strict(),
]);
export type PluginsRequest = z.infer<typeof PluginsRequestSchema>;

export const PLUGINS_REQUEST_TYPES: ReadonlySet<string> = new Set(PluginsRequestSchema.options.map((o) => o.shape.type.value));

/** Thrown to the bus as a plain-words error (structurally a ClipError: userMessage + code). */
export class PluginsUserError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

export class PluginsService {
  constructor(private readonly registry: PluginRegistry) {}

  handles(type: string): boolean {
    return PLUGINS_REQUEST_TYPES.has(type);
  }

  async handle(raw: unknown): Promise<unknown> {
    const r = PluginsRequestSchema.safeParse(raw);
    if (!r.success) throw new PluginsUserError("That request wasn't understood.", "plugins/bad-request");
    const m = r.data;
    try {
      switch (m.type) {
        case "pluginsStatus":
          return await this.registry.status();
        case "pluginsSetEnabled":
          return await this.registry.setEnabled(m.enabled);
        case "pluginsPrepareInstall":
          return await this.registry.prepareInstall(m.name);
        case "pluginsConfirmInstall":
          return await this.registry.confirmInstall(m.id, m.version);
        case "pluginsCancelInstall":
          return this.registry.cancelInstall();
        case "pluginsRemove":
          return await this.registry.remove(m.id);
        case "pluginsSetPluginEnabled":
          return await this.registry.setPluginEnabled(m.id, m.enabled);
      }
    } catch (e) {
      if (e instanceof PluginRegistryError) throw new PluginsUserError(e.userMessage, e.code);
      throw e;
    }
  }
}

/* ------------------------------------------------------------------ background ↔ offscreen host */

export type HostBridgeRequest =
  | { type: "pluginHostSync"; plugins: InstalledPlugin[] }
  | { type: "pluginHostInsights"; input: InsightInput }
  | { type: "pluginHostResolveName"; name: string };

/** Runs in the offscreen document next to the PluginHost. */
export class HostBridgeServer {
  constructor(private readonly host: PluginHost) {}

  /** Makes the running set equal `plugins` (starts new ones, stops removed/disabled ones). */
  async sync(plugins: InstalledPlugin[]): Promise<{ started: string[]; failed: { id: string; message: string }[] }> {
    const want = new Set(plugins.map((p) => p.id));
    for (const id of this.host.runningIds()) if (!want.has(id)) this.host.stop(id);
    const started: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const p of plugins) {
      if (this.host.isRunning(p.id)) continue;
      try {
        await this.host.start(p);
        started.push(p.id);
      } catch (e) {
        failed.push({ id: p.id, message: (e as Error).message });
      }
    }
    return { started, failed };
  }

  async handle(m: HostBridgeRequest): Promise<unknown> {
    switch (m.type) {
      case "pluginHostSync":
        return this.sync(m.plugins);
      case "pluginHostInsights":
        return this.host.insights(m.input);
      case "pluginHostResolveName":
        return this.host.resolveName(m.name);
    }
  }
}

/** What an insight plugin sees of a request. */
export function toInsightInput(decoded: DecodedRequest, origin: string, account: string): InsightInput {
  return {
    origin: origin.slice(0, 300),
    title: decoded.title.slice(0, 300),
    lines: decoded.lines.slice(0, 50).map((l) => ({ label: l.label.slice(0, 200), value: l.value.slice(0, 2000) })),
    balanceChanges: decoded.balanceChanges.slice(0, 50).map((b) => ({ asset: (b.asset.address ? `${b.asset.symbol} (${b.asset.address})` : b.asset.symbol).slice(0, 200), delta: b.delta.slice(0, 80) })),
    networkId: decoded.networkId.slice(0, 100),
    account: account.slice(0, 128),
  };
}

/** A DecodedRequest plus plugin notes. The wallet's own fields are never modified by plugins. */
export type DecodedWithPlugins = DecodedRequest & { pluginInsights?: PluginInsight[] };

export function withPluginInsights(decoded: DecodedRequest, insights: PluginInsight[]): DecodedWithPlugins {
  return insights.length ? { ...decoded, pluginInsights: insights } : decoded;
}

export type { PluginInsight, PluginNameResult };
