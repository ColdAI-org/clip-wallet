import { RpcErrorCode } from "../shared/errors.js";
import type { InpageTransport } from "./transport.js";

/**
 * TON Connect JS bridge (ton-connect/docs spec/bridge.md "JS bridge"): `window.<key>.tonconnect` with
 * `deviceInfo`, `walletInfo?`, `protocolVersion` (2), `isWalletBrowser`, `connect(protocolVersion, request)`,
 * `restoreConnection()`, `send(appRequest)` and `listen(callback)`. Plaintext, no session keys (same device).
 * Requests go to the background router as family "ton", methods `tonconnect:<name>`.
 */

export type TonFeature =
  | { name: "SendTransaction"; maxMessages: number; extraCurrencySupported?: boolean; itemTypes?: ("ton" | "jetton" | "nft")[] }
  | { name: "SignData"; types: ("text" | "binary" | "cell")[] }
  | { name: "SignMessage"; maxMessages: number; extraCurrencySupported?: boolean; itemTypes?: ("ton" | "jetton" | "nft")[] }
  | { name: "EmbeddedRequest" };

export interface DeviceInfo {
  platform: "iphone" | "ipad" | "android" | "windows" | "mac" | "linux" | "browser";
  appName: string;
  appVersion: string;
  maxProtocolVersion: number;
  features: TonFeature[];
}

export interface TonWalletInfo {
  name: string;
  /** PNG image URL. */
  image: string;
  tondns?: string;
  about_url: string;
}

export interface TonConnectRequest {
  manifestUrl: string;
  items: ({ name: "ton_addr"; network?: string } | { name: "ton_proof"; payload: string })[];
}

export type ConnectEvent =
  | { event: "connect"; id: number; payload: { items: unknown[]; device: DeviceInfo } }
  | { event: "connect_error"; id: number; payload: { code: number; message: string } };

export interface AppRequest {
  method: string;
  params: string[];
  id: string;
}
export type WalletResponse = { result: unknown; id: string } | { error: { code: number; message: string; data?: unknown }; id: string };
export interface WalletEvent {
  event: "connect" | "connect_error" | "disconnect";
  id: number;
  payload: unknown;
}

/** TON Connect error codes (rpc.md "Central error catalogue", connect.md). */
export const TON_ERRORS = { UNKNOWN_ERROR: 0, BAD_REQUEST: 1, MANIFEST_NOT_FOUND: 2, MANIFEST_CONTENT_ERROR: 3, UNKNOWN_APP: 100, USER_DECLINED: 300, METHOD_NOT_SUPPORTED: 400 } as const;

export function toTonError(err: unknown): { code: number; message: string } {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === "string" ? e.message : "Request failed.";
  switch (e.code) {
    case RpcErrorCode.UserRejected:
      return { code: TON_ERRORS.USER_DECLINED, message };
    case RpcErrorCode.Unauthorized:
      return { code: TON_ERRORS.UNKNOWN_APP, message };
    case RpcErrorCode.UnsupportedMethod:
    case RpcErrorCode.MethodNotFound:
      return { code: TON_ERRORS.METHOD_NOT_SUPPORTED, message };
    case RpcErrorCode.InvalidParams:
    case RpcErrorCode.ChainDisconnected:
    case RpcErrorCode.UnrecognizedChain:
      return { code: TON_ERRORS.BAD_REQUEST, message };
    default:
      return { code: TON_ERRORS.UNKNOWN_ERROR, message };
  }
}

export const TON_PROTOCOL_VERSION = 2;

export class ClipTonConnectBridge {
  readonly deviceInfo: DeviceInfo;
  readonly walletInfo?: TonWalletInfo;
  readonly protocolVersion = TON_PROTOCOL_VERSION;
  readonly isWalletBrowser = false;
  #transport: InpageTransport;
  #eventId = 0;
  #lastRequestId: bigint | null = null;
  #listeners = new Set<(e: WalletEvent) => void>();

