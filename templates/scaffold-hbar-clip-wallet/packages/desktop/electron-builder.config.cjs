/**
 * electron-builder (https://www.electron.build) from the wallet's clip.config.ts: app id, product, executable and
 * artifact names, the deep-link scheme and the icons in build/ (pnpm wallet:brand renders them from the logo).
 *   macOS dmg + zip (arm64, x64) · Windows NSIS + zip (x64, arm64) · Linux AppImage + deb + tar.gz (x64, arm64)
 * Unsigned unless the signing variables in ../../docs/signing.md are set. Outputs go to release/.
 */
const { electronBuilderConfig } = require("@clip-wallet/desktop-kit/builder");

module.exports = electronBuilderConfig({ configFile: "../../clip.config.ts", root: __dirname });
