/** Minimal synchronous event emitter (no Node `events` in the page bundle). */
export class Emitter {
  #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: any[]) => void): this {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener);
  }

  removeAllListeners(event?: string): this {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
    return this;
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const l of [...set]) {
      try {
        l(...args);
      } catch (err) {
        // Surface dapp listener bugs without breaking the provider.
        setTimeout(() => {
          throw err;
        });
      }
    }
    return true;
  }
}
