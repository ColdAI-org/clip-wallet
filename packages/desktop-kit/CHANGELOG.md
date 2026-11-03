# @coldai/clip-wallet-desktop-kit

## 0.2.0

### Minor Changes

- e267fc9: The kit's packages are published as `@coldai/clip-wallet-<name>`: every `@clip-wallet/<name>` becomes
  `@coldai/clip-wallet-<name>`, for example `@clip-wallet/core` → `@coldai/clip-wallet-core`, and imports use the new
  names (`import { defineConfig } from "@coldai/clip-wallet-config"`). `create-clip-wallet` is unchanged:
  `npx create-clip-wallet` scaffolds a wallet as before.

### Patch Changes

- 14807cd: New packages: `@coldai/clip-wallet-desktop-kit` (the Electron app for macOS, Windows and Linux: main process, preloads, pages,
  built-in dapp browser, `clipDesktop()` for electron-vite and `electronBuilderConfig()` for electron-builder) and
  `@coldai/clip-wallet-mobile-kit` (the Expo app for iOS and Android: screens, vault host, in-app browser, `expoConfig()` and
  `withClipWallet()` for Metro), both driven by clip.config.ts like `@coldai/clip-wallet-extension-kit`.

  `@coldai/clip-wallet-config`: `languages`, `appId`, `scheme`, `desktop` / `mobile` id overrides, and the hosted-mode `fees` /
  `usage` blocks reserved for Clip Cloud (off by default, never acted on by the kit); `platformIds()`, `enabledLanguages()`;
  `@coldai/clip-wallet-config/node` with `loadClipConfigSync()` and the shared build-environment helpers.
  `@coldai/clip-wallet-i18n`: `negotiateLocale` / `resolveLocale` take the languages a wallet offers; `offeredLocales()`.
  `@coldai/clip-wallet-ui`: Settings → Language lists only the languages clip.config offers.

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
- Updated dependencies [e267fc9]
- Updated dependencies [9ce27f5]
- Updated dependencies [b97d4c2]
- Updated dependencies [2d940da]
- Updated dependencies [93f8dbc]
- Updated dependencies [31a0f40]
- Updated dependencies [d67d756]
- Updated dependencies [cb6c413]
- Updated dependencies [15be735]
- Updated dependencies [b3180f8]
- Updated dependencies [7c459d0]
- Updated dependencies [9b46651]
- Updated dependencies [82697ae]
- Updated dependencies [4e79927]
- Updated dependencies [876cb31]
- Updated dependencies [c6bf6f0]
- Updated dependencies [db17749]
  - @coldai/clip-wallet-1mask@0.2.0
  - @coldai/clip-wallet-chains-ton@0.2.0
  - @coldai/clip-wallet-config@0.2.0
  - @coldai/clip-wallet-core@0.2.0
  - @coldai/clip-wallet-engine@0.2.0
  - @coldai/clip-wallet-features@0.2.0
  - @coldai/clip-wallet-hardware@0.2.0
  - @coldai/clip-wallet-i18n@0.2.0
  - @coldai/clip-wallet-link@0.2.0
  - @coldai/clip-wallet-security@0.2.0
  - @coldai/clip-wallet-social@0.2.0
  - @coldai/clip-wallet-ui@0.2.0
  - @coldai/clip-wallet-vault@0.2.0
