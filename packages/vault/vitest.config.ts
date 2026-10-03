import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// @algorandfoundation/xhd-wallet-api (test-only cross-check) pulls libsodium-wrappers-sumo, whose ESM build
// imports a file the package doesn't ship (0.7.16). Point it at the package's CommonJS build instead.
const require = createRequire(import.meta.url);
const xhd = require.resolve("@algorandfoundation/xhd-wallet-api/package.json");
const sodium = createRequire(xhd).resolve("libsodium-wrappers-sumo");

export default defineConfig({
  resolve: { alias: { "libsodium-wrappers-sumo": sodium } },
  test: { server: { deps: { inline: ["@algorandfoundation/xhd-wallet-api"] } } },
});
