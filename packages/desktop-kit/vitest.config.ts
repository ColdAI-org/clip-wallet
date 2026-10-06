import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The kit reads the wallet's config from a virtual module that clipDesktop() provides in a real build.
  resolve: { alias: { "virtual:clip-wallet/config": fileURLToPath(new URL("./test/clip.config.ts", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
