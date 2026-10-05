/**
 * The extension's end of the desktop link: a chrome.runtime.Port from runtime.connectNative(hostName), with each
 * channel frame wrapped as { f: "<frame>" }. Status frames from the host ({ host: "status" }) say whether Clip
 * Desktop is running.
 */
import { BaseChannel, Emitter } from "../pairing/channel.js";
import type { HostStatus } from "./ipc.js";

export interface NativePortLike {
  postMessage(msg: unknown): void;
  onMessage: { addListener(cb: (msg: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect(): void;
}

export class NativePortChannel extends BaseChannel {
  readonly status = new Emitter<HostStatus["status"]>();
  constructor(private readonly port: NativePortLike) {
    super(
      (frame) => port.postMessage({ f: frame }),
      () => port.disconnect(),
    );
    port.onMessage.addListener((m) => {
      if (!m || typeof m !== "object") return;
      const o = m as { f?: unknown; host?: unknown; status?: unknown };
      if (typeof o.f === "string") this.deliver(o.f);
      else if (o.host === "status" && typeof o.status === "string") {
        this.status.emit(o.status as HostStatus["status"]);
        if (o.status !== "connected") this.ended(o.status);
      }
    });
    port.onDisconnect.addListener(() => this.ended("disconnected"));
  }
}
