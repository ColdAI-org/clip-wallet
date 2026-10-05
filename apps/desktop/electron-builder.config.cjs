/**
 * electron-builder (https://www.electron.build/configuration) for Clip Wallet desktop.
 *
 *   macOS    dmg + zip, arm64 and x64; hardened runtime with build/entitlements.mac*.plist.
 *   Windows  NSIS installer + zip, x64 and arm64.
 *   Linux    AppImage + deb, x64 and arm64.
 *
 * Signing and notarization read the standard electron-builder environment variables and are skipped when absent
 * (local and CI builds without secrets produce unsigned artifacts):
 *   macOS signing      CSC_LINK + CSC_KEY_PASSWORD (Developer ID Application .p12), or CSC_NAME
 *   macOS notarization APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
 *   Windows signing    WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD (or CSC_LINK on a Windows runner)
 * Auto-update metadata is published only for CLIP_UPDATES=1 builds (src/main/updater.ts explains why it is off).
 *
 * The app ships only out/** (main, preloads and renderer are fully bundled by electron-vite); every npm package is a
 * devDependency, so no node_modules go into app.asar and there are no native modules to rebuild.
 */
const env = process.env;
const macSign = !!(env.CSC_LINK || env.CSC_NAME);
const notarize = macSign && !!((env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID));
const updates = env.CLIP_UPDATES === "1";

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "org.coldai.clipwallet.desktop",
  productName: "Clip Wallet",
  copyright: "Copyright © 2026 ColdAI",
  directories: { output: "release", buildResources: "build" },
  files: ["out/**/*", "package.json", "!out/**/*.map"],
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  // Chromium UI locales kept (the app ships 12 languages). macOS names them pt_BR / zh_CN, Windows and Linux pt-BR / zh-CN.
  electronLanguages: ["en", "de", "fr", "es", "pt-BR", "pt_BR", "it", "tr", "ja", "ko", "zh-CN", "zh_CN", "ar", "hi"],
  protocols: [{ name: "Clip Wallet", schemes: ["clipwallet"] }],
  artifactName: "Clip-Wallet-${version}-${os}-${arch}.${ext}",
  mac: {
    category: "public.app-category.finance",
    icon: "build/icon.png",
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
      NSCameraUsageDescription: "Clip Wallet uses the camera only to scan QR codes (WalletConnect codes and Keystone hardware wallets).",
      NSMicrophoneUsageDescription: "Clip Wallet doesn't use the microphone. Sites you open in the built-in browser have to ask first.",
    },
  },
  dmg: { sign: false },
  win: {
    icon: "build/icon.png",
    target: [
      { target: "nsis", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
    // Editing the .exe resources (icon, version info) and signing use rcedit / signtool: on Windows runners only.
    signAndEditExecutable: process.platform === "win32",
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  linux: {
    icon: "build/icon.png",
    category: "Finance",
    synopsis: "A calm, non-custodial wallet with a built-in dapp browser. Test networks only.",
    maintainer: "ColdAI <shayan@coldai.org>",
    target: [
      { target: "AppImage", arch: ["x64", "arm64"] },
      { target: "deb", arch: ["x64", "arm64"] },
    ],
  },
  // safeStorage uses libsecret (GNOME keyring / KWallet) when present: the deb asks for it.
  deb: { depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0"] },
  publish: updates ? [{ provider: "github", owner: env.CLIP_UPDATES_OWNER || "coldai", repo: env.CLIP_UPDATES_REPO || "clip-wallet", releaseType: "release" }] : null,
};
