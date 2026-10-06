/**
 * Node-only pieces of the desktop link, for the Clip Desktop (Electron) stream to bundle:
 *
 *   runNativeHost      the native-messaging host program the browser starts (stdio ⇄ the desktop app's socket).
 *                      It's a dumb, size-checked pipe: frames are already end-to-end encrypted between the
 *                      extension and the desktop app after pairing, so the host never sees wallet data.
 *   nativeHostMain     its entry point (argv[1] = calling extension origin, per the native-messaging spec).
 *   startDesktopLinkServer  the desktop app's side: a per-user socket / named pipe; each connection becomes a Channel.
 *
 * Exact wiring for apps/desktop: docs/r1/integration/connect.md.
 *
 * @module
 */
import { chmodSync, mkdirSync, rmSync, statSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import { BaseChannel } from "../pairing/channel.js";
import { FrameDecoder, MAX_TO_BROWSER, encodeFrame } from "./framing.js";
import { desktopSocketPath, type HostHello, type HostStatus } from "./ipc.js";
import type { HostOS } from "./manifests.js";

export function defaultSocketPath(): string {
  return desktopSocketPath(process.platform as HostOS, {
    home: homedir(),
    user: userInfo().username,
    ...(process.env.XDG_RUNTIME_DIR ? { xdgRuntimeDir: process.env.XDG_RUNTIME_DIR } : {}),
    tmpDir: tmpdir(),
  });
}

export interface NativeHostOptions {
  stdin: Readable;
  stdout: Writable;
  /** argv[1]: "chrome-extension://<id>/" (Chromium) or the add-on id (Firefox). */
  origin: string;
  /** Opens the connection to the desktop app. */
  connectDesktop(): Socket | (Readable & Writable & { destroy(): void; on(ev: string, cb: (...a: unknown[]) => void): unknown });
  /** Origins this host serves (defence in depth: the browser already enforces the manifest's list). */
  allowedOrigins?: string[];
}

/** Pipes browser ⇄ desktop until either side ends. Resolves with an exit code. */
export function runNativeHost(o: NativeHostOptions): Promise<number> {
  return new Promise((resolve) => {
    const toBrowser = (m: unknown) => {
      try {
        o.stdout.write(encodeFrame(m, MAX_TO_BROWSER));
      } catch {
        /* oversized frame from the desktop app: drop it */
      }
    };
    if (o.allowedOrigins && !o.allowedOrigins.includes(o.origin)) {
      toBrowser({ host: "status", status: "desktop-not-running" } satisfies HostStatus);
      resolve(2);
      return;
    }
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(code);
    };
    const sock = o.connectDesktop();
    const fromDesktop = new FrameDecoder(MAX_TO_BROWSER);
    const fromBrowser = new FrameDecoder();
    let up = false;
    sock.on("connect", () => {
      up = true;
      sock.write(encodeFrame({ host: "hello", v: 1, origin: o.origin } satisfies HostHello));
      toBrowser({ host: "status", status: "connected" } satisfies HostStatus);
    });
    sock.on("data", (chunk: unknown) => {
      try {
        for (const m of fromDesktop.push(chunk as Uint8Array)) toBrowser(m);
      } catch {
        finish(3);
      }
    });
    sock.on("error", () => {
      if (!up) toBrowser({ host: "status", status: "desktop-not-running" } satisfies HostStatus);
      finish(up ? 4 : 1);
    });
    sock.on("close", () => {
      if (up) toBrowser({ host: "status", status: "desktop-closed" } satisfies HostStatus);
      finish(0);
    });
    o.stdin.on("data", (chunk: Buffer) => {
      try {
        for (const m of fromBrowser.push(chunk)) if (up) sock.write(encodeFrame(m, 8 * 1024 * 1024));
      } catch {
        finish(3);
      }
    });
    o.stdin.on("end", () => finish(0));
  });
}

/** Entry point of the bundled host program (`node host.js` or a compiled single binary). */
export async function nativeHostMain(argv = process.argv): Promise<void> {
  // Chromium passes the caller's origin as the first argument; Firefox passes the manifest path, then the add-on id.
  const first = argv[2] ?? "";
  const origin = first.endsWith(".json") ? (argv[3] ?? "") : first;
  const path = process.env.CLIP_DESKTOP_SOCKET || defaultSocketPath();
  const code = await runNativeHost({ stdin: process.stdin, stdout: process.stdout, origin, connectDesktop: () => connect(path) });
  process.exit(code);
}

export interface DesktopConnection {
  channel: BaseChannel;
  /** The extension that's calling, as its browser reported it to the host. */
  origin: string;
}

/**
 * The desktop app's listener. Creates the socket in a 0700 directory and chmods it 0600 (Unix); on Windows the
 * pipe name is per-user (ipc.ts). `allowedOrigins` = the extension ids the desktop build trusts.
 */
export function startDesktopLinkServer(o: { path?: string; allowedOrigins: string[]; onConnection(c: DesktopConnection): void }): Promise<{ server: Server; path: string; close(): Promise<void> }> {
  const path = o.path ?? defaultSocketPath();
  const unix = !path.startsWith("\\\\.\\pipe\\");
  if (unix) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    try {
      if (statSync(path).isSocket()) rmSync(path);
    } catch {
      /* no stale socket */
    }
  }
  const server = createServer((sock) => {
    const dec = new FrameDecoder();
    let ch: BaseChannel | undefined;
    sock.on("data", (chunk) => {
      let frames: unknown[];
      try {
        frames = dec.push(chunk);
      } catch {
        sock.destroy();
        return;
      }
      for (const m of frames) {
        if (!ch) {
          const hello = m as Partial<HostHello>;
          if (hello?.host !== "hello" || typeof hello.origin !== "string" || !o.allowedOrigins.includes(hello.origin)) {
            sock.destroy();
            return;
          }
          ch = new BaseChannel(
            (f) => sock.write(encodeFrame({ f }, MAX_TO_BROWSER)),
            () => sock.end(),
          );
          o.onConnection({ channel: ch, origin: hello.origin });
          continue;
        }
        const f = (m as { f?: unknown })?.f;
        if (typeof f === "string") ch.deliver(f);
      }
    });
    sock.on("close", () => ch?.ended("closed"));
    sock.on("error", () => ch?.ended("error"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      if (unix) chmodSync(path, 0o600);
      resolve({ server, path, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}
