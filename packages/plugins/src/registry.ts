/**
 * Installed plugins and the on/off switch. Lives in the background (it owns storage; plugins never see it).
 *
 * Plugins are OFF by default and only ever run when both are true:
 *   - Advanced mode is on (Settings → Advanced), and
 *   - "Plugins" is switched on (Settings → Advanced → Plugins).
 * Turning either off stops every plugin. Installing needs an explicit confirm after the permission prompt.
 */
import { capabilitiesOf, describePermissions, type PluginCapabilities } from "./manifest.js";
import type { InstalledPlugin } from "./host.js";
import { InstallError, prepareInstallFromNpm, type NpmOptions, type PendingInstall } from "./npm.js";

export interface PluginKV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

export const PLUGIN_KEYS = { state: "clip/plugins" } as const;
export const MAX_PLUGINS = 10;

interface StoredState {
  enabled: boolean;
  plugins: InstalledPlugin[];
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Plain-words permission lines (same as the install prompt). */
  permissions: string[];
  /** The same permissions as data, for a translated prompt. */
  capabilities?: PluginCapabilities;
  enabled: boolean;
  installedAt: number;
}

export interface PendingInstallView extends PluginView {
  integrity: string;
}

export interface PluginsStatusView {
  /** Advanced mode is on (plugins are only offered there). */
  advanced: boolean;
  /** The Plugins switch. */
  enabled: boolean;
  /** advanced && enabled: plugins actually run. */
  active: boolean;
  plugins: PluginView[];
}

export interface PluginRegistryDeps {
  kv: PluginKV;
  /** Reads the wallet's Advanced-mode preference. */
  advanced: () => Promise<boolean>;
  npm?: NpmOptions;
  now?: () => number;
  /** Called after anything that changes what should run (the background re-syncs the host). */
  changed?: () => void;
}

export class PluginRegistryError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
  ) {
    super(userMessage);
  }
}

function view(p: InstalledPlugin): PluginView {
  return {
    id: p.id,
    name: p.manifest.name,
    version: p.version,
    author: p.manifest.author,
    description: p.manifest.description,
    permissions: describePermissions(p.manifest),
    capabilities: capabilitiesOf(p.manifest),
    enabled: p.enabled,
    installedAt: p.installedAt,
  };
}

export class PluginRegistry {
  private pending: PendingInstall | null = null;
  private readonly now: () => number;

  constructor(private readonly d: PluginRegistryDeps) {
    this.now = d.now ?? Date.now;
  }

  private async state(): Promise<StoredState> {
    return (await this.d.kv.get<StoredState>(PLUGIN_KEYS.state)) ?? { enabled: false, plugins: [] };
  }

  private async save(s: StoredState) {
    await this.d.kv.set(PLUGIN_KEYS.state, s);
    this.d.changed?.();
  }

  private async requireAdvanced() {
    if (!(await this.d.advanced())) throw new PluginRegistryError("plugins/advanced-only", "Turn on Advanced mode in Settings to use plugins.");
  }

  async status(): Promise<PluginsStatusView> {
    const s = await this.state();
    const advanced = await this.d.advanced();
    return { advanced, enabled: s.enabled, active: advanced && s.enabled, plugins: s.plugins.map(view) };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.requireAdvanced();
    await this.save({ ...(await this.state()), enabled });
  }

  /** Downloads and verifies; nothing is installed until confirmInstall(). */
  async prepareInstall(name: string): Promise<PendingInstallView> {
    await this.requireAdvanced();
    const s = await this.state();
    if (s.plugins.length >= MAX_PLUGINS) throw new PluginRegistryError("plugins/too-many", `You can have up to ${MAX_PLUGINS} plugins. Remove one first.`);
    try {
      this.pending = await prepareInstallFromNpm(name, this.d.npm);
    } catch (e) {
      if (e instanceof InstallError) throw new PluginRegistryError(`plugins/${e.code}`, e.message);
      throw new PluginRegistryError("plugins/unreachable", "We couldn't reach npm. Try again.");
    }
    const p = this.pending;
    return {
      id: p.id,
      name: p.manifest.name,
      version: p.version,
      author: p.manifest.author,
      description: p.manifest.description,
      permissions: p.permissions,
      capabilities: capabilitiesOf(p.manifest),
      enabled: true,
      installedAt: 0,
      integrity: p.integrity,
    };
  }

  /** The user said yes to the prompt for exactly this package and version. */
  async confirmInstall(id: string, version: string): Promise<PluginView> {
    await this.requireAdvanced();
    const p = this.pending;
    if (!p || p.id !== id || p.version !== version) throw new PluginRegistryError("plugins/no-pending", "Look the plugin up again before installing it.");
    this.pending = null;
    const s = await this.state();
    const installed: InstalledPlugin = {
      id: p.id,
      version: p.version,
      manifest: p.manifest,
      source: p.source,
      integrity: p.integrity,
      installedAt: this.now(),
      enabled: true,
    };
    await this.save({ ...s, plugins: [...s.plugins.filter((x) => x.id !== p.id), installed] });
    return view(installed);
  }

  cancelInstall(): void {
    this.pending = null;
  }

  async remove(id: string): Promise<void> {
    const s = await this.state();
    await this.save({ ...s, plugins: s.plugins.filter((p) => p.id !== id) });
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    const s = await this.state();
    await this.save({ ...s, plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled } : p)) });
  }

  /** What should be running right now: nothing unless Advanced mode and the Plugins switch are both on. */
  async runnable(): Promise<InstalledPlugin[]> {
    const s = await this.state();
    if (!s.enabled || !(await this.d.advanced())) return [];
    return s.plugins.filter((p) => p.enabled);
  }
}
