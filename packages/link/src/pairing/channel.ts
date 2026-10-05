/**
 * A message pipe between two devices: the relay WebSocket (phone ↔ extension/desktop), the native-messaging port
 * (extension ↔ desktop) or an in-memory pair (tests). Frames are JSON text. Nothing on a channel is trusted:
 * pairing authenticates the peer, and after pairing every frame is encrypted (session.ts).
 */
export interface Channel {
  send(frame: string): void;
  onMessage(cb: (frame: string) => void): () => void;
  onClose(cb: (reason?: string) => void): () => void;
  close(reason?: string): void;
}

type Listener<T> = (v: T) => void;

/** Small listener set used by channel implementations. */
export class Emitter<T> {
  private readonly ls = new Set<Listener<T>>();
  on(cb: Listener<T>): () => void {
    this.ls.add(cb);
    return () => this.ls.delete(cb);
  }
  emit(v: T) {
    for (const l of [...this.ls]) {
      try {
        l(v);
      } catch {
        /* a listener's failure never breaks the channel */
      }
    }
  }
  clear() {
    this.ls.clear();
  }
  get size() {
    return this.ls.size;
  }
}

export class BaseChannel implements Channel {
  protected readonly messages = new Emitter<string>();
  protected readonly closes = new Emitter<string | undefined>();
  closed = false;
  constructor(private readonly sender: (frame: string) => void, private readonly closer: (reason?: string) => void = () => undefined) {}
  send(frame: string) {
    if (this.closed) throw new Error("channel closed");
    this.sender(frame);
  }
  /** Frames that arrived while nobody listened (between protocol steps); handed to the next listener. */
  private backlog: string[] = [];
  onMessage(cb: (frame: string) => void) {
    const off = this.messages.on(cb);
    if (this.backlog.length) {
      queueMicrotask(() => {
        const frames = this.backlog.splice(0);
        for (const f of frames) this.deliver(f);
      });
    }
    return off;
  }
  onClose(cb: (reason?: string) => void) {
    return this.closes.on(cb);
  }
  /** Implementations call this when a frame arrives. */
  deliver(frame: string) {
    if (this.closed) return;
    if (this.messages.size === 0) {
      if (this.backlog.length < 64) this.backlog.push(frame);
      return;
    }
    this.messages.emit(frame);
  }
  /** Implementations call this when the transport ends. */
  ended(reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.closes.emit(reason);
    this.messages.clear();
  }
  close(reason?: string) {
    if (this.closed) return;
    this.closer(reason);
    this.ended(reason);
  }
}

/**
 * Two connected in-memory channels. `tap` sees (and may rewrite or drop, by returning null) every frame in flight:
 * that's how the tests play a man in the middle on the relay.
 */
export function memoryChannelPair(tap?: (from: "a" | "b", frame: string) => string | null): [BaseChannel, BaseChannel] {
  let a!: BaseChannel;
  let b!: BaseChannel;
  const deliver = (from: "a" | "b", frame: string) => {
    const out = tap ? tap(from, frame) : frame;
    if (out === null) return;
    const to = from === "a" ? b : a;
    queueMicrotask(() => to.deliver(out));
  };
  a = new BaseChannel((f) => deliver("a", f), (r) => queueMicrotask(() => b.ended(r)));
  b = new BaseChannel((f) => deliver("b", f), (r) => queueMicrotask(() => a.ended(r)));
  return [a, b];
}

/** Resolves with the next frame that passes `accept` (parsed JSON), or rejects on close / timeout. */
export function nextFrame<T>(ch: Channel, accept: (m: unknown) => m is T, timeoutMs: number, setTimer = setTimeout, clearTimer = clearTimeout): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const offMsg = ch.onMessage((f) => {
      let m: unknown;
      try {
        m = JSON.parse(f);
      } catch {
        return;
      }
      if (isAbort(m)) {
        done();
        reject(new PeerAbort((m as { reason?: string }).reason));
        return;
      }
      if (accept(m)) {
        done();
        resolve(m);
      }
    });
    const offClose = ch.onClose((r) => {
      done();
      reject(new ChannelClosed(r));
    });
    const t = setTimer(() => {
      done();
      reject(new ChannelTimeout());
    }, timeoutMs);
    function done() {
      offMsg();
      offClose();
      clearTimer(t);
    }
  });
}

export class ChannelClosed extends Error {
  constructor(readonly reason?: string) {
    super(`channel closed${reason ? `: ${reason}` : ""}`);
  }
}
export class ChannelTimeout extends Error {
  constructor() {
    super("timed out");
  }
}
export class PeerAbort extends Error {
  constructor(readonly reason?: string) {
    super(`peer aborted${reason ? `: ${reason}` : ""}`);
  }
}

const isAbort = (m: unknown) => !!m && typeof m === "object" && (m as { t?: string }).t === "abort";
