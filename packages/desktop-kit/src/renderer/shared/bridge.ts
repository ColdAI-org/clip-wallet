/**
 * The renderer's view of the preload bridge (preload/wallet.ts). Renderers never import electron.
 */
import type { ClipDesktopApi } from "../../preload/wallet";
import { Envelope } from "../../shared/ipc";

declare global {
  interface Window {
    clipDesktop: ClipDesktopApi;
  }
}

export const desktop = (): ClipDesktopApi => window.clipDesktop;

/** Plain-words error the UI shows (userMessageOf reads `userMessage`). */
export class BridgeError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
    /** The translatable version (ClipError.msg), checked by the UI before use. */
    public readonly msg?: unknown,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

/** Unwraps a main-process Envelope. */
export function unwrap<T>(raw: unknown): T {
  const env = Envelope.safeParse(raw);
  if (!env.success) throw new BridgeError("Something went wrong. Please try again.", "bus/bad-reply");
  if (!env.data.ok) throw new BridgeError(env.data.error.userMessage, env.data.error.code, env.data.error.msg);
  return env.data.data as T;
}

export async function callWallet<T>(msg: { type: string } & Record<string, unknown>): Promise<T> {
  let raw: unknown;
  try {
    raw = await desktop().call(msg);
  } catch {
    throw new BridgeError("The wallet is starting. Try again in a moment.", "bus/unavailable");
  }
  return unwrap<T>(raw);
}
