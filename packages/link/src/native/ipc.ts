/**
 * Where the native-messaging host finds the running Clip Desktop app: a Unix domain socket in a per-user 0700
 * directory (macOS, Linux) or a per-user named pipe (Windows). Only processes of the same OS user can reach it,
 * and even they can't do anything without pairing (the desktop app shows a code the person must confirm).
 */
import { sha256, toHex, utf8 } from "../bytes.js";
import type { HostOS } from "./manifests.js";

/** macOS sockaddr_un.sun_path is 104 bytes; leave room. */
const MAX_UNIX_PATH = 100;

export function desktopSocketPath(os: HostOS, env: { home: string; user: string; xdgRuntimeDir?: string; tmpDir?: string }): string {
  if (os === "win32") return `\\\\.\\pipe\\clip-wallet-link-${toHex(sha256(utf8(env.user.toLowerCase()))).slice(0, 16)}`;
  const dir =
    os === "darwin"
      ? `${env.home}/Library/Application Support/Clip Wallet/link`
      : env.xdgRuntimeDir
        ? `${env.xdgRuntimeDir}/clip-wallet`
        : `${env.home}/.cache/clip-wallet`;
  const p = `${dir}/desktop.sock`;
  if (p.length <= MAX_UNIX_PATH || !env.tmpDir) return p;
  // Very long home directories: the per-user temp dir (macOS $TMPDIR is per user and 0700).
  return `${env.tmpDir.replace(/\/+$/, "")}/clip-wallet-link.sock`;
}

/** First frame the host sends the desktop app on every connection. */
export interface HostHello {
  host: "hello";
  v: 1;
  /** The calling extension, as the browser passed it (argv[1]); the browser already checked allowed_origins. */
  origin: string;
}

/** Status frames the host sends to the extension (never carry wallet data). */
export interface HostStatus {
  host: "status";
  status: "connected" | "desktop-not-running" | "desktop-closed";
}
