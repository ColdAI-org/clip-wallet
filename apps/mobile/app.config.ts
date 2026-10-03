import type { ExpoConfig } from "expo/config";

/**
 * Clip Wallet mobile (iOS + Android). Testnets only. Native projects are generated (`expo prebuild`), not
 * committed. Optional build-time env (never committed, see .env.example):
 *   EXPO_PUBLIC_WC_PROJECT_ID      Reown project id; WalletConnect is switched off (said plainly) without it.
 *   CLIP_ASSOCIATED_DOMAIN         e.g. clipwallet.example — adds applinks:/webcredentials: (universal links,
 *                                  passkeys). Needs a signed build and the domain's AASA / assetlinks files.
 */
const domain = process.env.CLIP_ASSOCIATED_DOMAIN;

const CAMERA = "Scan a connection code from an app, a trade link, or your Keystone's QR codes.";
const BLUETOOTH = "Connect to your Ledger over Bluetooth to add its accounts and approve with it.";

const config: ExpoConfig = {
  name: "Clip Wallet",
  slug: "clip-wallet",
  scheme: "clipwallet",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "org.coldai.clipwallet",
    supportsTablet: false,
    ...(domain ? { associatedDomains: [`applinks:${domain}`, `webcredentials:${domain}`] } : {}),
    infoPlist: {
      NSFaceIDUsageDescription: "Unlock Clip Wallet with Face ID instead of typing your password.",
      NSCameraUsageDescription: CAMERA,
      // Ledger over Bluetooth (react-native-ble-plx). Its config plugin writes the same key; set here so the text is ours.
      NSBluetoothAlwaysUsageDescription: BLUETOOTH,
      // The in-app browser loads https dapps; plain http only for a dapp served from this Mac / LAN while developing.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "org.coldai.clipwallet",
    allowBackup: false,
    // Bluetooth for Ledger: BLUETOOTH_SCAN (added with neverForLocation by the ble-plx plugin below; listing it here
    // would stop the plugin adding that flag) and
    // BLUETOOTH_CONNECT on Android 12+, asked at run time; Android 11 and lower need fine location for BLE scans.
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
    ["expo-secure-store", { configureAndroidBackup: true, faceIDPermission: "Unlock Clip Wallet with Face ID instead of typing your password." }],
    ["expo-local-authentication", { faceIDPermission: "Unlock Clip Wallet with Face ID instead of typing your password." }],
    ["expo-camera", { cameraPermission: CAMERA, microphonePermission: false, recordAudioAndroid: false }],
    // Ledger over Bluetooth. Foreground only (no background modes); neverForLocation: we never derive location.
    ["react-native-ble-plx", { isBackgroundEnabled: false, modes: [], bluetoothAlwaysPermission: BLUETOOTH, neverForLocation: true }],
    "expo-web-browser",
  ],
  experiments: { typedRoutes: false },
  extra: { mainnet: false },
};

export default config;
