// Metro for Clip Wallet mobile: Expo's defaults plus @clip-wallet/mobile-kit's wiring (the resolved clip.config as a
// virtual module, Node shims for code paths the wallet never runs, one React, workspace sources).
const { getDefaultConfig } = require("expo/metro-config");
const { withClipWallet } = require("@clip-wallet/mobile-kit/metro");

module.exports = withClipWallet(getDefaultConfig(__dirname), { configFile: "clip.config.ts", root: __dirname });
