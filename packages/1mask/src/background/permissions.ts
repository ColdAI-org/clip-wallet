import type { Family } from "@clip-wallet/core";

/**
 * Per-origin, per-family connection permission. "Connected" means the user approved revealing that
 * family's accounts to the origin. Persist it however the extension likes (chrome.storage).
 */
export interface PermissionStore {
  has(origin: string, family: Family): boolean | Promise<boolean>;
  grant(origin: string, family: Family): void | Promise<void>;
  revoke(origin: string, family: Family): void | Promise<void>;
  /** Origins holding any permission (used for event fan-out after account changes). Optional. */
  origins?(): string[] | Promise<string[]>;
}

export function createMemoryPermissionStore(initial: Iterable<[string, Family]> = []): PermissionStore & {
  entries(): [string, Family][];
} {
  const set = new Set<string>();
  const key = (o: string, f: Family) => `${f}\u0000${o}`;
  for (const [o, f] of initial) set.add(key(o, f));
  return {
    has: (o, f) => set.has(key(o, f)),
    grant: (o, f) => void set.add(key(o, f)),
    revoke: (o, f) => void set.delete(key(o, f)),
    origins: () => [...new Set([...set].map((k) => k.slice(k.indexOf("\u0000") + 1)))],
    entries: () =>
      [...set].map((k) => {
        const i = k.indexOf("\u0000");
        return [k.slice(i + 1), k.slice(0, i) as Family];
      }),
  };
}
