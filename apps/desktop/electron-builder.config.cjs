/**
 * electron-builder for Clip Wallet desktop: @clip-wallet/desktop-kit's electronBuilderConfig() from clip.config.ts
 * (app id, product name, executable and artifact names, deep-link scheme), with Clip Wallet's own icons rendered from
 * brand/ by tools/brand/render.mjs. Signing and notarization use electron-builder's standard environment variables
 * and are skipped when absent (see the kit's src/builder.ts). Auto-update metadata only for CLIP_UPDATES=1 builds.
 */
const { electronBuilderConfig } = require("@clip-wallet/desktop-kit/builder");

const env = { CLIP_UPDATES_OWNER: "coldai", CLIP_UPDATES_REPO: "clip-wallet", ...process.env };

module.exports = {
  ...electronBuilderConfig({
    configFile: "clip.config.ts",
    root: __dirname,
    env,
    icons: { mac: "build/icon-mac.png", win: "build/icon.png", linux: "build/icon.png" },
    copyright: "Copyright © 2026 ColdAI",
    maintainer: "ColdAI <shayan@coldai.org>",
    synopsis: "A calm, non-custodial wallet with a built-in dapp browser. Test networks only.",
  }),
};
