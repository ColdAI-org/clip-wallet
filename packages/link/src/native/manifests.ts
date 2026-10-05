/**
 * Native-messaging host manifests and where each browser looks for them, per OS (user-level installs, so no admin
 * rights are needed). Sources, checked 2026-10:
 *   Chrome / Chromium: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 *   Edge:              https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/native-messaging
 *   Firefox:           https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
 *   Brave:             Brave's user data dir (BraveSoftware/Brave-Browser); on Windows Brave also reads
 *                      HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts (community docs, see README)
 *
 * Chromium-family manifests use `allowed_origins: ["chrome-extension://<id>/"]` (no wildcards); Firefox uses
 * `allowed_extensions: ["<add-on id>"]`. The host name may only contain lowercase letters, digits, "_" and ".".
 */
export type BrowserKind = "chrome" | "chromium" | "edge" | "brave" | "firefox";
export type HostOS = "darwin" | "linux" | "win32";
export const BROWSERS: readonly BrowserKind[] = ["chrome", "chromium", "edge", "brave", "firefox"];

export interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins?: string[];
  allowed_extensions?: string[];
}

const HOST_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** "org.coldai.clipwallet" → the host name; refuses names browsers would reject. */
export function nativeHostName(rdns: string): string {
  const n = `${rdns.toLowerCase().replace(/[^a-z0-9_.]/g, "_")}.link`;
  if (!HOST_NAME.test(n)) throw new RangeError(`"${n}" isn't a valid native messaging host name`);
  return n;
}

export function hostManifest(
  browser: BrowserKind,
  p: { name: string; path: string; chromiumExtensionIds: string[]; firefoxAddonIds: string[]; description?: string },
): HostManifest {
  if (!HOST_NAME.test(p.name)) throw new RangeError("invalid host name");
  const base = { name: p.name, description: p.description ?? "Clip Desktop signer for the Clip Wallet extension", path: p.path, type: "stdio" as const };
  if (browser === "firefox") return { ...base, allowed_extensions: [...p.firefoxAddonIds] };
  for (const id of p.chromiumExtensionIds) if (!/^[a-p]{32}$/.test(id)) throw new RangeError(`"${id}" isn't a Chromium extension id`);
  return { ...base, allowed_origins: p.chromiumExtensionIds.map((id) => `chrome-extension://${id}/`) };
}

export type InstallTarget =
  | { kind: "file"; browser: BrowserKind; manifestPath: string }
  | { kind: "registry"; browser: BrowserKind; key: string; manifestPath: string };

const join = (os: HostOS, ...parts: string[]) => parts.join(os === "win32" ? "\\" : "/");

const MAC_DIRS: Record<BrowserKind, string> = {
  chrome: "Library/Application Support/Google/Chrome/NativeMessagingHosts",
  chromium: "Library/Application Support/Chromium/NativeMessagingHosts",
  edge: "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
  brave: "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
  firefox: "Library/Application Support/Mozilla/NativeMessagingHosts",
};
const LINUX_DIRS: Record<BrowserKind, string> = {
  chrome: ".config/google-chrome/NativeMessagingHosts",
  chromium: ".config/chromium/NativeMessagingHosts",
  edge: ".config/microsoft-edge/NativeMessagingHosts",
  brave: ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
  firefox: ".mozilla/native-messaging-hosts",
};
const WIN_KEYS: Record<BrowserKind, string> = {
  chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
  chromium: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
  edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
  brave: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
  firefox: "HKCU\\Software\\Mozilla\\NativeMessagingHosts",
};

/**
 * Where to write the manifest for one browser. `home` = the user's home directory; on Windows `appData` =
 * %LOCALAPPDATA% (manifests live there and a per-user registry key points at them).
 */
export function installTarget(os: HostOS, browser: BrowserKind, name: string, dirs: { home: string; appData?: string }): InstallTarget {
  if (os === "darwin") return { kind: "file", browser, manifestPath: join(os, dirs.home, MAC_DIRS[browser], `${name}.json`) };
  if (os === "linux") return { kind: "file", browser, manifestPath: join(os, dirs.home, LINUX_DIRS[browser], `${name}.json`) };
  const appData = dirs.appData ?? join(os, dirs.home, "AppData", "Local");
  // Firefox's manifest differs (allowed_extensions), so each browser gets its own file.
  const manifestPath = join(os, appData, "Clip Wallet", "NativeMessagingHosts", browser, `${name}.json`);
  return { kind: "registry", browser, key: `${WIN_KEYS[browser]}\\${name}`, manifestPath };
}

/** The command a Windows installer runs to register one target (REG ADD … /ve sets the key's default value). */
export function registryCommand(t: Extract<InstallTarget, { kind: "registry" }>): string[] {
  return ["reg", "add", t.key, "/ve", "/t", "REG_SZ", "/d", t.manifestPath, "/f"];
}

/** Everything an installer writes for every supported browser on one OS. */
export function installPlan(
  os: HostOS,
  p: { rdns: string; hostPath: string; chromiumExtensionIds: string[]; firefoxAddonIds: string[]; home: string; appData?: string },
): { target: InstallTarget; manifest: HostManifest }[] {
  const name = nativeHostName(p.rdns);
  return BROWSERS.filter((b) => (b === "firefox" ? p.firefoxAddonIds.length > 0 : p.chromiumExtensionIds.length > 0)).map((b) => ({
    target: installTarget(os, b, name, p),
    manifest: hostManifest(b, { name, path: p.hostPath, chromiumExtensionIds: p.chromiumExtensionIds, firefoxAddonIds: p.firefoxAddonIds }),
  }));
}
