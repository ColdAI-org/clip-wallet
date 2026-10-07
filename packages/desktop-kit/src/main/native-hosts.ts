/**
 * The browser connector: registers Clip Desktop's native-messaging host with Chrome, Chromium, Edge, Brave and
 * Firefox for this user (no admin rights), so the Clip Wallet extension can reach this app
 * (packages/link/src/native/manifests.ts has the per-browser locations and their sources).
 *
 *   launcher  <userData>/native-host/clip-native-host (sh) or .cmd (Windows): runs the bundled host program
 *             (out/native-host/clip-native-host.cjs, @clip-wallet/link/node nativeHostMain) with this app's own
 *             executable as Node (ELECTRON_RUN_AS_NODE=1). Rewritten on every repair, so it always points at the
 *             current install after an update or a move.
 *   manifests one JSON per browser naming the launcher and the extension ids this build trusts; on Windows a
 *             HKCU registry key per browser points at it.
 *
 * The host program is a size-checked pipe between the browser's stdio and the app's per-user socket; after pairing
 * every frame is end-to-end encrypted between the extension and this app.
 *
 * Packaged builds install on first run and on every version change; Settings → Linked devices → Browser extension
 * has "Set up again" (repair) and "Remove". Unpackaged (dev / tests) builds never touch the real browser profiles
 * unless asked, and CLIP_DESKTOP_NM_HOME redirects them to a test folder.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BROWSERS, installPlan, installTarget, nativeHostName, registryCommand, type BrowserKind, type HostManifest, type HostOS, type InstallTarget } from "@clip-wallet/link/native";

export interface ConnectorEnv {
  os: HostOS;
  rdns: string;
  /** Home directory (or the test override) for the per-user manifest folders. */
  home: string;
  /** %LOCALAPPDATA% on Windows. */
  appData?: string;
  /** Where the launcher script goes (inside userData). */
  launcherDir: string;
  /** The executable that runs the host program as Node (process.execPath). */
  execPath: string;
  /** Absolute path of the bundled host program (outside app.asar). */
  scriptPath: string;
  chromiumExtensionIds: string[];
  firefoxAddonIds: string[];
  /** Tests only: the socket the launcher should connect to. */
  socketOverride?: string;
  /** Windows registry (injectable for tests). */
  exec?(cmd: string, args: string[]): string;
}

export interface BrowserConnectorView {
  /** False when this build trusts no extension id at all (nothing to set up). */
  available: boolean;
  browsers: { browser: BrowserKind; installed: boolean }[];
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The launcher the manifests point at (absolute path). */
export function launcherPath(e: Pick<ConnectorEnv, "os" | "launcherDir">): string {
  return join(e.launcherDir, e.os === "win32" ? "clip-native-host.cmd" : "clip-native-host");
}

export function launcherScript(e: ConnectorEnv): string {
  if (e.os === "win32") {
    const lines = ["@echo off", "setlocal", "set ELECTRON_RUN_AS_NODE=1"];
    if (e.socketOverride) lines.push(`set "CLIP_DESKTOP_SOCKET=${e.socketOverride}"`);
    lines.push(`"${e.execPath}" "${e.scriptPath}" %*`, "");
    return lines.join("\r\n");
  }
  const env = [`ELECTRON_RUN_AS_NODE=1`, ...(e.socketOverride ? [`CLIP_DESKTOP_SOCKET=${sh(e.socketOverride)}`] : [])].join(" ");
  return `#!/bin/sh\n# Clip Desktop native-messaging host (written by the app; "Set up again" in Linked devices rewrites it).\nexec env ${env} ${sh(e.execPath)} ${sh(e.scriptPath)} "$@"\n`;
}

function plan(e: ConnectorEnv) {
  return installPlan(e.os, {
    rdns: e.rdns,
    hostPath: launcherPath(e),
    chromiumExtensionIds: e.chromiumExtensionIds,
    firefoxAddonIds: e.firefoxAddonIds,
    home: e.home,
    ...(e.appData ? { appData: e.appData } : {}),
  });
}

const run = (e: ConnectorEnv, cmd: string[]) => (e.exec ?? ((c, a) => execFileSync(c, a, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString()))(cmd[0]!, cmd.slice(1));

function registered(e: ConnectorEnv, t: InstallTarget): boolean {
  if (t.kind !== "registry") return true;
  try {
    return run(e, ["reg", "query", t.key, "/ve"]).includes(t.manifestPath);
  } catch {
    return false;
  }
}

function readManifest(path: string): HostManifest | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HostManifest;
  } catch {
    return null;
  }
}

/** Which browsers have a manifest that points at this install's launcher and trusts this build's extension ids. */
export function connectorStatus(e: ConnectorEnv): BrowserConnectorView {
  const p = plan(e);
  const want = new Map(p.map((x) => [x.target.browser, x]));
  return {
    available: p.length > 0,
    browsers: BROWSERS.filter((b) => want.has(b)).map((browser) => {
      const x = want.get(browser)!;
      const m = readManifest(x.target.manifestPath);
      const ok = !!m && JSON.stringify(m) === JSON.stringify(x.manifest) && existsSync(launcherPath(e)) && registered(e, x.target);
      return { browser, installed: ok };
    }),
  };
}

/** Writes the launcher and every browser's manifest (and registry key on Windows). Idempotent. */
export function installConnector(e: ConnectorEnv): BrowserConnectorView {
  mkdirSync(e.launcherDir, { recursive: true, mode: 0o700 });
  const launcher = launcherPath(e);
  writeFileSync(launcher, launcherScript(e), { mode: 0o700 });
  if (e.os !== "win32") chmodSync(launcher, 0o700);
  for (const { target, manifest } of plan(e)) {
    mkdirSync(dirname(target.manifestPath), { recursive: true });
    writeFileSync(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (target.kind === "registry") run(e, registryCommand(target));
  }
  return connectorStatus(e);
}

/** Removes every manifest this app wrote (all browsers, whatever ids), the registry keys and the launcher. */
export function removeConnector(e: ConnectorEnv): BrowserConnectorView {
  const name = nativeHostName(e.rdns);
  for (const browser of BROWSERS) {
    const t = installTarget(e.os, browser, name, { home: e.home, ...(e.appData ? { appData: e.appData } : {}) });
    const m = readManifest(t.manifestPath);
    // Only remove what is ours: a manifest with our host name that points at our launcher.
    if (m && m.name === name && m.path === launcherPath(e)) rmSync(t.manifestPath, { force: true });
    if (t.kind === "registry") {
      try {
        run(e, ["reg", "delete", t.key, "/f"]);
      } catch {
        /* not there */
      }
    }
  }
  rmSync(launcherPath(e), { force: true });
  return connectorStatus(e);
}

/** "abcd…" ids from a comma/space separated list; anything that isn't a Chromium id is dropped. */
export function parseExtensionIds(list: string | undefined): string[] {
  return [...new Set((list ?? "").split(/[\s,]+/).filter((x) => /^[a-p]{32}$/.test(x)))];
}

/** The extension origins the desktop socket accepts (same ids as the manifests). */
export function allowedOrigins(chromiumIds: string[], firefoxIds: string[]): string[] {
  return [...chromiumIds.map((id) => `chrome-extension://${id}/`), ...firefoxIds];
}
