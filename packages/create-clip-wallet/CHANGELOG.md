# create-clip-wallet

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- 1584585: `npx create-clip-wallet my-wallet` makes the wallet on every platform from one `clip.config.ts` at the project root:
  the browser extension (`packages/extension`), the desktop app (`packages/desktop`, Electron on
  `@clip-wallet/desktop-kit`) and the phone app (`packages/mobile`, Expo on `@clip-wallet/mobile-kit`), plus the
  Scaffold-HBAR dapp with `--scaffold-hbar`. New options: `--platforms`, `--id`, `--logo` (every platform's icons
  rendered from one PNG or SVG with Node alone: extension sizes, `.icns`, `.ico`, Linux PNGs, tray, iOS, Android adaptive
  and monochrome, splash), `--languages`, `--scaffold-hbar`; a `brand` command (`pnpm wallet:brand`); per-platform next
  steps; `docs/signing.md` in every project (store accounts and code-signing variables, no secrets). The identity, the
  config, the logo, `MAINNET.md`, `.env` and `.keys/` now live at the project root.

  `@clip-wallet/extension-kit`: `clipWallet({ configDir })` reads the icon, `MAINNET.md` and the wallet-wide `.env` next to
  a shared `clip.config.ts`; `wxt zip` names the store zip after the wallet.

- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- Updated dependencies [07f329b]
- Updated dependencies [14807cd]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
  - @clip-wallet/config@0.2.0
