/**
 * The typed IPC contract between the main process (engine + vault host) and our own renderers.
 *
 * Every channel is listed here once, with the zod schema the main process checks before doing anything. The
 * renderers are our own code (bundled, strict CSP, no remote content), but the main process still treats every
 * message as untrusted input: schema first, then sender checks (ipc-guard.ts), then the engine's own zod check.
 *
 * Dapp pages never see any of this. They talk 1Mask (window.postMessage) to the dapp preload, which relays over
 * ONEMASK_* below; the origin of those requests is set in the main process from the frame that sent them.
 */
import { z } from "zod";

/** Omit for each member of a union (TypeScript's Omit collapses unions). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/* ------------------------------------------------------------------ channel names */

export const CH = {
  /** renderer → main (invoke): a wallet / features / social / security / hardware message (engine schema). */
  walletCall: "clip:wallet:call",
  /** main → renderer: state changed, re-fetch. */
  walletChanged: "clip:wallet:changed",
  /** renderer → main (invoke): desktop-only calls (DesktopCall below). */
  desktopCall: "clip:desktop:call",
  /** main → wallet renderer: a Ledger APDU job for WebHID (HidJob). renderer → main: HidReply. */
  hidJob: "clip:hid:job",
  hidReply: "clip:hid:reply",
  /** browser chrome renderer ↔ main. */
  chromeCall: "clip:chrome:call",
  chromeState: "clip:chrome:state",
  /** dapp preload → main (sync, at document start): the 1Mask boot config (OneMaskBoot), or null. */
  onemaskBoot: "clip:1mask:boot",
  /** dapp preload ↔ main (1Mask port). */
  onemaskToMain: "clip:1mask:req",
  onemaskToPage: "clip:1mask:msg",
} as const;

/* ------------------------------------------------------------------ wallet bus */

/** The engine validates the message itself (EngineRequest / HardwareRequest); here only the envelope shape. */
export const WalletCall = z.object({ type: z.string().min(1).max(64).regex(/^[A-Za-z0-9]+$/) }).passthrough();
export type WalletCall = z.infer<typeof WalletCall>;

export const Envelope = z.union([
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.object({ userMessage: z.string(), code: z.string() }) }),
]);
export type Envelope = z.infer<typeof Envelope>;

/* ------------------------------------------------------------------ desktop-only calls (wallet + approval windows) */

const b64url = z.string().regex(/^[A-Za-z0-9_-]*$/).max(4096);
const httpUrl = z
  .string()
  .max(2048)
  .refine((u) => {
    try {
      const p = new URL(u).protocol;
      return p === "https:" || p === "http:";
    } catch {
      return false;
    }
  }, "http(s) URL");

export const DesktopCall = z.discriminatedUnion("op", [
  /** Facts the UI shows (platform, versions, storage protection, biometrics). */
  z.object({ op: z.literal("info") }),
  /** Opens the built-in browser (optionally at a URL, in a new tab). */
  z.object({ op: z.literal("openBrowser"), url: httpUrl.optional() }),
  /** Opens an https page outside the app (on-ramp widgets, explorers): the system browser. */
  z.object({ op: z.literal("openExternal"), url: httpUrl }),
  /** Brings the wallet window forward at a route. */
  z.object({ op: z.literal("showWallet"), route: z.string().max(200).optional() }),
  /** Touch ID PRF for the vault's passkey slot: the main process finishes the ceremony itself (biometric.ts). */
  z.object({ op: z.literal("bioEnroll"), ceremonyId: z.string().min(1).max(200), prfInput: b64url.min(1) }),
  z.object({ op: z.literal("bioEvaluate"), ceremonyId: z.string().min(1).max(200), credentialId: b64url.min(1), prfInput: b64url.min(1) }),
  /** Closes the window that sent this (the approval window when its queue is empty). */
  z.object({ op: z.literal("closeSelf") }),
]);
export type DesktopCall = z.infer<typeof DesktopCall>;

export interface DesktopInfo {
  platform: "darwin" | "win32" | "linux" | string;
  appVersion: string;
  electron: string;
  chrome: string;
  /** How the vault file is protected at rest on this machine, on top of the vault's own Argon2id encryption. */
  storage: "keychain" | "dpapi" | "libsecret" | "kwallet" | "basic" | "none";
  biometrics: { available: boolean; label: string };
  updates: "disabled" | "enabled";
}

/* ------------------------------------------------------------------ Ledger over WebHID (main ↔ wallet renderer) */

