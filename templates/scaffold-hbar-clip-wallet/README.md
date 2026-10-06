<div align="center">

# Your wallet, on every platform

**A non-custodial wallet under your own name: browser extension, desktop app and phone app, from one `clip.config.ts`.**

Built on the [Clip Wallet kit](https://github.com/ColdAI-org/clip-wallet) by [ColdAI](https://coldai.org).
<!-- platform:nextjs -->
A [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) template (**Scaffold-HBAR × Clip Wallet**): your wallet
plus a Hedera dapp that connects to it.

[![CI](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/ci.yaml/badge.svg)](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/ci.yaml)
[![Fresh scaffold](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/fresh-scaffold.yaml/badge.svg)](https://github.com/ColdAI-org/scaffold-hbar-clip-wallet/actions/workflows/fresh-scaffold.yaml)
[![Hedera testnet](https://img.shields.io/badge/Hedera-testnet-8259EF?logo=hedera)](#the-demo-dapp)
<!-- /platform:nextjs -->
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENCE)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2ea043)](#signed-versioned-kit)

</div>

```bash
npx create-clip-wallet my-wallet                       # asks what it needs; --yes for the defaults
npx create-clip-wallet my-wallet --platforms extension,desktop --scaffold-hbar --name "Acme Wallet" --yes
```
<!-- platform:nextjs -->

The same project through Scaffold-HBAR: `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet`.
<!-- /platform:nextjs -->

---

## What you get

| | | |
|---|---|---|
| 🧩 | **A real wallet, under your name** | Its own name, icons, app ids, extension id, EIP-6963 rdns, deep-link scheme and WalletConnect project on every platform. It never announces itself as Clip Wallet. |
| 🖥️ | **Every platform from one config** | A Manifest V3 browser extension, a desktop app for macOS, Windows and Linux (Electron), and a phone app for iOS and Android (Expo). `clip.config.ts` drives all of them. |
| 🌐 | **14 network families** | EVM (any chain id), Hedera, Solana, Bitcoin, Sui, Aptos, Cardano, Polkadot SDK, Starknet, TON, NEAR, Stellar, Tezos, Algorand. Turn them on and off in `clip.config.ts`. |
| 🔌 | **1Mask: every dapp works** | EIP-1193 + EIP-6963, Wallet Standard, AIP-62, CIP-30, injectedWeb3, get-starknet, TON Connect, NEAR Connect, SEP-43, Beacon and WalletConnect, all announced with your identity (in the extension and in the desktop and phone apps' built-in browsers). |
| 🧾 | **Every request in plain words** | Each dapp request is decoded before approval (balance changes, fee, warnings); blind signing is off by default. |
| 🛡️ | **A security floor you can't switch off** | Open phishing lists, address-poisoning and new-contract checks, permission review and revoke, spam cleanup. Blockaid scanning when you add a key. |
| ✨ | **Features, social, plugins, settle** | Staking and swaps per family, on-ramps, Secure Trade on Hedera, contacts and Clip handles, notifications, Discover, sandboxed Clip Plugins, route-and-fund and settle-on-Hedera quotes on CLPRouter. |
| 🧪 | **A Scaffold-HBAR dapp** | Next.js on Hedera testnet: connect your wallet through 1Mask, sign, send HBAR, and call Hedera system contracts from the debug page. <!-- only:nextjs --> |
| 🔏 | **Testnet by default** | Mainnet needs a checklist a person ticks (`MAINNET.md`); every build and the harness refuse it otherwise. |
| 🤖 | **Agent-friendly** | `AGENTS.md` recipes, `llms.txt`, a typed `clip.config.ts`, and `pnpm harness` validators an agent must pass. |

## Quick start

Prerequisites: Node **22.18+**, [pnpm](https://pnpm.io) **10+**, Git. Chrome or another Chromium browser for the
extension; nothing else for the desktop app; for the phone app, Xcode (iOS) or Android Studio (Android) to run a
development build, or nothing at all to export its JavaScript bundles.

```bash
cd <your-project>
pnpm install
pnpm harness                   # the rules (below); must pass before every commit
```

<!-- platform:extension -->
**Browser extension** (`packages/extension`)

```bash
pnpm dev:extension             # Chrome with the extension loaded, live reload
pnpm extension:build           # → packages/extension/.output/chrome-mv3: Load unpacked in chrome://extensions
pnpm extension:zip             # the store upload zip
```

<!-- /platform:extension -->
<!-- platform:desktop -->
**Desktop app: macOS, Windows, Linux** (`packages/desktop`)

```bash
pnpm dev:desktop               # run it with live reload
pnpm desktop:dist              # installers for this computer → packages/desktop/release (unsigned)
pnpm desktop:dist:mac          # dmg + zip · desktop:dist:win NSIS + zip · desktop:dist:linux AppImage + deb + tar.gz
```

<!-- /platform:desktop -->
<!-- platform:mobile -->
**Phone app: iOS, Android** (`packages/mobile`)

```bash
pnpm --filter mobile start     # Metro for a development build (expo-dev-client)
pnpm mobile:prebuild           # generate ios/ and android/ (never committed), then:
pnpm --filter mobile ios       # build and run on the iOS simulator · pnpm --filter mobile android
pnpm mobile:export             # the JavaScript bundles for iOS and Android: no account, no Xcode
```

<!-- /platform:mobile -->
<!-- platform:nextjs -->
**The demo dapp** (`packages/nextjs`)

```bash
pnpm next:dev                  # → http://localhost:3000
```

Load the extension, create a wallet in it, get testnet HBAR from the [faucet](https://portal.hedera.com/faucet), and
open the dapp. Through Scaffold-HBAR, run `pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet` first:
this template manages its own package manager (pnpm), so create-scaffold-hbar skips the install step and prints these
commands. `npx create-clip-wallet my-wallet --scaffold-hbar` does the copy and the identity step in one go; both
produce the same project.

<!-- /platform:nextjs -->
Store accounts and code signing (Chrome Web Store, Apple Developer ID and notarization, Windows certificates, App Store,
Google Play) are only needed to ship: [docs/signing.md](docs/signing.md) lists them and the variables the tools read.

## One config, every platform

`clip.config.ts` (typed by `@clip-wallet/config`) and `wallet.identity.json` next to it are the only places the wallet
is described:

| Setting | Extension | Desktop | Phone |
|---|---|---|---|
| `name`, `description` | manifest, pickers | window titles, menus, installers | app name, permission texts |
| `rdns` (EIP-6963) | announced to dapps | announced in the built-in browser | announced in the in-app browser |
| `appId` (default: `rdns`) | | `<appId>.desktop` (macOS bundle id, Windows AppUserModelID) | iOS bundle id, Android package |
| `icon` (`icon.svg` / `icon.png`) | toolbar icons | `.icns`, `.ico`, Linux PNGs, tray | icon, adaptive icon, splash |
| `theme` | screens | screens | screens, adaptive-icon and splash background |
| `networks`, `languages` | ✓ | ✓ | ✓ |
| `scheme` (default: the name, lower case) | | `<scheme>://wc?uri=…` | `<scheme>://wc?uri=…` |
| `services` | backup, media proxy, relay, Clip handles | same | same |
| `mainnet` | refused until `MAINNET.md` is done | same | same |

`fees` and `usage` are reserved for Clip Cloud's hosted mode: accepted, off by default, and never acted on by the kit.

## Your wallet's identity

`pnpm wallet:identity` (or `create-clip-wallet`) gives the wallet everything that makes it yours:

| | Where | |
|---|---|---|
| Name, description, homepage, app id | `wallet.identity.json` | Every platform's name and ids, wallet pickers, WalletConnect metadata |
| EIP-6963 rdns | same file | A reverse domain you own; dapps and wallet lists key on it |
| Extension id | `extension.key` in the same file | An RSA public key that fixes the Chrome extension id; the private key goes to `.keys/extension.pem` (gitignored, 0600) |
| Icons | `icon.svg` (or `icon.png`) and every platform's icon files | A starter mark in your accent colour; `--logo logo.png` renders every size from your logo (`pnpm wallet:brand`) |
| WalletConnect project id | `.env` (and the dapp's `.env.local`, if there is one) | `--walletconnect-project-id`; never committed |
| Window global, TON Connect key | derived from the name | `window.acmewallet.near`, TON Connect `acmewallet` |
| Listing drafts | `docs/listings/` | TON Connect, NEAR, Stellar Wallets Kit, Beacon, use-wallet, WalletConnect Explorer, EIP-6963 |

```bash
pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet --id com.acme.wallet --homepage https://wallet.acme.com \
  --accent "#0B7A3B" --logo ./acme.png --walletconnect-project-id <32 hex>
pnpm wallet:brand --logo ./acme-v2.png   # every platform's icons again, from a new logo
pnpm wallet:listings                     # regenerate docs/listings after an identity change
```

Running it again keeps the extension key (and so the id) unless you pass `--new-key`. Icons are rendered with Node
alone from a PNG logo (1024×1024 is best); an SVG logo is rasterised once with whichever of `@resvg/resvg-js`,
`rsvg-convert`, `sips` (macOS) or ImageMagick is installed.

<!-- platform:nextjs -->
## The demo dapp

`packages/nextjs` is Scaffold-HBAR's Next.js app on Hedera testnet (chain 296):

| Page | What it shows |
|---|---|
| `/` | Finds your wallet by its EIP-6963 rdns, connects, signs a sign-in message (verified in the page), sends 0.1 HBAR to yourself with a HashScan link |
| `/clip-connect` | Clip Connect (`@clip-wallet/connect`): one connect for your wallet or any other, accounts as CAIP-10, what the wallet can do (EIP-5792), balances by asset, and `pay()` that uses auxiliary funds (ERC-7682) when the wallet has them |
| `/debug` | Scaffold-HBAR's contract debugger, with Hedera's PRNG (`0x169`) and exchange-rate (`0x168`) system contracts |

Every request opens your wallet's approval window, decoded in plain words. The header's **Connect Wallet** (RainbowKit)
lists your wallet next to MetaMask and WalletConnect.

<!-- /platform:nextjs -->
## Commands

| Command | |
|---|---|
| `pnpm dev:extension` · `extension:build` · `extension:zip` | Watch, build, or zip the extension for the stores <!-- only:extension --> |
| `pnpm extension:build:fixtures` | The extension with sample data and no network, for screenshots <!-- only:extension --> |
| `pnpm dev:desktop` · `desktop:build` · `desktop:start` | Run, build, or start the built desktop app <!-- only:desktop --> |
| `pnpm desktop:dist` · `desktop:dist:mac` · `:win` · `:linux` | Installers (electron-builder), unsigned unless docs/signing.md is set up <!-- only:desktop --> |
| `pnpm --filter mobile start` · `ios` · `android` | Metro, or build and run a development build <!-- only:mobile --> |
| `pnpm mobile:prebuild` · `mobile:export` | Native projects (generated) · JavaScript bundles <!-- only:mobile --> |
| `pnpm next:dev` / `next:build` / `next:serve` | The demo dapp <!-- only:nextjs --> |
| `pnpm harness` | The rules (below). Must pass before every commit |
| `pnpm check-types` · `pnpm build` | Types for every package, the builds |
| `pnpm wallet:identity` · `wallet:brand` · `wallet:listings` · `wallet:mainnet-check` | Identity, icons, listing drafts, what blocks mainnet |
| `pnpm verify:provenance` | Check the kit packages were built by the kit's CI from its public repo |

## The rules (`pnpm harness`)

`tools/harness/check.mjs` (Node built-ins only) fails with `file:line` and a plain sentence when:

- key material is handled outside `@clip-wallet/vault`, a secret is logged, a recovery phrase is committed, or a `.env`
  or key file is tracked by git;
- the wallet announces Clip Wallet's identity (`org.coldai.*` or the name "Clip Wallet");
- a platform stops building through its kit (`clipWallet()`, `clipDesktop()`, `expoConfig()` / `withClipWallet()`), or
  anything switches the phishing lists off;
- mainnet is on while `MAINNET.md` has an open box;
- a kit package isn't pinned to one exact version.

It warns while the template's placeholder identity is still in place.

## Signed, versioned kit

The wallet itself is `@clip-wallet/extension-kit`, `@clip-wallet/desktop-kit` and `@clip-wallet/mobile-kit` and the
`@clip-wallet/*` packages they depend on, all released together with one version and published by the kit's CI with
**npm provenance** (Sigstore-signed, traceable to the commit and workflow). This project pins that version exactly (the
harness insists); `pnpm verify:provenance` checks every package's attestation against `github.com/ColdAI-org/clip-wallet`,
and `npm audit signatures` verifies the signatures in an npm install. Upgrading is a deliberate change: bump the pins in
`packages/*/package.json` and the root `package.json`, read the kit's changelog, run
`pnpm install && pnpm verify:provenance && pnpm harness && pnpm build`.

## Testnet first

Everything runs on test networks. `MAINNET.md` lists what a person must do first (own rdns and homepage, the extension
key backed up and matching the store item, your own WalletConnect project, production services, signed builds, an
independent review of your changes, usability tests, support and security contacts). Every build and the harness refuse
a mainnet config while a box is open, and the builds also until `pnpm wallet:mainnet-check` is clean.

## Project layout

| Path | |
|---|---|
| `clip.config.ts` · `wallet.identity.json` | The wallet: identity, theme, networks, languages, services, mainnet (every platform) |
| `icon.svg` | The logo (or `icon.png`); every platform's icons are rendered from it |
| `MAINNET.md` | The owner's mainnet checklist |
| `packages/extension/` | The browser extension: one-line WXT entrypoints on `@clip-wallet/extension-kit` <!-- only:extension --> |
| `packages/desktop/` | The desktop app: one-line electron-vite entrypoints on `@clip-wallet/desktop-kit`, icons <!-- only:desktop --> |
| `packages/mobile/` | The phone app: Expo on `@clip-wallet/mobile-kit`, icons and splash <!-- only:mobile --> |
| `packages/nextjs/` | The Scaffold-HBAR dapp: demo page, /debug, Hedera testnet <!-- only:nextjs --> |
| `docs/listings/` | Listing-submission drafts for your identity |
| `docs/signing.md` | Code signing and store accounts (placeholders: what to set, never secrets) |
| `tools/harness/check.mjs` | The rules above |
| `tools/verify-provenance.mjs` | Provenance check for the kit packages |
| `.harness/` | Spec, PRD and hedera-harness validators for coding agents |
| `AGENTS.md` · `llms.txt` | How agents (and people) change this project safely |

## For coding agents

[AGENTS.md](AGENTS.md) is written for Claude Code, Codex, Cursor and friends: the rules that never break, the commands
that must pass, and recipes for identity, platforms, networks, tokens, routing and settle-on-Hedera, features, security,
social, plugins and the dapp. [`.harness/`](.harness/README.md) holds the spec, the PRD and a hedera-harness recipe with
validators.

## License

Apache-2.0, see [LICENCE](LICENCE) and [NOTICE](NOTICE). Created by [ColdAI](https://coldai.org). The wallet is the
Clip Wallet kit. "Clip Wallet", "1Mask" and the Clip Wallet logo are ColdAI trademarks and aren't licensed: your wallet
uses its own name and icon.
<!-- platform:nextjs -->

The dapp (`packages/nextjs`) builds on Scaffold-HBAR (hedera-dev) and Scaffold-ETH 2 (BuidlGuidl) and keeps their MIT
licence ([`packages/nextjs/LICENSE`](packages/nextjs/LICENSE)).
<!-- /platform:nextjs -->
