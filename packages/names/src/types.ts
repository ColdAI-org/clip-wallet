import type { Family, NetworkId } from "@clip-wallet/core";

/** "plugin" (Phase 2.5, additive): answered by a Clip Plugin; see `ResolvedName.via`. "clip": a Clip handle. */
export type NameService = "ens" | "sns" | "hns" | "plugin" | "clip";

export interface ResolvedName {
  /** The name as typed, normalised ("alice.eth"). */
  name: string;
  /** What the money goes to: 0x…, base58, or a Hedera "0.0.x". */
  address: string;
  family: Family;
  /**
   * Networks the name points at specifically (CAIP-2). Empty means "any network of this family": the Send
   * screen then picks the network as it does for a pasted address (and asks if that is ambiguous).
   */
  networkIds: NetworkId[];
  service: NameService;
  /**
   * ENS only: networks where the name has its own, different address record (ENSIP-11 coinType). Send must
   * use this address when paying on that network.
   */
  addressOn?: Record<NetworkId, string>;
  /** Shown next to the address ("alice.eth"). */
  displayName: string;
  /** Phase 2.5 (additive): set when a plugin answered; Send shows it as "from <plugin>". */
  via?: { pluginId: string; pluginName: string; from: string };
  /**
   * Clip handles (additive): the handle's published address per family. Send uses the one for the asset's
   * family (`byFamily[family] ?? address`); `address`/`family` are the first published (EVM first).
   */
  byFamily?: Partial<Record<Family, string>>;
  /** Clip handles: who owns it and since when. `recentlyRegistered` → Send shows a caution. */
  handle?: { owner: string; registeredAt: number; updatedAt: number; recentlyRegistered: boolean };
}

/**
 * Structurally compatible with packages/extension-kit/src/background/wiring.ts `NameResolver`
 * (`resolve(name) → { address, displayName } | null`), plus the family/networks the name implies.
 */
export interface NameResolver {
  /** Returns null when the name doesn't exist or isn't set to an address. Throws ClipError when the service can't be reached. */
  resolve(name: string): Promise<ResolvedName | null>;
  /** Primary name for an address (ENS primary name, SNS favourite domain, HNS default name), or null. */
  reverse(address: string, family: Family, networkId?: NetworkId): Promise<string | null>;
  /** Which service would handle this input, without a network call. */
  serviceFor(name: string): NameService | null;
}

export interface Backend {
  readonly service: NameService;
  handles(name: string): boolean;
  resolve(name: string): Promise<ResolvedName | null>;
  reverse?(address: string, family: Family, networkId?: NetworkId): Promise<string | null>;
}
