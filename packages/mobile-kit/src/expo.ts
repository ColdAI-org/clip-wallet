/**
 * Expo's app config for a Clip Wallet phone app, from clip.config.ts (https://docs.expo.dev/workflow/configuration/):
 *
 *   // app.config.ts
 *   import { expoConfig } from "@clip-wallet/mobile-kit/expo";
 *   export default () => expoConfig({ configFile: "../../clip.config.ts", root: __dirname });
 *
 * Name, slug, deep-link scheme, iOS bundle id and Android package come from platformIds(config); the icons and the
 * splash screen are the files create-clip-wallet renders from the wallet's logo (assets/), with the accent colour as
 * the adaptive-icon and splash background. Native projects are generated (`expo prebuild`), never committed. A
 * mainnet config is refused until mainnetProblems() is empty and MAINNET.md has no open box.
 *
 * Optional build-time env (never committed): CLIP_ASSOCIATED_DOMAIN (universal links + passkeys; needs a signed build
 * and the domain's AASA / assetlinks files), CLIP_WALLETCONNECT_PROJECT_ID or EXPO_PUBLIC_WC_PROJECT_ID (WalletConnect).
 * Node only, synchronous (Expo evaluates app.config.ts as CommonJS). No relative imports: build tools load it from source.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isMainnetEnabled, platformIds, type ClipConfig } from "@clip-wallet/config";
import { buildEnv, loadClipConfigSync, resolveBuildConfig } from "@clip-wallet/config/node";

/** The asset files a mobile project carries (rendered from the one logo by create-clip-wallet). */
export const MOBILE_ASSETS = {
  icon: "./assets/icon.png",
  adaptiveForeground: "./assets/adaptive-icon.png",
  adaptiveMonochrome: "./assets/adaptive-monochrome.png",
  splash: "./assets/splash-icon.png",
} as const;

export interface ExpoConfigOptions {
  /** The resolved clip.config (or give configFile). */
  config?: ClipConfig;
  /** clip.config.ts, relative to root (read with loadClipConfigSync). Default: clip.config.ts. */
  configFile?: string;
  /** The mobile project directory (package.json, assets/, .env). Default: process.cwd(). */
  root?: string;
  /** Build environment. Default: process.env plus CLIP_* values from .env in root and next to clip.config.ts. */
  env?: Record<string, string | undefined>;
  /** App version. Default: the project's package.json version. */
  version?: string;
  /** Extra Expo config merged over the result (ios / android / plugins are merged one level deep). */
  overrides?: Record<string, unknown>;
}

type Dict = Record<string, unknown>;

/** The Expo config (ExpoConfig shape; typed loosely so the kit doesn't pin @expo/config-types). */
export function expoConfig(options: ExpoConfigOptions = {}): Dict {
  const root = resolve(options.root ?? process.cwd());
  const configFile = resolve(root, options.configFile ?? "clip.config.ts");
  const configDir = dirname(configFile);
  const env = options.env ?? buildEnv([root, configDir]);
  const raw = options.config ?? loadClipConfigSync(configFile);
  const config = resolveBuildConfig(raw, env, { checklistDir: configDir, fallbackWcEnv: "EXPO_PUBLIC_WC_PROJECT_ID" });
  const ids = platformIds(config);
  const version = options.version ?? readVersion(root);
  const domain = env.CLIP_ASSOCIATED_DOMAIN || undefined;
  const name = config.name;
  const camera = "Scan a connection code from an app, a trade link, or your Keystone's QR codes.";
  const bluetooth = "Connect to your Ledger over Bluetooth to add its accounts and approve with it.";
  const faceId = `Unlock ${name} with Face ID instead of typing your password.`;
  const accent = config.theme.accent;
  const monochrome = existsSync(join(root, MOBILE_ASSETS.adaptiveMonochrome));

  const base: Dict = {
    name,
    slug: ids.slug,
    scheme: ids.scheme,
    version,
    orientation: "portrait",
    icon: MOBILE_ASSETS.icon,
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: ids.ios.bundleIdentifier,
      supportsTablet: false,
      ...(domain ? { associatedDomains: [`applinks:${domain}`, `webcredentials:${domain}`] } : {}),
      infoPlist: {
        NSFaceIDUsageDescription: faceId,
        NSCameraUsageDescription: camera,
        // Ledger over Bluetooth (react-native-ble-plx). Its config plugin writes the same key; set here so the text is ours.
        NSBluetoothAlwaysUsageDescription: bluetooth,
        // The in-app browser loads https dapps; plain http only for a dapp served from this computer / LAN while developing.
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: ids.android.package,
      // The logo inside the 66% safe zone on the accent colour; monochrome for Android 13+ themed icons.
      adaptiveIcon: {
        foregroundImage: MOBILE_ASSETS.adaptiveForeground,
        ...(monochrome ? { monochromeImage: MOBILE_ASSETS.adaptiveMonochrome } : {}),
        backgroundColor: accent,
      },
      allowBackup: false,
      // Bluetooth for Ledger: BLUETOOTH_SCAN comes from the ble-plx plugin (with neverForLocation); BLUETOOTH_CONNECT on
      // Android 12+, asked at run time; Android 11 and lower need fine location for BLE scans.
      permissions: ["android.permission.CAMERA", "android.permission.USE_BIOMETRIC", "android.permission.BLUETOOTH_CONNECT"],
      intentFilters: domain
        ? [
            {
              action: "VIEW",
              autoVerify: true,
              data: [
                { scheme: "https", host: domain, pathPrefix: "/wc" },
                { scheme: "https", host: domain, pathPrefix: "/trade" },
              ],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ]
        : [],
    },
    plugins: [
      // Splash: the logo on the accent colour, same in dark mode.
      ["expo-splash-screen", { image: MOBILE_ASSETS.splash, imageWidth: 160, backgroundColor: accent, resizeMode: "contain" }],
      ["expo-secure-store", { configureAndroidBackup: true, faceIDPermission: faceId }],
      ["expo-local-authentication", { faceIDPermission: faceId }],
      ["expo-camera", { cameraPermission: camera, microphonePermission: false, recordAudioAndroid: false }],
      // Ledger over Bluetooth. Foreground only (no background modes); neverForLocation: the app never derives location.
      ["react-native-ble-plx", { isBackgroundEnabled: false, modes: [], bluetoothAlwaysPermission: bluetooth, neverForLocation: true }],
      "expo-web-browser",
      // Local notifications only (no push server): adds Android's POST_NOTIFICATIONS; iOS asks at runtime.
      "expo-notifications",
      // Background checks: UIBackgroundModes "processing" + BGTaskSchedulerPermittedIdentifiers on iOS, WorkManager on Android.
      "expo-background-task",
      // The phone's language list (Settings → Language: "Match device", within the languages clip.config offers).
      "expo-localization",
    ],
    experiments: { typedRoutes: false },
    extra: { mainnet: isMainnetEnabled(config), clipWallet: { name, rdns: config.rdns, appId: ids.appId, languages: config.languages } },
  };
  return merge(base, options.overrides ?? {});
}

function readVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

/** Overrides win; ios / android / extra objects merge one level deep; arrays are replaced. */
function merge(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = v && b && typeof v === "object" && typeof b === "object" && !Array.isArray(v) && !Array.isArray(b) ? { ...(b as Dict), ...(v as Dict) } : v;
  }
  return out;
}