  constructor(transport: InpageTransport, deviceInfo: Omit<DeviceInfo, "maxProtocolVersion" | "platform">, walletInfo?: TonWalletInfo) {
    this.#transport = transport;
    this.deviceInfo = Object.freeze({ platform: "browser", maxProtocolVersion: TON_PROTOCOL_VERSION, ...deviceInfo });
    if (walletInfo) this.walletInfo = Object.freeze({ ...walletInfo });
    transport.onEvent((family, event) => {
      if (family !== "ton" || event !== "disconnect") return;
      this.#lastRequestId = null;
      this.#emit({ event: "disconnect", id: this.#nextEventId(), payload: {} });
    });
  }

  #nextEventId(): number {
    return ++this.#eventId;
  }

  #emit(e: WalletEvent) {
    for (const l of [...this.#listeners]) {
      try {
        l(e);
      } catch {
        /* a dapp listener throwing must not break the bridge */
      }
    }
  }

  async connect(protocolVersion: number, request: TonConnectRequest): Promise<ConnectEvent> {
    const id = this.#nextEventId();
    if (!Number.isInteger(protocolVersion) || protocolVersion < TON_PROTOCOL_VERSION) {
      return { event: "connect_error", id, payload: { code: TON_ERRORS.BAD_REQUEST, message: `Clip Wallet speaks TON Connect protocol ${TON_PROTOCOL_VERSION}.` } };
    }
    if (!request || typeof request !== "object" || !Array.isArray(request.items) || typeof request.manifestUrl !== "string") {
      return { event: "connect_error", id, payload: { code: TON_ERRORS.BAD_REQUEST, message: "Expected { manifestUrl, items }." } };
    }
    try {
      const items = await this.#transport.request("ton", "tonconnect:connect", { manifestUrl: request.manifestUrl, items: request.items });
      this.#lastRequestId = null;
      return { event: "connect", id, payload: { items: Array.isArray(items) ? items : [], device: this.deviceInfo } };
    } catch (e) {
      return { event: "connect_error", id, payload: toTonError(e) };
    }
  }

  async restoreConnection(): Promise<ConnectEvent> {
    const id = this.#nextEventId();
    try {
      const items = await this.#transport.request("ton", "tonconnect:restoreConnection");
      if (!Array.isArray(items) || !items.length) throw { code: RpcErrorCode.Unauthorized, message: "Unknown app." };
      return { event: "connect", id, payload: { items, device: this.deviceInfo } };
    } catch {
      return { event: "connect_error", id, payload: { code: TON_ERRORS.UNKNOWN_APP, message: "Unknown app." } };
    }
  }

  async send(message: AppRequest): Promise<WalletResponse> {
    const id = typeof message?.id === "string" || typeof message?.id === "number" ? String(message.id) : "";
    if (!message || typeof message.method !== "string" || !Array.isArray(message.params) || !/^\d+$/.test(id)) {
      return { error: { code: TON_ERRORS.BAD_REQUEST, message: "Expected { method, params: string[], id }." }, id };
    }
    // rpc.md: every request id after the first MUST be strictly greater than the last one processed.
    const n = BigInt(id);
    if (this.#lastRequestId !== null && n <= this.#lastRequestId) {
      return { error: { code: TON_ERRORS.BAD_REQUEST, message: "Request ids must increase." }, id };
    }
    this.#lastRequestId = n;
    try {
      const result = await this.#transport.request("ton", `tonconnect:${message.method}`, message.params);
      if (message.method === "disconnect") this.#lastRequestId = null;
      return { result: result ?? {}, id };
    } catch (e) {
      return { error: toTonError(e), id };
    }
  }

  listen(callback: (event: WalletEvent) => void): () => void {
    if (typeof callback !== "function") return () => {};
    this.#listeners.add(callback);
    return () => {
      this.#listeners.delete(callback);
    };
  }
}

/** Defines `window[key] = { tonconnect: bridge }`, never overwriting another wallet's object. */
export function injectTonConnect(win: Window, key: string, bridge: ClipTonConnectBridge): { injected: boolean; stop(): void } {
  if (!/^[A-Za-z_$][\w$]*$/.test(key)) throw new Error("1Mask: TON Connect bridge key must be a JS identifier");
  const w = win as unknown as Record<string, unknown>;
  if (w[key] !== undefined) return { injected: false, stop: () => {} };
  const holder = Object.freeze({ tonconnect: bridge });
  Object.defineProperty(win, key, { value: holder, configurable: true, enumerable: true, writable: false });
  return { injected: true, stop: () => void (w[key] === holder && delete w[key]) };
}
