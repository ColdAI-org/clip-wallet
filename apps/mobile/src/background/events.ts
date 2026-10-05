/** Tiny event hub between the engine (env callbacks) and React. */
export type WalletEvent = { type: "change" } | { type: "approval"; id: string } | { type: "locked" } | { type: "open-url"; url: string };

export class Events {
  private listeners = new Set<(e: WalletEvent) => void>();
  on(cb: (e: WalletEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(e: WalletEvent) {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch {
        /* a screen's listener must not break the engine */
      }
    }
  }
}
