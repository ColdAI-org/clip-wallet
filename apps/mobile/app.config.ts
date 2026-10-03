import type { ExpoConfig } from "expo/config";

/**
 * Clip Wallet mobile (iOS + Android). Testnets only. Native projects are generated (`expo prebuild`), not
 * committed. Optional build-time env (never committed, see .env.example):
 *   EXPO_PUBLIC_WC_PROJECT_ID      Reown project id; WalletConnect is switched off (said plainly) without it.
 *   CLIP_ASSOCIATED_DOMAIN         e.g. clipwallet.example — adds applinks:/webcredentials: (universal links,
 *                                  passkeys). Needs a signed build and the domain's AASA / assetlinks files.
 */
const domain = process.env.CLIP_ASSOCIATED_DOMAIN;

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
      NSCameraUsageDescription: "Scan a connection QR code from an app.",
      // The in-app browser loads https dapps; plain http only for a dapp served from this Mac / LAN while developing.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "org.coldai.clipwallet",
    allowBackup: false,
    permissions: ["android.permission.CAMERA", "android.permission.USE_BIOMETRIC"],
    intentFilters: domain
      ? [{ action: "VIEW", autoVerify: true, data: [{ scheme: "https", host: domain, pathPrefix: "/wc" }], category: ["BROWSABLE", "DEFAULT"] }]
      : [],
  },
  plugins: [
    ["expo-secure-store", { configureAndroidBackup: true, faceIDPermission: "Unlock Clip Wallet with Face ID instead of typing your password." }],
    ["expo-local-authentication", { faceIDPermission: "Unlock Clip Wallet with Face ID instead of typing your password." }],
    ["expo-camera", { cameraPermission: "Scan a connection QR code from an app.", microphonePermission: false, recordAudioAndroid: false }],
  ],
  experiments: { typedRoutes: false },
  extra: { mainnet: false },
};

export default config;
