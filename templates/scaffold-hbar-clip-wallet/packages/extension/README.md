# The wallet extension

Your wallet as a Manifest V3 browser extension, built with [WXT](https://wxt.dev) on
[`@clip-wallet/extension-kit`](https://www.npmjs.com/package/@clip-wallet/extension-kit). The kit is the wallet
(background, vault, approvals, security checks, 1Mask for 14 network families, the pages); this folder holds one-line
entrypoints and the toolbar icons. Name, theme, networks, languages and services come from `../../clip.config.ts`, the
config every platform of this wallet shares.

| File | What it is |
| --- | --- |
| `wxt.config.ts` | One line: `clipWallet({ config, configDir: "../.." })`. |
| `src/entrypoints/*` | One-line entrypoints that start the kit's background, content scripts and pages. |
| `public/icon/*.png` | The manifest's icons, rendered from the logo (`pnpm wallet:brand`). |
| `../../wallet.identity.json` | Name, description, rdns, homepage, icon, extension public key. Written by `pnpm wallet:identity`. |
| `../../.env` | `CLIP_*` build-time values (WalletConnect project id, partner keys). Never committed. |
| `../../.keys/extension.pem` | The extension's private key. Never committed; back it up. |

```sh
pnpm build            # .output/chrome-mv3: load it unpacked in chrome://extensions
pnpm dev              # watch mode with a fresh Chrome profile
pnpm build:fixtures   # sample data, no network: for screenshots and demos
pnpm zip              # store upload zip (.output/*.zip)
pnpm build:firefox    # Firefox (gecko id from your rdns)
```
