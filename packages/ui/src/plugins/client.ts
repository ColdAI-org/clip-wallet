/**
 * Phase 2.5: Clip Plugins in the UI ↔ background contract. Optional until wired
 * (docs/phase25/integration/extensibility.md). Views are structurally @clip-wallet/plugins' registry views,
 * restated so the UI needs no new dependency.
 */
import type { WalletClient } from "../client";

export interface PluginView {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: string[];
  enabled: boolean;
  installedAt: number;
}

export interface PendingPluginView extends PluginView {
  integrity: string;
}

export interface PluginsStatusView {
  advanced: boolean;
  enabled: boolean;
  active: boolean;
  plugins: PluginView[];
}

/** A plugin's notes on a request; always rendered under `from`, apart from the wallet's own analysis. */
export interface PluginInsightView {
  pluginId: string;
  pluginName: string;
  from: string;
  lines: { label: string; value: string }[];
  warnings: { level: "info" | "caution" | "danger"; message: string }[];
}

export interface PluginsClient {
  pluginsStatus(): Promise<PluginsStatusView>;
  pluginsSetEnabled(p: { enabled: boolean }): Promise<void>;
  /** Downloads from npm and verifies (integrity + manifest + bundle hash). Installs nothing. */
  pluginsPrepareInstall(p: { name: string }): Promise<PendingPluginView>;
  /** The user said yes to the prompt for exactly this package and version. */
  pluginsConfirmInstall(p: { id: string; version: string }): Promise<PluginView>;
  pluginsCancelInstall(): Promise<void>;
  pluginsRemove(p: { id: string }): Promise<void>;
  pluginsSetPluginEnabled(p: { id: string; enabled: boolean }): Promise<void>;
}

/** The plugins part of the client, or null when this build doesn't have plugins wired. */
export function asPlugins(client: WalletClient): PluginsClient | null {
  const c = client as Partial<PluginsClient>;
  return typeof c.pluginsStatus === "function" ? (client as unknown as PluginsClient) : null;
}
