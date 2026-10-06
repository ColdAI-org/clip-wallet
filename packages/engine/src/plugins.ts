/**
 * Clip Plugins on the engine (mobile). The host builds the plugins (registry, sandboxes) and attaches them with
 * `engine.attachPlugins(p)`; the engine only:
 *  - routes the `plugins*` UI messages to `service` (zod-validated there), unlocked only;
 *  - asks running insight plugins about each readable request and attaches their notes as
 *    `decoded.pluginInsights` (never merged into the wallet's own lines or warnings);
 *  - re-syncs after a prefs change (Advanced mode gates every plugin).
 * Same rules as the extension's background (packages/extension-kit/src/background/plugins.ts).
 *
 * @module
 */
import type { InsightInput, PluginInsight, PluginsService } from "@clip-wallet/plugins";

export interface EnginePlugins {
  readonly service: Pick<PluginsService, "handles" | "handle">;
  /** Starts/stops plugins to match Advanced mode + the Plugins switch. */
  sync(): Promise<void>;
  /** Notes from running insight plugins; [] when none, on timeout or on error. */
  insights(input: InsightInput): Promise<PluginInsight[]>;
}
