// The phone app is @clip-wallet/mobile-kit; this project is the brand (../../clip.config.ts and assets/).
// Polyfills first: crypto.getRandomValues, TextEncoder, URL, Buffer, randomUUID.
import "@clip-wallet/mobile-kit/polyfills";
import { registerClipWallet } from "@clip-wallet/mobile-kit";

registerClipWallet({ icon: require("./assets/icon.png") });
