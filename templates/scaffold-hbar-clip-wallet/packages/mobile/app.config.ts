import { expoConfig } from "@clip-wallet/mobile-kit/expo";

/**
 * Expo's app config from the wallet's one clip.config.ts (at the project root, shared with the extension and the
 * desktop app): name, slug, deep-link scheme, iOS bundle id, Android package, icons, adaptive icon and splash on the
 * accent colour, permission texts. Native projects are generated (`pnpm prebuild`), never committed.
 * Optional build-time env (never committed): CLIP_ASSOCIATED_DOMAIN (universal links + passkeys; a signed build and
 * the domain's AASA / assetlinks files), CLIP_WALLETCONNECT_PROJECT_ID (in ../../.env).
 */
export default () => expoConfig({ configFile: "../../clip.config.ts", root: __dirname });
