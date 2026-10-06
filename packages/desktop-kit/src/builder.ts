/**
 * The electron-builder config for a Clip Wallet desktop app, from clip.config.ts (https://www.electron.build/configuration):
 *
 *   // electron-builder.config.cjs
 *   const { electronBuilderConfig } = require("@clip-wallet/desktop-kit/builder");
 *   module.exports = electronBuilderConfig({ configFile: "../../clip.config.ts", root: __dirname });
 *
 *   macOS    dmg + zip, arm64 and x64; hardened runtime with build/entitlements.mac*.plist; icon build/icon.icns
 *   Windows  NSIS installer + zip, x64 and arm64; icon build/icon.ico
 *   Linux    AppImage + deb + tar.gz, x64 and arm64; icons build/icons/<size>x<size>.png
 *
 * App id, product name, executable and artifact names and the deep-link scheme come from platformIds(config).
 * Signing and notarization read electron-builder's standard environment variables and are skipped when they are
 * absent (local builds and CI without secrets produce unsigned artifacts); see docs/signing.md in a wallet project:
 *   macOS signing      CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application .p12), or CSC_NAME
 *   macOS notarization APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
 *   Windows signing    WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK on a Windows runner)
 * Auto-update metadata only for CLIP_UPDATES=1 builds, published to CLIP_UPDATES_OWNER / CLIP_UPDATES_REPO on GitHub.
 * Pure apart from reading clip.config.ts when only configFile is given (exported for tests).
 */
import { resolve } from "node:path";
import { platformIds, type ClipConfig } from "@clip-wallet/config";
import { loadClipConfigSync } from "@clip-wallet/config/node";

export interface BuilderOptions {
  /** The resolved clip.config (or give configFile). */
  config?: ClipConfig;
  /** clip.config.ts, relative to root (read with loadClipConfigSync). */
  configFile?: string;
  /** The desktop project directory. Default: process.cwd(). */
  root?: string;
  /** Build environment (signing switches, CLIP_UPDATES). Default: process.env. */
  env?: Record<string, string | undefined>;
  /** Icons, relative to root. Default: the ones create-clip-wallet generates from the wallet's logo. */
  icons?: { mac?: string; win?: string; linux?: string };
  /** "Copyright © 2026 Acme". Default: from the name. */
  copyright?: string;
  /** Linux package maintainer, "Name <email>". Default: the wallet's name. */
  maintainer?: string;
  /** Linux synopsis. Default: from the description. */
  synopsis?: string;
}

/** The icon files a desktop project carries (generated from the one logo by create-clip-wallet). */
export const DESKTOP_ICONS = { mac: "build/icon.icns", win: "build/icon.ico", linux: "build/icons" } as const;

/** Chromium UI locales to keep for the languages a wallet offers (macOS names some with "_", Windows/Linux with "-"). */
export function electronLanguages(languages: readonly string[]): string[] {
  const out = new Set<string>();
  for (const l of languages) {
    if (l === "pt-BR") out.add("pt-BR").add("pt_BR");
    else if (l === "zh-Hans") out.add("zh-CN").add("zh_CN");
    else out.add(l);
  }
  out.add("en");
  return [...out];
}

export function electronBuilderConfig(options: BuilderOptions) {
  const root = resolve(options.root ?? process.cwd());
  const config = options.config ?? loadClipConfigSync(options.configFile ?? "clip.config.ts", { cwd: root });
  const env = options.env ?? process.env;
  const ids = platformIds(config);
  const icons = { ...DESKTOP_ICONS, ...options.icons };
  const macSign = !!(env.CSC_LINK || env.CSC_NAME);
  const notarize =
    macSign && !!((env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID));
  const updates = env.CLIP_UPDATES === "1";
  const testnet = config.mainnet === false;
  const synopsis = options.synopsis ?? `${config.description ?? `${config.name}: a non-custodial wallet with a built-in dapp browser.`}${testnet ? " Test networks only." : ""}`;

  return {
    appId: ids.desktop.appId,
    productName: ids.desktop.productName,
    // A name that is safe in file paths (deb package, Linux executable, NSIS archives); the display name stays productName.
    extraMetadata: { name: `${ids.desktop.executableName}-desktop` },
    copyright: options.copyright ?? `Copyright © ${new Date().getFullYear()} ${config.name}`,
    directories: { output: "release", buildResources: "build" },
    files: ["out/**/*", "package.json", "!out/**/*.map"],
    asar: true,
    // The native-messaging host program runs with ELECTRON_RUN_AS_NODE from a plain file path.
    asarUnpack: ["out/native-host/**"],
    npmRebuild: false,
    nodeGypRebuild: false,
    electronLanguages: electronLanguages(config.languages),
    protocols: [{ name: config.name, schemes: [ids.scheme] }],
    artifactName: ids.desktop.artifactName,
    mac: {
      category: "public.app-category.finance",
      icon: icons.mac,
      target: [
        { target: "dmg", arch: ["arm64", "x64"] },
        { target: "zip", arch: ["arm64", "x64"] },
      ],
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: "build/entitlements.mac.plist",
      entitlementsInherit: "build/entitlements.mac.inherit.plist",
      // null = don't sign (and don't pick up a random identity from the keychain) when no certificate is configured.
      ...(macSign ? {} : { identity: null }),
      notarize,
      extendInfo: {
        NSCameraUsageDescription: `${config.name} uses the camera only to scan QR codes (WalletConnect codes and Keystone hardware wallets).`,
        NSMicrophoneUsageDescription: `${config.name} doesn't use the microphone. Sites you open in the built-in browser have to ask first.`,
      },
    },
    dmg: { sign: false },
    win: {
      icon: icons.win,
      target: [
        { target: "nsis", arch: ["x64", "arm64"] },
        { target: "zip", arch: ["x64", "arm64"] },
      ],
      // Editing the .exe resources (icon, version info) and signing use rcedit / signtool: on Windows runners only.
      signAndEditExecutable: process.platform === "win32",
    },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
    linux: {
      icon: icons.linux,
      category: "Finance",
      executableName: ids.desktop.executableName,
      synopsis,
      maintainer: options.maintainer ?? config.name,
      target: [
        { target: "AppImage", arch: ["x64", "arm64"] },
        { target: "deb", arch: ["x64", "arm64"] },
        // Portable archive; also the only Linux format that builds on an Apple-silicon Mac without Rosetta.
        { target: "tar.gz", arch: ["x64", "arm64"] },
      ],
    },
    // safeStorage uses libsecret (GNOME keyring / KWallet) when present: the deb asks for it.
    deb: { depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"] },
    publish:
      updates && env.CLIP_UPDATES_OWNER && env.CLIP_UPDATES_REPO
        ? [{ provider: "github", owner: env.CLIP_UPDATES_OWNER, repo: env.CLIP_UPDATES_REPO, releaseType: "release" }]
        : null,
  };
}
