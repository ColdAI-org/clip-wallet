# @coldai/clip-wallet-i18n

## 0.2.0

### Minor Changes

- e267fc9: The kit's packages are published as `@coldai/clip-wallet-<name>`: every `@clip-wallet/<name>` becomes
  `@coldai/clip-wallet-<name>`, for example `@clip-wallet/core` → `@coldai/clip-wallet-core`, and imports use the new
  names (`import { defineConfig } from "@coldai/clip-wallet-config"`). `create-clip-wallet` is unchanged:
  `npx create-clip-wallet` scaffolds a wallet as before.

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@coldai/clip-wallet-route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- 14807cd: New packages: `@coldai/clip-wallet-desktop-kit` (the Electron app for macOS, Windows and Linux: main process, preloads, pages,
  built-in dapp browser, `clipDesktop()` for electron-vite and `electronBuilderConfig()` for electron-builder) and
  `@coldai/clip-wallet-mobile-kit` (the Expo app for iOS and Android: screens, vault host, in-app browser, `expoConfig()` and
  `withClipWallet()` for Metro), both driven by clip.config.ts like `@coldai/clip-wallet-extension-kit`.

  `@coldai/clip-wallet-config`: `languages`, `appId`, `scheme`, `desktop` / `mobile` id overrides, and the hosted-mode `fees` /
  `usage` blocks reserved for Clip Cloud (off by default, never acted on by the kit); `platformIds()`, `enabledLanguages()`;
  `@coldai/clip-wallet-config/node` with `loadClipConfigSync()` and the shared build-environment helpers.
  `@coldai/clip-wallet-i18n`: `negotiateLocale` / `resolveLocale` take the languages a wallet offers; `offeredLocales()`.
  `@coldai/clip-wallet-ui`: Settings → Language lists only the languages clip.config offers.

- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
