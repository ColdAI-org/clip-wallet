/**
 * A Channel over the Clip Link relay. Works with the browser / React Native / Workers WebSocket (injected so tests
 * and service workers can pass their own). Relay control frames are filtered out and surfaced as `peer` events.
 */
import { BaseChannel, Emitter } from "../pairing/channel.js";
import { channelUrl, isRelayControl, type RelayRole } from "./protocol.js";

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", cb: (ev: { data?: unknown; code?: number; reason?: string }) => void): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export class RelayChannel extends BaseChannel {
  readonly peer = new Emitter<boolean>();
  private readonly ws: WebSocketLike;
  private readonly pending: string[] = [];
  private opened = false;
  private keepalive?: ReturnType<typeof setInterval>;

  constructor(p: { relay: string; channel: string; role: RelayRole; WebSocket: WebSocketCtor; keepaliveMs?: number }) {
    super(
      (frame) => {
        if (this.opened) this.ws.send(frame);
        else this.pending.push(frame);
      },
      () => this.ws.close(1000, "bye"),
    );
    this.ws = new p.WebSocket(channelUrl(p.relay, p.channel, p.role));
    this.ws.addEventListener("open", () => {
      this.opened = true;
      for (const f of this.pending.splice(0)) this.ws.send(f);
      // MV3 service workers stay alive while a WebSocket exchanges messages at least every 30 s (Chrome 116+).
      if (p.keepaliveMs) this.keepalive = setInterval(() => this.ws.readyState === 1 && this.ws.send('{"t":"ka"}'), p.keepaliveMs);
    });
    this.ws.addEventListener("message", (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (!data) return;
      if (data.startsWith('{"relay"')) {
        try {
          const m = JSON.parse(data) as unknown;
          if (isRelayControl(m)) {
            if (m.relay === "peer") this.peer.emit(m.present);
            return;
          }
        } catch {
          /* fall through */
        }
      }
      this.deliver(data);
    });
    const end = (ev: { reason?: string }) => {
      if (this.keepalive) clearInterval(this.keepalive);
      this.ended(ev?.reason || "relay closed");
    };
    this.ws.addEventListener("close", end);
    this.ws.addEventListener("error", () => end({ reason: "relay error" }));
  }

  /** Resolves once the socket is open (rejects if it closes first). */
  ready(timeoutMs = 15_000): Promise<void> {
    if (this.opened) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("relay timeout")), timeoutMs);
      this.ws.addEventListener("open", () => {
        clearTimeout(t);
        resolve();
      });
      this.onClose(() => {
        clearTimeout(t);
        reject(new Error("relay closed"));
      });
    });
  }
}
