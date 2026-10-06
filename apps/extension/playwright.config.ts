import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The testnet dapp matrix and the picker matrix run against public testnets with its own wallet: only via `pnpm matrix` (DAPP_MATRIX=1).
  // README media (e2e/readme-media.spec.ts) also uses the matrix wallet: only via `pnpm media` (README_MEDIA=1).
  testIgnore: [
    ...(process.env.DAPP_MATRIX === "1" ? [] : ["**/matrix.spec.ts", "**/pickers.spec.ts", "**/hosted-dapps.spec.ts"]),
    ...(process.env.README_MEDIA === "1" ? [] : ["**/readme-media.spec.ts"]),
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
