# @clip-wallet/desktop-kit

## 0.2.0

### Patch Changes

- 14807cd: New packages: `@clip-wallet/desktop-kit` (the Electron app for macOS, Windows and Linux: main process, preloads, pages,
  built-in dapp browser, `clipDesktop()` for electron-vite and `electronBuilderConfig()` for electron-builder) and
  `@clip-wallet/mobile-kit` (the Expo app for iOS and Android: screens, vault host, in-app browser, `expoConfig()` and
  `withClipWallet()` for Metro), both driven by clip.config.ts like `@clip-wallet/extension-kit`.

  `@clip-wallet/config`: `languages`, `appId`, `scheme`, `desktop` / `mobile` id overrides, and the hosted-mode `fees` /
  `usage` blocks reserved for Clip Cloud (off by default, never acted on by the kit); `platformIds()`, `enabledLanguages()`;
  `@clip-wallet/config/node` with `loadClipConfigSync()` and the shared build-environment helpers.
  `@clip-wallet/i18n`: `negotiateLocale` / `resolveLocale` take the languages a wallet offers; `offeredLocales()`.
  `@clip-wallet/ui`: Settings → Language lists only the languages clip.config offers.

- 6587363: The `electron` peer range is now `>=44.9.1`: earlier 44.x releases are affected by high-severity advisories fixed in
  44.9.1. Clip Wallet's desktop app and the Scaffold-HBAR template's desktop package pin 44.9.1.
- Updated dependencies [07f329b]
- Updated dependencies [886f755]
- Updated dependencies [9b69ba4]
- Updated dependencies [86786a8]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [14807cd]
- Updated dependencies [a84b2ab]
- Updated dependencies [8b60f88]
- Updated dependencies [d90f6aa]
- Updated dependencies [b98fe95]
- Updated dependencies [20b6dda]
- Updated dependencies [b97d4c2]
- Updated dependencies [2d940da]
- Updated dependencies [93f8dbc]
- Updated dependencies [31a0f40]
- Updated dependencies [d67d756]
- Updated dependencies [c6bf6f0]
- Updated dependencies [db17749]
  - @clip-wallet/1mask@0.2.0
  - @clip-wallet/chains-ton@0.2.0
  - @clip-wallet/config@0.2.0
  - @clip-wallet/core@0.2.0
  - @clip-wallet/engine@0.2.0
  - @clip-wallet/features@0.2.0
  - @clip-wallet/hardware@0.2.0
  - @clip-wallet/i18n@0.2.0
  - @clip-wallet/link@0.2.0
  - @clip-wallet/security@0.2.0
  - @clip-wallet/social@0.2.0
  - @clip-wallet/ui@0.2.0
  - @clip-wallet/vault@0.2.0
