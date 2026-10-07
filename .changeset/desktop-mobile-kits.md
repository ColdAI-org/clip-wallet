---
"@clip-wallet/desktop-kit": patch
"@clip-wallet/mobile-kit": patch
"@clip-wallet/config": patch
"@clip-wallet/i18n": patch
"@clip-wallet/ui": patch
---

New packages: `@clip-wallet/desktop-kit` (the Electron app for macOS, Windows and Linux: main process, preloads, pages,
built-in dapp browser, `clipDesktop()` for electron-vite and `electronBuilderConfig()` for electron-builder) and
`@clip-wallet/mobile-kit` (the Expo app for iOS and Android: screens, vault host, in-app browser, `expoConfig()` and
`withClipWallet()` for Metro), both driven by clip.config.ts like `@clip-wallet/extension-kit`.

`@clip-wallet/config`: `languages`, `appId`, `scheme`, `desktop` / `mobile` id overrides, and the hosted-mode `fees` /
`usage` blocks reserved for Clip Cloud (off by default, never acted on by the kit); `platformIds()`, `enabledLanguages()`;
`@clip-wallet/config/node` with `loadClipConfigSync()` and the shared build-environment helpers.
`@clip-wallet/i18n`: `negotiateLocale` / `resolveLocale` take the languages a wallet offers; `offeredLocales()`.
`@clip-wallet/ui`: Settings → Language lists only the languages clip.config offers.
