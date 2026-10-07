# create-clip-wallet

Start your own non-custodial wallet on the [Clip Wallet](https://github.com/ColdAI-org/clip-wallet) kit, on every
platform, from one `clip.config.ts`: a browser extension, a desktop app for macOS, Windows and Linux, and a phone app for
iOS and Android, for 14 network families, plus (if you want it) a Scaffold-HBAR dapp that connects to it on Hedera
testnet.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Use

```sh
npx create-clip-wallet my-wallet
```

## Example

```sh
npx create-clip-wallet my-wallet --platforms extension,desktop,mobile --name "Acme Wallet" --rdns com.acme.wallet \
  --id com.acme.wallet --logo ./logo.png --accent "#0B7A3B" --networks "evm:*,hedera,solana,bitcoin" \
  --languages en,de,ja --homepage https://wallet.acme.example --yes
cd my-wallet && pnpm install
pnpm dev:extension             # the browser extension
pnpm dev:desktop               # the desktop app
pnpm --filter mobile start     # the phone app (a development build)
```

| | Folder | On |
| --- | --- | --- |
| Browser extension | `packages/extension` | `@clip-wallet/extension-kit` (WXT) |
| Desktop app | `packages/desktop` | `@clip-wallet/desktop-kit` (Electron) |
| Phone app | `packages/mobile` | `@clip-wallet/mobile-kit` (Expo) |
| Scaffold-HBAR dapp (`--scaffold-hbar`) | `packages/nextjs` | Next.js, `@clip-wallet/connect` |

Each platform depends only on published `@clip-wallet/*` packages, pinned to one exact, provenance-signed version.

## Documentation

- [Launch your own wallet](https://coldai.org/clip/docs/kit/)
- [create-clip-wallet](https://coldai.org/clip/docs/kit/create-clip-wallet.html)
- [Stores and code signing](https://coldai.org/clip/docs/kit/signing.html)
- [CLI reference](https://coldai.org/clip/docs/reference/cli.html)

## Options

| | |
| --- | --- |
| `--platforms extension,desktop,mobile` | which apps (default: all three) |
| `--scaffold-hbar` | also the Scaffold-HBAR demo dapp (default: off) |
| `--name "Acme Wallet"` | the name on every platform (default: from the folder) |
| `--rdns com.acme.wallet` | EIP-6963 id, a reverse domain you own (default: a `com.example.*` placeholder) |
| `--id com.acme.wallet` | desktop and phone app id: macOS `<id>.desktop`, iOS bundle id, Android package (default: the rdns) |
| `--logo ./logo.png` | your logo (`.png`, ideally 1024×1024, or `.svg`); every icon is rendered from it (default: a starter mark) |
| `--accent "#0B7A3B"` | accent colour; also the phone app's icon and splash background |
| `--networks "evm:*,hedera"` | `evm:*`, `evm:<chain id>`, hedera, solana, bitcoin, sui, aptos, cardano, substrate, starknet, ton, near, stellar, tezos, algorand |
| `--languages en,de,ja` | en, de, fr, es, pt-BR, it, tr, ja, ko, zh-Hans, ar, hi (default: all; the first is the fallback) |
| `--homepage`, `--description` | your website, one sentence for the stores |
| `--walletconnect-project-id` | written to `.env`, never committed |
| `--new-key`, `--no-git`, `--root <dir>`, `--yes` | new extension key (identity), no `git init`, project for in-project commands, no questions |

Without `--yes` it asks for what the flags leave out and asks again after an answer `@clip-wallet/config` rejects.

## What it writes

| | |
| --- | --- |
| `clip.config.ts` | the one config: theme, networks, languages, routing, services, mainnet (`false`) |
| `wallet.identity.json` | name, description, rdns (EIP-6963), homepage, icon, appId, `extension.key` |
| `.keys/extension.pem` | the extension's private key: 0600, gitignored, never printed; the public half fixes the Chrome extension id |
| `icon.svg` / `icon.png` and every platform's icons | extension 16–128; macOS `.icns`, Windows `.ico`, Linux 16–1024, tray (and the macOS template); iOS icon, Android adaptive and monochrome icons, splash |
| extension page titles | the name |
| `.env`, `packages/nextjs/.env.local` | your WalletConnect project id, never committed |
| `docs/listings/` | listing-submission drafts: EIP-6963, WalletConnect Explorer and, for the families you turn on, TON Connect, NEAR, Stellar Wallets Kit, Tezos Beacon, Algorand use-wallet |
| `docs/signing.md` | code signing and store accounts per platform: what each needs and the variable names the tools read |

It refuses Clip Wallet's own identity (`org.coldai.*`, the name "Clip Wallet") and anything `@clip-wallet/config`
rejects, and writes nothing then. Run again, it keeps the extension key unless you pass `--new-key`.

**Icons with Node alone.** PNG decoding and encoding, area-average resampling with premultiplied alpha, and the ICO and
ICNS containers are written here with Node built-ins. A PNG logo needs nothing else. An SVG logo is rasterised once at
1024 px by the first of these that is installed: `@resvg/resvg-js` (in the project), `rsvg-convert` (librsvg), `sips`
(macOS, built in), `magick` (ImageMagick). Without any of them, pass a PNG.

## Commands

```
create-clip-wallet <folder> [options]   new project
create-clip-wallet identity [options]   in a project (pnpm wallet:identity): name, ids, accent, logo, networks, languages
create-clip-wallet brand [--logo …]     in a project (pnpm wallet:brand): every platform's icons from the logo
create-clip-wallet listings             in a project (pnpm wallet:listings)
create-clip-wallet mainnet-check        in a project (pnpm wallet:mainnet-check): exit 0 ready, 2 work left, 1 mainnet on but not ready
```

In a project, per platform:

| | |
| --- | --- |
| Extension | `pnpm dev:extension` · `pnpm extension:build` (load `.output/chrome-mv3` unpacked) · `pnpm extension:zip` (store zip) |
| Desktop | `pnpm dev:desktop` · `pnpm desktop:build` · `pnpm desktop:dist` (this OS) · `desktop:dist:mac` / `:win` / `:linux` (electron-builder) |
| Phone | `pnpm --filter mobile start` · `pnpm mobile:prebuild` then `pnpm --filter mobile ios` / `android` · `pnpm mobile:export` (JS bundles) · `pnpm --filter mobile eas:build` (EAS) |
| All | `pnpm harness` · `pnpm check-types` · `pnpm build` |

No account or certificate is needed to build anything above. Store accounts and signing (Chrome Web Store, Apple
Developer ID and notarization, Windows code signing, App Store, Google Play) are only for shipping; `docs/signing.md`
in the project lists them, with environment variable names and no secrets.

## Same project as the Scaffold-HBAR template

```sh
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
cd <project> && pnpm install && pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet
```

gives exactly what `npx create-clip-wallet <project> --scaffold-hbar --name "Acme Wallet" --rdns com.acme.wallet --yes`
gives (every platform plus the dapp): both copy the template the same way (create-scaffold-hbar's copy step: skip
`.git`/`node_modules`/`.env`, apply `template.json`'s rename map, delete it, `git init`), then write the identity.
With fewer `--platforms`, or without `--scaffold-hbar`, create-clip-wallet then removes those parts: their folders, their
root scripts, and their sections of the docs and the CI workflow (marked `platform:<part>` in the template).

## Testnet first

New wallets run on test networks. There is no `--mainnet`: mainnet is a later decision by the wallet's owner, after
`MAINNET.md`. `pnpm harness` and every platform's build refuse mainnet while a box is open, and the builds also while
`mainnetProblems()` (placeholder rdns, no homepage, no extension key, no WalletConnect project id, a remote icon) lists
anything. `clip.config.ts` also accepts `fees` and `usage`, reserved for Clip Cloud's hosted mode: off by default and
never acted on by the kit.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. The projects create-clip-wallet makes pin that version exactly;
`pnpm verify:provenance` checks every kit package's attestation.

The template (`template/` in the package) is bundled at `prepack` from `templates/scaffold-hbar-clip-wallet` in the
monorepo; files npm won't pack (`.gitignore`, `.npmrc`) travel as `_gitignore` / `_npmrc` and are renamed back.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
