/** Native messaging: framing, host manifests per OS, and the host program between a mock browser and the desktop app. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { FrameDecoder, encodeFrame, MAX_TO_BROWSER } from "../src/native/framing.js";
import { hostManifest, installPlan, installTarget, nativeHostName, registryCommand } from "../src/native/manifests.js";
import { desktopSocketPath } from "../src/native/ipc.js";
import { runNativeHost, startDesktopLinkServer } from "../src/native/node.js";
import { until } from "./helpers.js";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXT}/`;

describe("framing", () => {
  it("is a 32-bit little-endian length then UTF-8 JSON, split anywhere", () => {
    const f = encodeFrame({ hello: "wörld" });
    expect(new DataView(f.buffer).getUint32(0, true)).toBe(f.length - 4);
    const d = new FrameDecoder();
    const both = new Uint8Array([...f, ...encodeFrame([1, 2])]);
    const out: unknown[] = [];
    for (let i = 0; i < both.length; i += 3) out.push(...d.push(both.subarray(i, i + 3)));
    expect(out).toEqual([{ hello: "wörld" }, [1, 2]]);
  });
  it("refuses messages to the browser over 1 MB and absurd lengths from it", () => {
    expect(() => encodeFrame("x".repeat(MAX_TO_BROWSER))).toThrow(RangeError);
    const bad = new Uint8Array(4);
    new DataView(bad.buffer).setUint32(0, 0xffffffff, true);
    expect(() => new FrameDecoder().push(bad)).toThrow(RangeError);
  });
});

describe("host manifests", () => {
  it("name, allowed_origins (Chromium) and allowed_extensions (Firefox)", () => {
    const name = nativeHostName("org.coldai.clip-wallet");
    expect(name).toBe("org.coldai.clip_wallet.link");
    expect(hostManifest("chrome", { name, path: "/Applications/Clip.app/host", chromiumExtensionIds: [EXT], firefoxAddonIds: [] })).toEqual({
      name,
      description: "Clip Desktop signer for the Clip Wallet extension",
      path: "/Applications/Clip.app/host",
      type: "stdio",
      allowed_origins: [ORIGIN],
    });
    expect(hostManifest("firefox", { name, path: "/x", chromiumExtensionIds: [], firefoxAddonIds: ["wallet@clip.example"] }).allowed_extensions).toEqual(["wallet@clip.example"]);
    expect(() => hostManifest("chrome", { name, path: "/x", chromiumExtensionIds: ["*"], firefoxAddonIds: [] })).toThrow();
  });
  it("per-OS user install locations", () => {
    const n = "org.coldai.clip_wallet.link";
    expect(installTarget("darwin", "chrome", n, { home: "/mac-home/a" }).manifestPath).toBe(`/mac-home/a/Library/Application Support/Google/Chrome/NativeMessagingHosts/${n}.json`);
    expect(installTarget("darwin", "brave", n, { home: "/mac-home/a" }).manifestPath).toBe(`/mac-home/a/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/${n}.json`);
    expect(installTarget("darwin", "edge", n, { home: "/mac-home/a" }).manifestPath).toBe(`/mac-home/a/Library/Application Support/Microsoft Edge/NativeMessagingHosts/${n}.json`);
    expect(installTarget("darwin", "firefox", n, { home: "/mac-home/a" }).manifestPath).toBe(`/mac-home/a/Library/Application Support/Mozilla/NativeMessagingHosts/${n}.json`);
    expect(installTarget("linux", "chrome", n, { home: "/home/a" }).manifestPath).toBe(`/home/a/.config/google-chrome/NativeMessagingHosts/${n}.json`);
    expect(installTarget("linux", "chromium", n, { home: "/home/a" }).manifestPath).toBe(`/home/a/.config/chromium/NativeMessagingHosts/${n}.json`);
    expect(installTarget("linux", "firefox", n, { home: "/home/a" }).manifestPath).toBe(`/home/a/.mozilla/native-messaging-hosts/${n}.json`);
    const w = installTarget("win32", "edge", n, { home: "C:\\Users\\a", appData: "C:\\Users\\a\\AppData\\Local" });
    expect(w).toEqual({ kind: "registry", browser: "edge", key: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${n}`, manifestPath: `C:\\Users\\a\\AppData\\Local\\Clip Wallet\\NativeMessagingHosts\\edge\\${n}.json` });
    expect(registryCommand(w as never)).toEqual(["reg", "add", w.kind === "registry" ? w.key : "", "/ve", "/t", "REG_SZ", "/d", w.manifestPath, "/f"]);
    expect(installPlan("linux", { rdns: "org.coldai.clipwallet", hostPath: "/opt/clip/host", chromiumExtensionIds: [EXT], firefoxAddonIds: ["wallet@x"], home: "/home/a" })).toHaveLength(5);
  });
  it("socket paths are per user", () => {
    expect(desktopSocketPath("linux", { home: "/home/a", user: "a", xdgRuntimeDir: "/run/user/1000" })).toBe("/run/user/1000/clip-wallet/desktop.sock");
    expect(desktopSocketPath("win32", { home: "C:\\Users\\a", user: "a" })).toMatch(/^\\\\\.\\pipe\\clip-wallet-link-[0-9a-f]{16}$/);
    expect(desktopSocketPath("win32", { home: "", user: "a" })).not.toBe(desktopSocketPath("win32", { home: "", user: "b" }));
  });
});

describe("native host program (mock browser on stdio ⇄ desktop socket)", () => {
  it("forwards frames both ways and tells the extension the desktop is connected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-link-"));
    const path = join(dir, "d.sock");
    const got: string[] = [];
    const srv = await startDesktopLinkServer({
      path,
      allowedOrigins: [ORIGIN],
      onConnection: ({ channel, origin }) => {
        expect(origin).toBe(ORIGIN);
        channel.onMessage((f) => {
          got.push(f);
          channel.send(`echo:${f}`);
        });
      },
    });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const fromHost: unknown[] = [];
    const dec = new FrameDecoder();
    stdout.on("data", (c) => fromHost.push(...dec.push(c)));
    const done = runNativeHost({ stdin, stdout, origin: ORIGIN, connectDesktop: () => connect(path) });
    await until(() => fromHost.length > 0);
    expect(fromHost[0]).toEqual({ host: "status", status: "connected" });
    stdin.write(encodeFrame({ f: "ping-1" }));
    await until(() => fromHost.length > 1);
    expect(got).toEqual(["ping-1"]);
    expect(fromHost[1]).toEqual({ f: "echo:ping-1" });
    stdin.end();
    expect(await done).toBe(0);
    await srv.close();
  });

  it("says 'desktop not running' when nothing listens, and the server drops unknown extensions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-link-"));
    const stdout = new PassThrough();
    const out: unknown[] = [];
    const dec = new FrameDecoder();
    stdout.on("data", (c) => out.push(...dec.push(c)));
    const code = await runNativeHost({ stdin: new PassThrough(), stdout, origin: ORIGIN, connectDesktop: () => connect(join(dir, "none.sock")) });
    expect(code).toBe(1);
    expect(out).toEqual([{ host: "status", status: "desktop-not-running" }]);

    const path = join(dir, "d2.sock");
    let connections = 0;
    const srv = await startDesktopLinkServer({ path, allowedOrigins: [ORIGIN], onConnection: () => connections++ });
    const stdout2 = new PassThrough();
    const r = runNativeHost({ stdin: new PassThrough(), stdout: stdout2, origin: "chrome-extension://pppppppppppppppppppppppppppppppp/", connectDesktop: () => connect(path) });
    expect(await r).toBe(0);
    expect(connections).toBe(0);
    await srv.close();
  });
});
