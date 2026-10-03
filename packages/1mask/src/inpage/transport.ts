import type { Family } from "@clip-wallet/core";
import { ProviderRpcError, RpcErrorCode, fromRpcErrorShape } from "../shared/errors.js";
import { randomId } from "../shared/bytes.js";
import {
  SOURCE_CONTENT,
  SOURCE_INPAGE,
  contentToPageSchema,
  type OneMaskEvent,
  type PageRequest,
} from "../shared/protocol.js";

export type EventListener = (family: Family, event: OneMaskEvent, data: unknown) => void;

export interface InpageTransport {
  request(family: Family, method: string, params?: unknown, chain?: string): Promise<unknown>;
  onEvent(listener: EventListener): () => void;
  destroy(): void;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Page-side transport: posts requests to the content script on `channel` and matches responses by id.
 * Ignores anything that is not from this window, not on the channel, or not schema-valid.
 */
export function createInpageTransport(opts: {
  channel: string;
  win?: Window;
  timeoutMs?: number;
}): InpageTransport {
  const win = opts.win ?? window;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const pending = new Map<string, Pending>();
  const listeners = new Set<EventListener>();

  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== win) return;
    const data = ev.data as { channel?: unknown; source?: unknown } | null;
    if (!data || typeof data !== "object" || data.channel !== opts.channel || data.source !== SOURCE_CONTENT) return;
    const parsed = contentToPageSchema.safeParse(data);
    if (!parsed.success) return;
    const msg = parsed.data;
    if (msg.type === "response") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(fromRpcErrorShape(msg.error));
      else p.resolve(msg.result);
    } else {
      for (const l of listeners) {
        try {
          l(msg.family, msg.event, msg.data);
        } catch {
          /* a dapp listener throwing must not break others */
        }
      }
    }
  };
  win.addEventListener("message", onMessage);

  return {
    request(family, method, params, chain) {
      const id = randomId();
      const msg: PageRequest = { channel: opts.channel, source: SOURCE_INPAGE, type: "request", id, family, method };
      if (params !== undefined) msg.params = params;
      if (chain !== undefined) msg.chain = chain;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ProviderRpcError(RpcErrorCode.Internal, "Clip Wallet did not answer in time."));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        win.postMessage(msg, win.location.origin === "null" ? "*" : win.location.origin);
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      win.removeEventListener("message", onMessage);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new ProviderRpcError(RpcErrorCode.Disconnected, "Clip Wallet is disconnected."));
      }
      pending.clear();
      listeners.clear();
    },
  };
}
