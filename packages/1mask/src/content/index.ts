/**
 * @clip-wallet/1mask/content — content-script bridge (ISOLATED world).
 *
 * page --postMessage--> [this] --RuntimePort--> background
 *
 * - Accepts only messages whose `source` is this very window (not other frames/windows), on our
 *   channel, that pass the zod schema and size cap.
 * - Attaches the origin from the content script's own `location.origin`. A page-supplied `origin`
 *   field fails the strict schema.
 * - Relays responses and events back; fails in-flight requests with 4900 if the port drops and
 *   reconnects lazily on the next request (MV3 service workers restart).
 */
import { RpcErrorCode, type RpcErrorShape } from "../shared/errors.js";
import {
  MAX_MESSAGE_BYTES,
  PORT_NAME,
  SOURCE_CONTENT,
  SOURCE_INPAGE,
  pageRequestSchema,
  portToContentSchema,
  type ContentEvent,
  type ContentResponse,
  type PortRequest,
} from "../shared/protocol.js";

/** The slice of `chrome.runtime.Port` the bridge needs. Inject a fake in tests. */
export interface RuntimePort {
  postMessage(message: unknown): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect(): void;
}

export interface ContentBridgeOptions {
  channel: string;
  /** Opens a port to the background. Default: chrome.runtime.connect({ name: PORT_NAME }). */
  connect?: () => RuntimePort;
  win?: Window;
}

export interface ContentBridge {
  /** The origin this bridge attaches to every request. */
  readonly origin: string;
  destroy(): void;
}

export function chromeRuntimeConnect(): RuntimePort {
  const chromeApi = (globalThis as unknown as { chrome?: { runtime?: { connect(o: { name: string }): RuntimePort } } })
    .chrome;
  if (!chromeApi?.runtime?.connect) throw new Error("1Mask: chrome.runtime.connect is unavailable");
  return chromeApi.runtime.connect({ name: PORT_NAME });
}

export function createContentBridge(opts: ContentBridgeOptions): ContentBridge {
  const win = opts.win ?? window;
  const connect = opts.connect ?? chromeRuntimeConnect;
  const { channel } = opts;
  // Read once, from the content script's own view of the document. Never from message data.
  const origin = win.location.origin;
  const targetOrigin = origin === "null" ? "*" : origin;
  let port: RuntimePort | undefined;
  const inFlight = new Set<string>();
  let destroyed = false;

  const toPage = (msg: ContentResponse | ContentEvent) => win.postMessage(msg, targetOrigin);
  const reply = (id: string, body: { result?: unknown; error?: RpcErrorShape }) =>
    toPage({ channel, source: SOURCE_CONTENT, type: "response", id, ...body });

  const getPort = (): RuntimePort => {
    if (port) return port;
    const p = connect();
    p.onMessage.addListener((raw) => {
      const parsed = portToContentSchema.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "response") {
        if (!inFlight.delete(msg.id)) return;
        reply(msg.id, msg.error ? { error: msg.error } : { result: msg.result });
      } else {
        toPage({ channel, source: SOURCE_CONTENT, type: "event", family: msg.family, event: msg.event, data: msg.data });
      }
    });
    p.onDisconnect.addListener(() => {
      if (port === p) port = undefined;
      for (const id of inFlight) {
        reply(id, { error: { code: RpcErrorCode.Disconnected, message: "Clip Wallet restarted. Try again." } });
      }
      inFlight.clear();
    });
    port = p;
    return p;
  };

  const onMessage = (ev: MessageEvent) => {
    if (destroyed || ev.source !== win) return;
    const data = ev.data as { channel?: unknown; source?: unknown } | null;
    if (!data || typeof data !== "object" || data.channel !== channel || data.source !== SOURCE_INPAGE) return;
    const parsed = pageRequestSchema.safeParse(data);
    if (!parsed.success) {
      const id = (data as { id?: unknown }).id;
      if (typeof id === "string" && id.length > 0 && id.length <= 64) {
        reply(id, { error: { code: RpcErrorCode.InvalidParams, message: "Malformed request." } });
      }
      return;
    }
    const req = parsed.data;
    let size: number;
    try {
      size = JSON.stringify(req.params ?? null).length;
    } catch {
      return reply(req.id, { error: { code: RpcErrorCode.InvalidParams, message: "Params must be JSON." } });
    }
    if (size > MAX_MESSAGE_BYTES) {
      return reply(req.id, { error: { code: RpcErrorCode.InvalidParams, message: "Request too large." } });
    }
    if (origin === "null" || !/^https?:\/\//.test(origin)) {
      return reply(req.id, {
        error: { code: RpcErrorCode.Unauthorized, message: "Clip Wallet only connects to http(s) sites." },
      });
    }
    if (inFlight.has(req.id)) {
      return reply(req.id, { error: { code: RpcErrorCode.InvalidParams, message: "Duplicate request id." } });
    }
    const out: PortRequest = { type: "request", id: req.id, origin, family: req.family, method: req.method };
    if (req.params !== undefined) out.params = req.params;
    if (req.chain !== undefined) out.chain = req.chain;
    inFlight.add(req.id);
    try {
      getPort().postMessage(out);
    } catch {
      inFlight.delete(req.id);
      port = undefined;
      reply(req.id, { error: { code: RpcErrorCode.Disconnected, message: "Clip Wallet is not reachable." } });
    }
  };

  win.addEventListener("message", onMessage);
  return {
    origin,
    destroy() {
      destroyed = true;
      win.removeEventListener("message", onMessage);
      port?.disconnect();
      port = undefined;
      inFlight.clear();
    },
  };
}

export { PORT_NAME } from "../shared/protocol.js";
