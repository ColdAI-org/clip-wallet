// Metro: Expo's defaults plus the kit's wiring (the resolved clip.config, Node shims, one React).
const { getDefaultConfig } = require("expo/metro-config");
const { withClipWallet } = require("@clip-wallet/mobile-kit/metro");

module.exports = withClipWallet(getDefaultConfig(__dirname), { configFile: "../../clip.config.ts", root: __dirname });
