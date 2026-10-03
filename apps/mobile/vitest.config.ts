import { defineConfig } from "vitest/config";

// Node-side tests (WebView bridge end-to-end against the real injected bundle, KDF adapter). Screens use jest-expo.
export default defineConfig({
  test: { include: ["test/**/*.vitest.ts"], environment: "node" },
});
