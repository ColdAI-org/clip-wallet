import { expoConfig } from "@clip-wallet/mobile-kit/expo";

/**
 * Clip Wallet mobile (iOS + Android). Testnets only. @clip-wallet/mobile-kit builds the Expo config from clip.config.ts
 * (name, ids, scheme, icons, splash, permissions); native projects are generated (`expo prebuild`), not committed.
 * Optional build-time env (never committed, see .env.example): EXPO_PUBLIC_WC_PROJECT_ID, EXPO_PUBLIC_PASSKEY_RP_ID,
 * CLIP_ASSOCIATED_DOMAIN.
 */
export default () =>
  expoConfig({
    configFile: "clip.config.ts",
    root: __dirname,
    overrides: {
      // Brand assets are rendered from brand/*.svg by tools/brand/render.mjs (never edit the PNGs by hand).
      // iOS 18 appearance variants: https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/
      ios: { icon: { light: "./assets/icon.png", dark: "./assets/icon-dark.png", tinted: "./assets/icon-tinted.png" } },
    },
  });
