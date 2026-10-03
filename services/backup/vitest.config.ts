import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // Test-only pepper (not a secret: it only ever keys test accounts in a local Miniflare D1).
          EMAIL_PEPPER: "test-pepper-0123456789abcdef0123456789abcdef",
          ALLOWED_ORIGINS: "chrome-extension://clipwallettestextensionid",
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        },
      },
    })),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
