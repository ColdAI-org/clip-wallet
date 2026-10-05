# The wallet extension

This package is your wallet: a Manifest V3 browser extension built with [WXT](https://wxt.dev) on
[`@clip-wallet/extension-kit`](https://www.npmjs.com/package/@clip-wallet/extension-kit). The kit is the wallet
(background, vault, approvals, security checks, 1Mask for 14 network families, the pages); this folder is the brand.

| File | What it is |
| --- | --- |
| `wallet.identity.json` | Name, description, rdns, homepage, icon, extension public key. Written by `pnpm wallet:identity`. |
| `clip.config.ts` | Theme, networks, routing, hardware wallets, passkeys, services, mainnet. Typed by `@clip-wallet/config`. |
| `icon.svg`, `public/icon/*.png` | Your icon (EIP-6963 and pages use the SVG; the manifest needs the PNGs). |
| `wxt.config.ts` | One line: `clipWallet({ config })`. |
| `src/entrypoints/*` | One-line entrypoints that start the kit's background, content scripts and pages. |
| `.env` | `CLIP_*` build-time values (WalletConnect project id, partner keys). Never committed. |
| `.keys/extension.pem` | The extension's private key. Never committed; back it up. |
| `MAINNET.md` | The checklist that stands between this wallet and real money. |

```sh
pnpm build            # .output/chrome-mv3: load it unpacked in chrome://extensions
pnpm dev              # watch mode with a fresh Chrome profile
pnpm build:fixtures   # sample data, no network: for screenshots and demos
pnpm zip              # store upload zip (.output/*.zip)
pnpm build:firefox    # Firefox (gecko id from your rdns)
```
