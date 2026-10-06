/**
 * @clip-wallet/mobile-kit: the Clip Wallet phone app (Expo / React Native: iOS, Android) as a library. A wallet project
 * keeps clip.config.ts, its icons, app.config.ts, metro.config.js and a three-line index.ts; the screens, the vault and
 * engine host, the in-app dapp browser with 1Mask, Clip Plugins, hardware wallets and linked devices come from here.
 *
 *   // index.ts
 *   import "@clip-wallet/mobile-kit/polyfills";          // first: crypto, TextEncoder, URL, Buffer
 *   import { registerClipWallet } from "@clip-wallet/mobile-kit";
 *   registerClipWallet({ icon: require("./assets/icon.png") });
 *
 *   "@clip-wallet/mobile-kit/expo"    expoConfig({ configFile }): app.config.ts from clip.config.ts (Node)
 *   "@clip-wallet/mobile-kit/metro"   withClipWallet(metroConfig, { configFile }): Metro wiring (Node, CommonJS)
 *
 * @module
 */
// Background notification checks must be defined at load (expo-task-manager).
import "./background/background-task";
import { createElement } from "react";
import type { ImageSourcePropType } from "react-native";
import { registerRootComponent } from "expo";
import { App } from "./App";
import { createMobileWallet } from "./background/host";
import { setBrandIcon } from "./brand";

export { App } from "./App";
export { createMobileWallet, type MobileWallet } from "./background/host";
export { brandIcon, setBrandIcon } from "./brand";
export { APP } from "./env";
export { parseDeepLink, type DeepLink } from "./lib/deeplinks";

/** Start the app: the wallet host, then the root component. `icon` is the wallet's bundled app icon (onboarding). */
export function registerClipWallet(options: { icon?: ImageSourcePropType } = {}): void {
  setBrandIcon(options.icon);
  const wallet = createMobileWallet();
  registerRootComponent(() => createElement(App, { wallet }));
}
