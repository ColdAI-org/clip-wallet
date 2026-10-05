/** Browser connector: native-messaging manifests + launcher are written, recognised and removed per OS. */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedOrigins, connectorStatus, installConnector, launcherPath, launcherScript, parseExtensionIds, removeConnector, type ConnectorEnv } from "../src/main/native-hosts";
import { parseDeepLink } from "../src/main/deeplink";

const EXT = "abcdefghijklmnopabcdefghijklmnop";

function env(os: ConnectorEnv["os"], over: Partial<ConnectorEnv> = {}): ConnectorEnv {
  const home = mkdtempSync(join(tmpdir(), "clip-nm-"));
  return {
    os,
    rdns: "org.coldai.clipwallet",
    home,
    launcherDir: join(home, "userData", "native-host"),
    execPath: "/Applications/Clip Wallet.app/Contents/MacOS/Clip Wallet",
    scriptPath: "/Applications/Clip Wallet.app/Contents/Resources/app.asar.unpacked/out/native-host/clip-native-host.cjs",
    chromiumExtensionIds: [EXT],
    firefoxAddonIds: ["wallet@clipwallet.coldai.org"],
    ...over,
  };
}

describe("browser connector (native-messaging host registration)", () => {
  it("macOS: writes a launcher and one manifest per browser, then removes only its own files", () => {
    const e = env("darwin");
    expect(connectorStatus(e).browsers.every((b) => !b.installed)).toBe(true);
    const v = installConnector(e);
    expect(v.browsers.map((b) => [b.browser, b.installed])).toEqual([["chrome", true], ["chromium", true], ["edge", true], ["brave", true], ["firefox", true]]);
    const chrome = JSON.parse(readFileSync(join(e.home, "Library/Application Support/Google/Chrome/NativeMessagingHosts/org.coldai.clipwallet.link.json"), "utf8"));
    expect(chrome).toMatchObject({ name: "org.coldai.clipwallet.link", type: "stdio", path: launcherPath(e), allowed_origins: [`chrome-extension://${EXT}/`] });
    const ff = JSON.parse(readFileSync(join(e.home, "Library/Application Support/Mozilla/NativeMessagingHosts/org.coldai.clipwallet.link.json"), "utf8"));
    expect(ff.allowed_extensions).toEqual(["wallet@clipwallet.coldai.org"]);
    expect(statSync(launcherPath(e)).mode & 0o777).toBe(0o700);
    expect(readFileSync(launcherPath(e), "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");
    // Someone else's manifest with the same name (another install) is left alone.
    const brave = join(e.home, "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/org.coldai.clipwallet.link.json");
    writeFileSync(brave, JSON.stringify({ name: "org.coldai.clipwallet.link", path: "/somewhere/else" }));
    expect(connectorStatus(e).browsers.find((b) => b.browser === "brave")!.installed).toBe(false);
    const after = removeConnector(e);
    expect(after.browsers.every((b) => !b.installed)).toBe(true);
    expect(existsSync(brave)).toBe(true);
    expect(existsSync(launcherPath(e))).toBe(false);
  });

  it("an update that moves the app is noticed (path mismatch) and repaired", () => {
    const e = env("linux");
    installConnector(e);
    const moved = { ...e, scriptPath: "/opt/Clip Wallet/resources/app.asar.unpacked/out/native-host/clip-native-host.cjs" };
    expect(connectorStatus(moved).browsers.every((b) => b.installed)).toBe(true); // manifests point at the launcher…
    expect(readFileSync(launcherPath(e), "utf8")).not.toContain("/opt/Clip Wallet");
    installConnector(moved); // …and repair rewrites the launcher for the new location
    expect(readFileSync(launcherPath(e), "utf8")).toContain("/opt/Clip Wallet");
    expect(existsSync(join(e.home, ".mozilla/native-messaging-hosts/org.coldai.clipwallet.link.json"))).toBe(true);
  });

  it("Windows: manifests under LOCALAPPDATA and an HKCU key per browser (reg add / query / delete)", () => {
    const reg = new Map<string, string>();
    const exec = (cmd: string, a: string[]) => {
      expect(cmd).toBe("reg");
      if (a[0] === "add") reg.set(a[1]!, a[a.indexOf("/d") + 1]!);
      if (a[0] === "delete") reg.delete(a[1]!);
      if (a[0] === "query") {
        if (!reg.has(a[1]!)) throw new Error("not found");
        return `    (Default)    REG_SZ    ${reg.get(a[1]!)}`;
      }
      return "";
    };
    const base = env("win32");
    const e = { ...base, appData: join(base.home, "AppData", "Local"), execPath: "C:\\Program Files\\Clip Wallet\\Clip Wallet.exe", exec };
    installConnector(e);
    expect([...reg.keys()]).toContain("HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\org.coldai.clipwallet.link");
    expect(connectorStatus(e).browsers.every((b) => b.installed)).toBe(true);
    expect(launcherScript(e)).toMatch(/^@echo off\r\n[\s\S]*set ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\Clip Wallet\\Clip Wallet\.exe" ".*clip-native-host\.cjs" %\*/);
    removeConnector(e);
    expect(reg.size).toBe(0);
  });

  it("only real extension ids are trusted; Chromium origins and Firefox ids for the socket", () => {
    expect(parseExtensionIds(`${EXT}, nope, ${EXT} ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP`)).toEqual([EXT]);
    expect(allowedOrigins([EXT], ["wallet@x"])).toEqual([`chrome-extension://${EXT}/`, "wallet@x"]);
    const none = env("darwin", { chromiumExtensionIds: [], firefoxAddonIds: [] });
    expect(connectorStatus(none)).toEqual({ available: false, browsers: [] });
  });

  it("launcher quoting survives spaces and quotes in paths", () => {
    const e = env("linux", { execPath: "/opt/it's here/clip", socketOverride: "/tmp/a b/s.sock" });
    expect(launcherScript(e)).toContain(`'/opt/it'\\''s here/clip'`);
    expect(launcherScript(e)).toContain(`CLIP_DESKTOP_SOCKET='/tmp/a b/s.sock'`);
    mkdirSync(e.launcherDir, { recursive: true });
  });
});

describe("linked-device deep links", () => {
  it("a handoff link (with a token) and a pairing code", () => {
    const h = `clipwallet://browse?url=${encodeURIComponent("https://app.example/swap")}&h=${"A".repeat(80)}`;
    expect(parseDeepLink(h)).toEqual({ kind: "handoff", link: h, url: "https://app.example/swap" });
    // No token: just open it. A token on plain http is ignored.
    expect(parseDeepLink("clipwallet://browse?url=https%3A%2F%2Fapp.example")).toEqual({ kind: "browse", url: "https://app.example" });
    expect(parseDeepLink("clipwallet://browse?url=http%3A%2F%2Flocalhost%3A3000&h=x")).toEqual({ kind: "browse", url: "http://localhost:3000" });
    expect(parseDeepLink("clipwallet://link?v=1&c=abc")).toEqual({ kind: "pair", uri: "clipwallet://link?v=1&c=abc" });
  });
});
