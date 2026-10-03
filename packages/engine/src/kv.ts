/**
 * Small JSON key-value store the engine keeps prefs, permissions, activity and cached public accounts in.
 * The host decides where it lives: chrome.storage.local in the extension, AsyncStorage on mobile, a Map in
 * tests. Only public data passes through here; the vault's ciphertext goes through `VaultStorage`.
 */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

/** JSON round-trip clone: works on every JS engine (Hermes has no structuredClone in older releases). */
function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export class MemoryKV implements KV {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : clone(v as T);
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, clone(value));
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

/** Any string store (AsyncStorage, localStorage, SecureStore…) as a JSON KV. */
export interface StringStore {
  getItem(key: string): Promise<string | null | undefined> | string | null | undefined;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export class JsonKV implements KV {
  constructor(
    private readonly store: StringStore,
    private readonly prefix = "",
  ) {}
  async get<T>(key: string) {
    const raw = await this.store.getItem(this.prefix + key);
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  async set<T>(key: string, value: T) {
    await this.store.setItem(this.prefix + key, JSON.stringify(value));
  }
  async remove(key: string) {
    await this.store.removeItem(this.prefix + key);
  }
}
