/**
 * Injected persistence. In the extension this wraps chrome.storage.local; tests use MemoryStorage.
 * Values are strings (JSON) so any key-value store works. Only ciphertext and public metadata are stored.
 */
export interface VaultStorage {
  get(key: string): Promise<string | undefined> | string | undefined;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export class MemoryStorage implements VaultStorage {
  readonly data = new Map<string, string>();
  get(key: string) {
    return this.data.get(key);
  }
  set(key: string, value: string) {
    this.data.set(key, value);
  }
  remove(key: string) {
    this.data.delete(key);
  }
}

/** Clock + timers, injectable for tests. */
export interface Clock {
  now(): number;
  setTimeout?(fn: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};
