# @clip-wallet/desktop-kit

The Clip Wallet desktop app (Electron: macOS, Windows, Linux) as a library. A wallet project keeps its identity
(`clip.config.ts`, icons), `electron.vite.config.ts`, `electron-builder.config.cjs` and one-line entrypoints; the main
process (vault, engine, approvals, Touch ID, Ledger over WebHID, linked devices), the sandboxed preloads, the built-in
dapp browser with 1Mask for all 14 network families and the pages come from here, versioned and signed.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/desktop-kit @clip-wallet/config electron electron-vite vite react react-dom
```

## Example

```ts
// electron.vite.config.ts (in a create-clip-wallet project: import clipConfig from "../../clip.config", configDir: "../..")
import { defineConfig as defineClipConfig } from "@clip-wallet/config";
import { clipDesktop } from "@clip-wallet/desktop-kit/electron-vite";

const clipConfig = defineClipConfig({ name: "Acme Wallet", rdns: "com.acme.wallet", networks: ["evm:*", "hedera", "solana"] });

export default clipDesktop({ config: clipConfig, root: import.meta.dirname });
```

```js
// electron-builder.config.cjs
const { electronBuilderConfig } = require("@clip-wallet/desktop-kit/builder");
module.exports = electronBuilderConfig({ configFile: "../../clip.config.ts", root: __dirname });
```

| Entrypoint | File in the project | Import |
| --- | --- | --- |
| main process | `src/main/index.ts` | `import "@clip-wallet/desktop-kit/main"` |
| wallet / approval / toolbar preload | `src/preload/wallet.ts` | `import "@clip-wallet/desktop-kit/preload/wallet"` |
| dapp-tab preload (1Mask) | `src/preload/dapp.ts` | `import "@clip-wallet/desktop-kit/preload/dapp"` |
| wallet window | `src/renderer/wallet/main.tsx` | `mountWallet()` from `/renderer` |
| approval window | `src/renderer/approval/main.tsx` | `mountApproval()` from `/renderer` |
| browser toolbar | `src/renderer/browser/main.tsx` | `mountBrowserChrome()` from `/renderer` |

The pages' `index.html` use `%CLIP_WALLET_NAME%` and `%CLIP_WALLET_CSP%`, which the build fills in.
`npx create-clip-wallet my-wallet` writes all of this for you (`packages/desktop`).

## What the kit takes from clip.config.ts

- **Identity.** Name (window titles, menus, tray, permission prompts), the EIP-6963 / Wallet Standard identity dapps
  see in the built-in browser (name, rdns, the icon inlined), the TON Connect key, app id (`platformIds(config).desktop.appId`,
  default `<appId or rdns>.desktop`), deep-link scheme (`<scheme>://wc?uri=…`), product, executable and artifact names.
- **Theme, networks, languages, services.** The same tokens, network list, language list and optional hosted services
  as the extension and the phone.
- **Build environment.** `CLIP_WALLETCONNECT_PROJECT_ID` (or `CLIP_WC_PROJECT_ID`), `CLIP_UPDATES=1`,
  `CLIP_EXTENSION_IDS`, from the environment or `CLIP_*` lines in `.env` (the project's, then the wallet root's).
- **Mainnet checklist.** A config with mainnet enabled is refused while `mainnetProblems()` lists anything or MAINNET.md
  next to clip.config.ts has an open box. The security floor (open phishing lists) has no switch.

## Packaging and signing

`electronBuilderConfig()` targets dmg + zip (macOS, arm64 and x64), NSIS + zip (Windows), AppImage + deb + tar.gz
(Linux), with the icons create-clip-wallet renders from the logo (`build/icon.icns`, `build/icon.ico`, `build/icons/`).
Unsigned unless electron-builder's signing variables are set: `CSC_LINK` / `CSC_KEY_PASSWORD` or `CSC_NAME` (Apple
Developer ID Application), `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` or `APPLE_ID` /
`APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (notarization), `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (Windows).

Peer dependencies: `electron`, `electron-vite`, `vite`, `react`, `react-dom`. Node 22.18 or newer for the build helpers.

## Documentation

- [Launch your own wallet](https://coldai.org/clip/docs/kit/)
- [Build and ship: the desktop app](https://coldai.org/clip/docs/kit/build-and-ship.html#desktop-app)
- [Stores and code signing](https://coldai.org/clip/docs/kit/signing.html)
- [API reference](https://coldai.org/clip/docs/reference/api/desktop-kit.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
