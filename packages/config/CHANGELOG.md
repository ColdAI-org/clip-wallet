# @coldai/clip-wallet-config

## 0.2.0

### Minor Changes

- 20b6dda: Every CLPR network with a self-custodial key model: twelve new families (Cosmos SDK chains Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia; TRON; XRP Ledger; Vaulta, Telos and XPR Network; MultiversX; Internet Computer; Stacks; Fuel; Bitcoin Cash), Chainflip in chains-substrate, STRATO and Arc mainnet in chains-evm, and their dapp providers where a standard lets the wallet appear as itself.
- e267fc9: The kit's packages are published as `@coldai/clip-wallet-<name>`: every `@clip-wallet/<name>` becomes
  `@coldai/clip-wallet-<name>`, for example `@clip-wallet/core` → `@coldai/clip-wallet-core`, and imports use the new
  names (`import { defineConfig } from "@coldai/clip-wallet-config"`). `create-clip-wallet` is unchanged:
  `npx create-clip-wallet` scaffolds a wallet as before.
- cb6c413: SODAX swaps are set up from the build environment only, with no defaults: `CLIP_SODAX_SERVER_URL` (an ExClip server
  that quotes them) and `CLIP_SODAX_FEE_RECEIVER` (where the 0.875 % Clip fee goes), exported as `SODAX_SERVER_ENV` and
  `SODAX_FEE_RECEIVER_ENV`. `clipWallet()` passes them to the background only in a mainnet build that sets both
  (`sodaxFor()`), and only then adds host permissions for the server's origin and Sonic's RPC. The mainnet checklist
  gains the SODAX items: `mainnetProblems()` asks for both settings (the server over https, the receiver an address) once
  either is set, and the extension build refuses a receiver that isn't on the reviewed list (`sodaxProblems()`). A build
  without them offers no SODAX swaps. Features exports `SONIC_RPC_URL`.

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
