# The desktop app

Your wallet for macOS, Windows and Linux: an [Electron](https://www.electronjs.org) app built with
[electron-vite](https://electron-vite.org) on [`@clip-wallet/desktop-kit`](https://www.npmjs.com/package/@clip-wallet/desktop-kit).
The kit is the app (vault and engine in the main process, the same screens as the extension, approvals, a built-in dapp
browser with 1Mask, Touch ID, Ledger, linked devices); this folder holds one-line entrypoints and the icons. Name, ids,
theme, networks, languages, deep links and services come from `../../clip.config.ts`.

| File | What it is |
| --- | --- |
| `electron.vite.config.ts` | One line: `clipDesktop({ config })`. |
| `electron-builder.config.cjs` | One line: `electronBuilderConfig({ configFile })`: installers for every OS. |
| `src/main`, `src/preload`, `src/renderer/*/main.tsx` | One-line entrypoints into the kit. |
| `src/renderer/*/index.html` | The pages; `%CLIP_WALLET_NAME%` and `%CLIP_WALLET_CSP%` are filled in at build time. |
| `build/icon.icns`, `icon.ico`, `icons/`, `src/renderer/public/tray/` | Icons rendered from the logo (`pnpm wallet:brand`). |
| `build/entitlements.mac*.plist` | Hardened-runtime entitlements for a Developer ID build. |

```sh
pnpm dev                 # run it with live reload (pnpm dev:desktop from the project root)
pnpm build && pnpm start # build to out/ and run the built app
pnpm dist                # installers for this computer's OS in release/ (unsigned without certificates)
pnpm dist:mac            # dmg + zip · dist:win: NSIS + zip · dist:linux: AppImage + deb + tar.gz
```

Windows installers build on Windows (or CI), Linux AppImage/deb on Linux; any OS can build the zip / tar.gz archives.
Signing and notarization: `../../docs/signing.md`.