export const HidJob = z.discriminatedUnion("op", [
  z.object({ id: z.string().max(64), op: z.literal("open") }),
  z.object({ id: z.string().max(64), op: z.literal("exchange"), apdu: z.string().regex(/^[0-9a-f]*$/).max(2 * 65_600) }),
  z.object({ id: z.string().max(64), op: z.literal("close") }),
]);
export type HidJob = z.infer<typeof HidJob>;

export const HidReply = z.union([
  z.object({ id: z.string().max(64), ok: z.literal(true), data: z.string().regex(/^[0-9a-f]*$/).max(2 * 65_600).optional() }),
  z.object({ id: z.string().max(64), ok: z.literal(false), name: z.string().max(100), message: z.string().max(500), statusCode: z.number().int().optional() }),
]);
export type HidReply = z.infer<typeof HidReply>;

/* ------------------------------------------------------------------ browser chrome (toolbar renderer ↔ main) */

const tabId = z.number().int().min(1).max(1_000_000);

export const ChromeCall = z.discriminatedUnion("op", [
  z.object({ op: z.literal("state") }),
  z.object({ op: z.literal("newTab"), url: z.string().max(2048).optional() }),
  z.object({ op: z.literal("closeTab"), tabId }),
  z.object({ op: z.literal("selectTab"), tabId }),
  /** Address bar input: a URL or something to turn into one (never a search: there is no search engine). */
  z.object({ op: z.literal("navigate"), tabId, input: z.string().min(1).max(2048) }),
  z.object({ op: z.literal("back"), tabId }),
  z.object({ op: z.literal("forward"), tabId }),
  z.object({ op: z.literal("reload"), tabId }),
  z.object({ op: z.literal("stop"), tabId }),
  z.object({ op: z.literal("toggleBookmark"), tabId }),
  z.object({ op: z.literal("removeBookmark"), url: z.string().max(2048) }),
  /** A pending prompt (site permission, phishing warning) answered by the user. Downloads use native dialogs. */
  z.object({ op: z.literal("answer"), promptId: z.string().max(64), choice: z.enum(["allow", "deny", "leave", "proceed"]) }),
  z.object({ op: z.literal("openWallet"), route: z.string().max(200).optional() }),
]);
export type ChromeCall = z.infer<typeof ChromeCall>;

export interface TabView {
  id: number;
  title: string;
  /** The committed URL of the page (what the address bar shows when not editing). */
  url: string;
  /** http(s) origin of the committed page, as the main process sees it (null for the start page). */
  origin: string | null;
  secure: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  bookmarked: boolean;
  /** This site has a 1Mask connection (any family). */
  connected: boolean;
  /** Phishing-list verdict for the origin: "danger" blocks until the user chooses. */
  risk: "ok" | "danger";
}

export type PromptView =
  | { id: string; tabId: number; kind: "permission"; origin: string; permission: string }
  | { id: string; tabId: number; kind: "phishing"; origin: string; reasons: string[] };

export interface ChromeState {
  tabs: TabView[];
  activeId: number | null;
  bookmarks: { url: string; title: string }[];
  /** Featured apps from Explore (features stream); empty when locked or offline. */
  featured: { name: string; url: string; description?: string }[];
  prompts: PromptView[];
  /** The app's display language (follows Settings → Language). */
  locale: string;
  theme: "light" | "dark";
}

/* ------------------------------------------------------------------ 1Mask relay (dapp preload ↔ main) */

/** Public facts the inpage providers need: the per-run channel, networks (no secrets), the wallet's identity. */
export interface OneMaskBoot {
  channel: string;
  networks: unknown[];
  identity: { name: string; icon: string; rdns: string };
  tonConnect?: unknown;
}

/** What the dapp preload forwards: the content bridge's PortRequest. The origin field is overwritten in main. */
export const OneMaskFromPage = z
  .object({
    type: z.literal("request"),
    id: z.string().min(1).max(64),
    origin: z.string().max(2048),
    family: z.string().min(1).max(32),
    method: z.string().min(1).max(128),
    params: z.unknown().optional(),
    chain: z.string().max(128).optional(),
  })
  .strict();
export type OneMaskFromPage = z.infer<typeof OneMaskFromPage>;

/** 1Mask's own cap (shared/protocol.ts MAX_MESSAGE_BYTES, 4 MiB of params) plus headroom for the envelope. */
export const MAX_ONEMASK_BYTES = 4 * 1024 * 1024 + 64 * 1024;
