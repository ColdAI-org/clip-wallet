/** Small JSON key-value store. chrome.storage.local in the extension, a Map in tests. */
import type { VaultStorage } from "@clip-wallet/vault";

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryKV implements KV {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value));
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export class AreaKV implements KV {
  constructor(private readonly area: StorageAreaLike) {}
  async get<T>(key: string) {
    return (await this.area.get(key))[key] as T | undefined;
  }
  async set<T>(key: string, value: T) {
    await this.area.set({ [key]: value });
  }
  async remove(key: string) {
    await this.area.remove(key);
  }
}

/** Adapts a KV to the vault's string storage. Only ciphertext and public metadata pass through here. */
export function vaultStorageOf(kv: KV): VaultStorage {
  return {
    get: (k) => kv.get<string>(k),
    set: (k, v) => kv.set(k, v),
    remove: (k) => kv.remove(k),
  };
}
