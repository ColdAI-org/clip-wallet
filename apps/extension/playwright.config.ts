import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The testnet dapp matrix runs against public testnets with its own wallet: only via `pnpm matrix` (DAPP_MATRIX=1).
  testIgnore: process.env.DAPP_MATRIX === "1" ? [] : ["**/matrix.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
