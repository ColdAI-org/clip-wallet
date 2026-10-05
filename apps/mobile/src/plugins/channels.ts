/**
 * Channels from the in-app PluginHost to one hidden WebView per plugin (the mobile counterpart of
 * `iframeChannelFactory` in @clip-wallet/plugins). Pure: the React side (PluginSandboxes.tsx) renders a WebView for
 * every frame here, attaches its `postMessage`, and feeds `onMessage` back through `receive`.
 *
 *  - Messages to a sandbox wait in a queue until its page says "booted".
 *  - A frame accepts messages only through its own key, from about:blank, and only schema-valid ones (protocol.ts).
 *  - `destroy()` removes the frame, which unmounts the WebView: its page (and any loop it is stuck in) is gone.
 */
import type { Channel, ChannelFactory, HostToSandbox } from "@clip-wallet/plugins";
import { decodeFromSandbox, encodeForSandbox } from "./protocol";

export interface SandboxFrame {
  /** Unique per started plugin (a restart gets a new key, so React mounts a fresh WebView). */
  key: string;
  pluginId: string;
}

interface FrameState extends SandboxFrame {
  booted: boolean;
  queue: string[];
  post: ((data: string) => void) | null;
  listener: ((raw: unknown) => void) | null;
}

export interface WebViewChannels {
  factory: ChannelFactory;
  frames(): SandboxFrame[];
  subscribe(cb: () => void): () => void;
  /** The WebView for `key` mounted; `post` is its ref's postMessage. */
  attach(key: string, post: (data: string) => void): void;
  /** onMessage of the WebView for `key`. */
  receive(key: string, data: unknown, url: string | undefined): void;
  /** The WebView for `key` died (render process gone, load error): the frame is dropped like a destroy. */
  crashed(key: string): void;
}

export function createWebViewChannels(): WebViewChannels {
  const frames = new Map<string, FrameState>();
  const subs = new Set<() => void>();
  let seq = 0;
  const changed = () => subs.forEach((cb) => cb());

  const flush = (f: FrameState) => {
    if (!f.booted || !f.post) return;
    for (const m of f.queue.splice(0)) f.post(m);
  };

  const factory: ChannelFactory = (pluginId) => {
    const f: FrameState = { key: `${pluginId}#${++seq}`, pluginId, booted: false, queue: [], post: null, listener: null };
    frames.set(f.key, f);
    changed();
    const ch: Channel = {
      send(msg: HostToSandbox) {
        if (!frames.has(f.key)) return;
        const s = encodeForSandbox(msg);
        if (s === null) return;
        f.queue.push(s);
        flush(f);
      },
      onMessage(cb) {
        f.listener = cb;
      },
      destroy() {
        if (frames.delete(f.key)) changed();
        f.listener = null;
        f.post = null;
        f.queue = [];
      },
    };
    return ch;
  };

  return {
    factory,
    frames: () => [...frames.values()].map(({ key, pluginId }) => ({ key, pluginId })),
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    attach(key, post) {
      const f = frames.get(key);
      if (!f) return;
      f.post = post;
      flush(f);
    },
    receive(key, data, url) {
      const f = frames.get(key);
      if (!f) return;
      const m = decodeFromSandbox(data, url);
      if (!m) return;
      if (m.type === "booted") {
        if (f.booted) return;
        f.booted = true;
        flush(f);
      }
      f.listener?.(m);
    },
    crashed(key) {
      const f = frames.get(key);
      if (!f) return;
      frames.delete(key);
      f.post = null;
      changed();
    },
  };
}
