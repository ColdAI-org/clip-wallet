/**
 * Adapters from the wallet's own storage to sync records. Each one owns a slice of state that is safe to sync:
 * contacts, account labels and counts, connected apps (origins and which accounts, never secrets), notification
 * preferences, language, display currency, hidden tokens and bookmarks. Keys, phrases, passwords, sessions and
 * approvals never sync.
 *
 * KV keys are the ones the engine / extension service already use (see the comments per source).
 */
import type { LinkKV, SyncSource } from "./client.js";
import type { Collection } from "./records.js";

export const SYNC_KV = {
  prefs: "clip/prefs",
  notifications: "clip/social/notifications",
  accountLabels: "clip/account-labels",
  accountCounts: "clip/account-counts",
  permissions: "clip/permissions",
  hidden: "security/hidden",
  bookmarks: "clip/link/bookmarks",
} as const;

/** A list stored under one KV key, one record per item. */
export function listSource<T>(collection: Collection, kv: LinkKV, key: string, idOf: (t: T) => string, valid: (v: unknown) => v is T): SyncSource {
  return {
    collection,
    async read() {
      const list = (await kv.get<T[]>(key)) ?? [];
      return Object.fromEntries((Array.isArray(list) ? list : []).filter(valid).map((t) => [idOf(t), t]));
    },
    async apply(changes) {
      const list = ((await kv.get<T[]>(key)) ?? []).filter(valid);
      const byId = new Map(list.map((t) => [idOf(t), t] as const));
      for (const c of changes) {
        if (c.value === null) byId.delete(c.id);
        else if (valid(c.value)) byId.set(c.id, c.value);
      }
      await kv.set(key, [...byId.values()]);
    },
  };
}

/** Selected fields of an object stored under one KV key, one record per field. */
export function fieldsSource(collection: Collection, kv: LinkKV, key: string, fields: Record<string, (v: unknown) => boolean>, prefix = ""): SyncSource {
  return {
    collection,
    async read() {
      const obj = (await kv.get<Record<string, unknown>>(key)) ?? {};
      const out: Record<string, unknown> = {};
      for (const f of Object.keys(fields)) if (obj[f] !== undefined) out[prefix + f] = obj[f];
      return out;
    },
    async apply(changes) {
      const obj = { ...((await kv.get<Record<string, unknown>>(key)) ?? {}) };
      for (const c of changes) {
        const f = c.id.slice(prefix.length);
        if (!c.id.startsWith(prefix) || !(f in fields)) continue;
        if (c.value === null) delete obj[f];
        else if (fields[f]!(c.value)) obj[f] = c.value;
      }
      await kv.set(key, obj);
    },
  };
}

/** A string→value map stored under one KV key. `mergeValue` combines on apply (e.g. max for counts). */
export function mapSource(collection: Collection, kv: LinkKV, key: string, prefix: string, valid: (v: unknown) => boolean, mergeValue?: (local: unknown, remote: unknown) => unknown): SyncSource {
  return {
    collection,
    async read() {
      const m = (await kv.get<Record<string, unknown>>(key)) ?? {};
      return Object.fromEntries(Object.entries(m).filter(([, v]) => valid(v)).map(([k, v]) => [prefix + k, v]));
    },
    async apply(changes) {
      const m = { ...((await kv.get<Record<string, unknown>>(key)) ?? {}) };
      for (const c of changes) {
        if (!c.id.startsWith(prefix)) continue;
        const k = c.id.slice(prefix.length);
        if (c.value === null) delete m[k];
        else if (valid(c.value)) m[k] = mergeValue && m[k] !== undefined ? mergeValue(m[k], c.value) : c.value;
      }
      await kv.set(key, m);
    },
  };
}

/** Several sources writing the same collection under different id prefixes. */
export function combine(collection: Collection, parts: SyncSource[]): SyncSource {
  return {
    collection,
    async read() {
      return Object.assign({}, ...(await Promise.all(parts.map((p) => p.read()))));
    },
    async apply(changes) {
      for (const p of parts) await p.apply(changes);
    },
  };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Contacts through the social package's ContactStore (sealed by the vault on this device). */
export function contactsSource(store: { read(): Promise<{ id: string }[]>; write(list: never[]): Promise<void> }): SyncSource {
  return {
    collection: "contacts",
    async read() {
      return Object.fromEntries((await store.read()).filter((c) => isObj(c) && isString(c.id)).map((c) => [c.id, c]));
    },
    async apply(changes) {
      const byId = new Map((await store.read()).map((c) => [c.id, c] as const));
      for (const c of changes) {
        if (c.value === null) byId.delete(c.id);
        else if (isObj(c.value) && c.value.id === c.id) byId.set(c.id, c.value as { id: string });
      }
      await store.write([...byId.values()] as never[]);
    },
  };
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}
export const isBookmark = (v: unknown): v is Bookmark =>
  isObj(v) && isString(v.id) && isString(v.url) && /^https:\/\//.test(v.url) && v.url.length <= 2000 && isString(v.title) && typeof v.addedAt === "number";

/** Every source except contacts (which need the vault's sealed store), over the wallet KV. */
export function walletSources(kv: LinkKV): SyncSource[] {
  return [
    combine("prefs", [
      fieldsSource("prefs", kv, SYNC_KV.prefs, {
        locale: isString,
        displayCurrency: (v) => isString(v) && /^[A-Z]{3}$/.test(v),
      }),
      {
        collection: "prefs",
        async read() {
          const n = await kv.get(SYNC_KV.notifications);
          return n && isObj(n) ? { notifications: n } : {};
        },
        async apply(changes) {
          const c = changes.find((x) => x.id === "notifications");
          if (c && c.value !== null && isObj(c.value)) await kv.set(SYNC_KV.notifications, c.value);
        },
      },
    ]),
    combine("accounts", [
      mapSource("accounts", kv, SYNC_KV.accountLabels, "label:", isString),
      // Never shrink: an account added on another device appears here too.
      mapSource("accounts", kv, SYNC_KV.accountCounts, "count:", (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000, (a, b) => Math.max(Number(a), Number(b))),
    ]),
    listSource<{ id: string; origin: string }>("apps", kv, SYNC_KV.permissions, (p) => p.id, (v): v is { id: string; origin: string } => isObj(v) && isString(v.id) && isString(v.origin)),
    {
      collection: "hidden",
      async read() {
        const l = (await kv.get<string[]>(SYNC_KV.hidden)) ?? [];
        return Object.fromEntries(l.filter(isString).map((k) => [k, true]));
      },
      async apply(changes) {
        const s = new Set(((await kv.get<string[]>(SYNC_KV.hidden)) ?? []).filter(isString));
        for (const c of changes) {
          if (c.value === null) s.delete(c.id);
          else s.add(c.id);
        }
        await kv.set(SYNC_KV.hidden, [...s]);
      },
    },
    listSource<Bookmark>("bookmarks", kv, SYNC_KV.bookmarks, (b) => b.id, isBookmark),
  ];
}
