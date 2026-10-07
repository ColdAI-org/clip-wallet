import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-side tests (WebView bridge end-to-end against the real injected bundle, KDF adapter). Screens use jest-expo.
export default defineConfig({
  // The kit reads the wallet's config from a virtual module that withClipWallet() (metro.cjs) provides in a real build.
  resolve: { alias: { "virtual:clip-wallet/config": fileURLToPath(new URL("./test/clip.config.ts", import.meta.url)) } },
  test: { include: ["test/**/*.vitest.ts"], environment: "node" },
});
