import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The host build resolves this to the wallet's clip.config.ts (src/wxt.ts); tests use Clip Wallet's own.
    alias: { "virtual:clip-wallet/config": fileURLToPath(new URL("./test/clip.config.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
