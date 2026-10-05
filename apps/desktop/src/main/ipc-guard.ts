/**
 * Who may use which IPC channel. The main process never trusts a message because of the channel it came in
 * on: it checks the frame that sent it.
 *
 *   wallet / desktop / hid channels  only the top frame of one of OUR windows (wallet, approval, browser
 *                                    toolbar), whose committed URL is on the app's own origin (clip-app://wallet).
 *   1Mask channel                    only the top frame of a dapp tab (onemask-relay.ts derives its origin).
 *
 * Dapp tabs live in their own sessions where the clip-app: scheme isn't even registered, so a dapp can never load
 * a wallet page; this check is the second wall.
 */

export const APP_SCHEME = "clip-app";
export const APP_HOST = "wallet";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** The slice of Electron's WebFrameMain this module reads. */
export interface FrameLike {
  readonly url: string;
  readonly origin?: string;
  readonly parent: unknown | null;
  readonly detached?: boolean;
}

/** The slice of an IpcMainEvent / IpcMainInvokeEvent this module reads. */
export interface IpcEventLike {
  readonly sender: { readonly id: number };
  readonly senderFrame: FrameLike | null;
}

export type Role = "wallet" | "approval" | "chrome";

/**
 * True when the event comes from the top frame of a registered app window with an app-origin URL.
 * `roles` maps webContents ids of our windows to their role; `allowed` lists the roles this channel accepts.
 * `devOrigin` is the electron-vite dev server (only set when the app runs unpackaged with ELECTRON_RENDERER_URL).
 */
export function isAppSender(e: IpcEventLike, roles: ReadonlyMap<number, Role>, allowed: readonly Role[], devOrigin?: string): boolean {
  const role = roles.get(e.sender.id);
  if (!role || !allowed.includes(role)) return false;
  const f = e.senderFrame;
  if (!f || f.detached || f.parent !== null) return false;
  let origin: string;
  try {
    const u = new URL(f.url);
    origin = u.protocol === `${APP_SCHEME}:` ? `${APP_SCHEME}://${u.host}` : u.origin;
  } catch {
    return false;
  }
  return origin === APP_ORIGIN || (!!devOrigin && origin === devOrigin);
}
