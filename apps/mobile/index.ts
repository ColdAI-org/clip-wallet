// Clip Wallet mobile is @coldai/clip-wallet-mobile-kit; this project is the brand (clip.config.ts, assets/).
// Polyfills first: WalletConnect's RN compat (getRandomValues, TextEncoder, URL, Buffer…) + randomUUID.
import "@coldai/clip-wallet-mobile-kit/polyfills";
import { registerClipWallet } from "@coldai/clip-wallet-mobile-kit";

registerClipWallet({ icon: require("./assets/icon.png") });
