/**
 * Names answered by Clip Plugins (@clip-wallet/plugins). Put this backend LAST in MultiNameResolver so a plugin
 * can never answer for a name a built-in service handles (.eth, .sol, .hbar); the plugin manifest also refuses
 * those suffixes. Results carry `via` so Send shows "from <plugin>" next to the address.
 */
import { FAMILIES, type Family } from "@clip-wallet/core";
import type { Backend, ResolvedName } from "./types.js";

/** Structural match for PluginHost.resolveName (through the background ↔ offscreen bridge). */
export type PluginLookup = (name: string) => Promise<{ name: string; address: string; family: string; pluginId: string; pluginName: string; from: string } | null>;

export class PluginBackend implements Backend {
  readonly service = "plugin" as const;

  constructor(
    private readonly lookup: PluginLookup,
    /** Suffixes claimed by running plugins (e.g. [".label"]). */
    private readonly suffixes: () => readonly string[],
  ) {}

  handles(name: string): boolean {
    const n = name.trim().toLowerCase();
    return this.suffixes().some((s) => n.endsWith(s) && n.length > s.length);
  }

  async resolve(name: string): Promise<ResolvedName | null> {
    const r = await this.lookup(name.trim().toLowerCase()).catch(() => null);
    if (!r || !(FAMILIES as readonly string[]).includes(r.family)) return null;
    return {
      name: r.name,
      address: r.address,
      family: r.family as Family,
      networkIds: [],
      service: "plugin",
      displayName: `${r.name} (${r.from})`,
      via: { pluginId: r.pluginId, pluginName: r.pluginName, from: r.from },
    };
  }
}
