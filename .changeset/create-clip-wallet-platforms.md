---
"create-clip-wallet": patch
"@clip-wallet/extension-kit": patch
---

`npx create-clip-wallet my-wallet` makes the wallet on every platform from one `clip.config.ts` at the project root:
the browser extension (`packages/extension`), the desktop app (`packages/desktop`, Electron on
`@clip-wallet/desktop-kit`) and the phone app (`packages/mobile`, Expo on `@clip-wallet/mobile-kit`), plus the
Scaffold-HBAR dapp with `--scaffold-hbar`. New options: `--platforms`, `--id`, `--logo` (every platform's icons
rendered from one PNG or SVG with Node alone: extension sizes, `.icns`, `.ico`, Linux PNGs, tray, iOS, Android adaptive
and monochrome, splash), `--languages`, `--scaffold-hbar`; a `brand` command (`pnpm wallet:brand`); per-platform next
steps; `docs/signing.md` in every project (store accounts and code-signing variables, no secrets). The identity, the
config, the logo, `MAINNET.md`, `.env` and `.keys/` now live at the project root.

`@clip-wallet/extension-kit`: `clipWallet({ configDir })` reads the icon, `MAINNET.md` and the wallet-wide `.env` next to
a shared `clip.config.ts`; `wxt zip` names the store zip after the wallet.
