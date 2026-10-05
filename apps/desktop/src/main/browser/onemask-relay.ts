/**
 * 1Mask between dapp tabs and the engine's router, in the main process. Replaces the extension's content
 * script → background port (apps/extension/src/background/main.ts) and the mobile WebView bridge
 * (apps/mobile/src/browser/bridge.ts).
 *
 *   page (1Mask inpage, MAIN world)
 *     └─ window.postMessage ─► dapp preload (ISOLATED world, sandboxed): 1Mask content bridge
 *          └─ ipcRenderer.send(CH.onemaskToMain, PortRequest) ─► THIS (main process)
 *               └─ RouterPort ─► engine.attachDappPort(port, origin) ─► 1Mask router ─► approvals, vault
 *
 * The ORIGIN is never taken from the message. It is the committed origin of the frame that sent the IPC, as the
 * browser process knows it (WebFrameMain.origin, cross-checked with its URL), and only the TOP frame of a tab may
 * talk: iframes don't get the preload (no nodeIntegrationInSubFrames) and anything arriving from a subframe anyway
 * is dropped. Whatever `origin` the preload wrote is overwritten.
 *
 * One port per (tab webContents, origin). Replies go to the exact frame the port was opened for, and only while
 * that frame still shows that origin; navigating (even same-origin, a new document) closes the port, so a late
 * answer for one page is never delivered to the next.
 *
 * Pure apart from the small Frame/Sender interfaces, so the origin binding is unit-tested with fakes.
 */
import type { RouterPort } from "@clip-wallet/1mask/background";
import { MAX_ONEMASK_BYTES, OneMaskFromPage } from "../../shared/ipc";
import { webOrigin } from "./url-policy";

export interface RelayFrame {
  readonly url: string;
  readonly origin?: string;
  readonly parent: unknown | null;
  readonly detached?: boolean;
  /** WebFrameMain ids: the same frame may come back as a different JS wrapper object. */
  readonly processId?: number;
  readonly routingId?: number;
  send(channel: string, msg: unknown): void;
}

function sameFrame(a: RelayFrame, b: RelayFrame): boolean {
  if (a === b) return true;
  return a.processId !== undefined && a.routingId !== undefined && a.processId === b.processId && a.routingId === b.routingId;
}

export interface RelaySender {
  readonly id: number;
  readonly mainFrame: RelayFrame;
  isDestroyed(): boolean;
}

interface Entry {
  origin: string;
  frame: RelayFrame;
  port: RouterPort;
  listeners: ((m: unknown) => void)[];
  closers: (() => void)[];
  closed: boolean;
}

/** The frame's origin as the browser process sees it; null unless it is a top frame on an http(s) dapp origin. */
export function frameOrigin(sender: RelaySender, frame: RelayFrame | null): string | null {
  if (!frame || frame.detached || frame.parent !== null || !sameFrame(frame, sender.mainFrame)) return null;
  const fromUrl = webOrigin(frame.url);
  if (!fromUrl) return null;
  // WebFrameMain.origin is the security origin ("null" for opaque/sandboxed documents): it must agree.
  if (frame.origin !== undefined && frame.origin !== fromUrl) return null;
  return fromUrl;
}

export class OneMaskRelay {
  private readonly ports = new Map<number, Entry>();

  constructor(
    private readonly o: {
      /** engine.attachDappPort */
      attach(port: RouterPort, origin: string): void;
      /** IPC channel replies go out on (CH.onemaskToPage). */
      replyChannel: string;
      /** Optional: a site sent its first request (address bar "connected" dot refreshes). */
      onActivity?(senderId: number, origin: string): void;
    },
  ) {}

  /** A message from a dapp preload. `frame` is event.senderFrame. Returns why it was dropped (tests), or null. */
  onMessage(sender: RelaySender, frame: RelayFrame | null, raw: unknown): string | null {
    if (sender.isDestroyed()) return "destroyed";
    const origin = frameOrigin(sender, frame);
    if (!origin) return "not-top-frame-or-origin";
    let size: number;
    try {
      size = JSON.stringify(raw ?? null).length;
    } catch {
      return "not-json";
    }
    if (size > MAX_ONEMASK_BYTES) return "too-large";
    const parsed = OneMaskFromPage.safeParse(raw);
    if (!parsed.success) return "schema";
    // The only origin that ever reaches the router: the browser's, never the page's.
    const req = { ...parsed.data, origin };
    const entry = this.portFor(sender, frame!, origin);
    for (const l of entry.listeners) l(req);
    this.o.onActivity?.(sender.id, origin);
    return null;
  }

  /** The tab's top frame started a new document (navigation, reload): its port closes. */
  navigated(senderId: number): void {
    this.close(senderId);
  }

  /** The tab's webContents is gone. */
  destroyed(senderId: number): void {
    this.close(senderId);
  }

  /** Origin with an open port for a tab (address bar dot). */
  originOf(senderId: number): string | null {
    const e = this.ports.get(senderId);
    return e && !e.closed ? e.origin : null;
  }

  private close(senderId: number) {
    const e = this.ports.get(senderId);
    if (!e) return;
    this.ports.delete(senderId);
    if (e.closed) return;
    e.closed = true;
    for (const c of e.closers) {
      try {
        c();
      } catch {
        /* the router's own cleanup must not break navigation */
      }
    }
  }

  private portFor(sender: RelaySender, frame: RelayFrame, origin: string): Entry {
    const cur = this.ports.get(sender.id);
    if (cur && !cur.closed && cur.origin === origin && sameFrame(cur.frame, frame)) return cur;
    this.close(sender.id);
    const entry: Entry = { origin, frame, listeners: [], closers: [], closed: false, port: undefined as unknown as RouterPort };
    entry.port = {
      postMessage: (message: unknown) => {
        if (entry.closed || sender.isDestroyed()) return;
        // Same frame object, still on the same origin: otherwise the page changed and the answer is dropped.
        if (frame.detached || frameOrigin(sender, frame) !== origin) return;
        try {
          frame.send(this.o.replyChannel, message);
        } catch {
          /* frame went away */
        }
      },
      onMessage: { addListener: (cb) => void entry.listeners.push(cb) },
      onDisconnect: { addListener: (cb) => void entry.closers.push(cb) },
      disconnect: () => this.close(sender.id),
    };
    this.ports.set(sender.id, entry);
    this.o.attach(entry.port, origin);
    return entry;
  }
}
