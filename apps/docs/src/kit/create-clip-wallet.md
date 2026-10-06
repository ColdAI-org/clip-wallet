# create-clip-wallet

`create-clip-wallet` makes a new wallet project, on every platform you choose, and gives it an identity of its own.

```sh
npx create-clip-wallet my-wallet          # asks for anything you don't pass
npx create-clip-wallet my-wallet --yes    # defaults: every platform, starter icon, all networks, all languages
```

Without questions:

```sh
npx create-clip-wallet acme-wallet \
  --platforms extension,desktop,mobile \
  --name "Acme Wallet" --rdns com.acme.wallet --id com.acme.wallet \
  --logo ./acme-logo.png --accent "#0B7A3B" \
  --networks "evm:*,hedera,solana,bitcoin" --languages en,de,ja \
  --homepage https://wallet.acme.example --walletconnect-project-id <32 hex> \
  --scaffold-hbar --yes
```

## Options

| Option | |
| --- | --- |
| `--platforms extension,desktop,mobile` | Which apps to make. Default: all three. |
| `--scaffold-hbar` | Also the Scaffold-HBAR demo dapp. Default: off (`--no-scaffold-hbar`). |
| `--name` | The wallet's name on every platform. Default: from the folder name. |
| `--rdns` | EIP-6963 id, a reverse domain you own. Default: `com.example.<name>` (a placeholder the harness warns about). |
| `--id` | Desktop and phone app id (macOS bundle id `<id>.desktop`, iOS bundle id, Android package). Default: the rdns. |
| `--logo` | Your logo: `.png` (1024×1024 is best) or `.svg`. Every icon is rendered from it. Default: a starter mark in the accent colour. Alias: `--icon`. |
| `--accent` | Accent colour (contrast with white text at least 3:1); also the phone app's icon and splash background. |
| `--networks` | `"evm:*"`, `"evm:<chain id>"`, `hedera`, `solana`, `bitcoin`, `sui`, `aptos`, `cardano`, `substrate`, `starknet`, `ton`, `near`, `stellar`, `tezos`, `algorand`. |
| `--languages` | The languages Settings → Language offers: `en de fr es pt-BR it tr ja ko zh-Hans ar hi`. Default: all; the first is the fallback. |
| `--homepage`, `--description` | Your website and a one-sentence description (stores, pickers, WalletConnect). |
| `--walletconnect-project-id` | Written to `.env`, never committed. |
| `--yes` | No questions. `--no-git` skips `git init`; `--new-key` makes a new extension key (and id). |

Without `--yes`, it asks for the folder, platforms, the dapp, name, rdns, app id, accent, logo, networks and languages,
and asks again after an answer `@clip-wallet/config` rejects. It never switches mainnet on: there is no `--mainnet`.
Every option and exit code: [create-clip-wallet CLI](../reference/cli.md).

When it is done it prints the next steps for the platforms you chose:

```text
  cd acme-wallet
  pnpm install

  Browser extension (packages/extension)
    pnpm dev:extension            # Chrome with the extension loaded, live reload
    pnpm extension:build          # load packages/extension/.output/chrome-mv3 unpacked in chrome://extensions
    pnpm extension:zip            # the store upload zip

  Desktop app: macOS, Windows, Linux (packages/desktop)
    pnpm dev:desktop              # run it with live reload
    pnpm desktop:dist             # installers for this computer in packages/desktop/release (unsigned)
    pnpm desktop:dist:mac         # also :win and :linux; signing: docs/signing.md

  Phone app: iOS, Android (packages/mobile)
    pnpm --filter mobile start    # Metro for a development build
    pnpm mobile:prebuild          # generate ios/ and android/, then pnpm --filter mobile ios (or android)
    pnpm mobile:export            # the JS bundles, no account needed; EAS: pnpm --filter mobile eas:build

  pnpm harness                    # must pass before every commit
```

## What it writes

| File | What |
| --- | --- |
| `clip.config.ts` | the one config for every platform: theme, networks, languages, routing, services, mainnet (`false`) |
| `wallet.identity.json` | name, description, rdns, homepage, icon, appId and `extension.key` (a public key) |
| `.keys/extension.pem` | the extension's **private** key: mode 0600, gitignored, never printed. Its public half fixes the Chrome extension id. Back it up offline. |
| `icon.svg` / `icon.png` and every platform's icons | a starter mark in your accent colour, or your `--logo` (see below) |
| `.env`, `packages/nextjs/.env.local` | your WalletConnect project id (`--walletconnect-project-id`), never committed |
| `docs/listings/` | listing drafts for this identity |
| `docs/signing.md` | code signing and store accounts per platform: what each needs and the variable names the tools read |

It refuses Clip Wallet's own identity (`org.coldai.*`, the name "Clip Wallet") and anything `@clip-wallet/config`
rejects, and then writes nothing. Run again, it keeps the extension key (and so the id) unless you pass `--new-key`.

The config, identity, logo, `MAINNET.md`, `.env` and `.keys/` live at the **project root**, shared by every platform,
not in `packages/extension/`.

## Icons from one logo

Every icon is rendered from the logo with Node alone: PNG decoding and encoding, area-average resampling with
premultiplied alpha, and the ICO and ICNS containers are written by create-clip-wallet itself. A PNG logo needs nothing
else. An SVG logo is rasterised once at 1024 px by the first of these that is installed: `@resvg/resvg-js` (in the
project), `rsvg-convert` (librsvg), `sips` (built into macOS) or ImageMagick. Without any of them, pass a
1024×1024 PNG.

| File | For |
| --- | --- |
| `packages/extension/public/icon/{16,32,48,128}.png` | the extension manifest |
| `packages/desktop/build/icon.icns` | macOS (16–1024 px with Retina pairs; artwork on Apple's 824/1024 grid) |
| `packages/desktop/build/icon.ico` | Windows (16, 24, 32, 48, 64, 128, 256) |
| `packages/desktop/build/icons/<n>x<n>.png`, `build/icon.png` | Linux (16–1024), window icon |
| `packages/desktop/src/renderer/public/tray/tray*.png`, `trayTemplate*.png` | tray, and the macOS menu-bar template (black silhouette) |
| `packages/mobile/assets/icon.png` | iOS / Expo icon: 1024 px, opaque (a transparent logo is set on the accent colour) |
| `packages/mobile/assets/adaptive-icon.png`, `adaptive-monochrome.png` | Android adaptive icon (logo in the 66% safe zone, accent background) and the Android 13 themed icon |
| `packages/mobile/assets/splash-icon.png` | splash screen (on the accent colour) |

A later `--accent` change re-renders with the same logo; only the starter mark is redrawn in the new colour.

## Commands in a project

| Command | |
| --- | --- |
| `pnpm wallet:identity` | Set or change the identity (`--name --rdns --id --accent --logo --homepage --description --walletconnect-project-id --new-key`). Keeps the extension key (and id) unless `--new-key`. |
| `pnpm wallet:brand` | Render every platform's icons again from the logo (`--logo file`, `--accent #hex`). |
| `pnpm wallet:listings` | Regenerate `docs/listings/` after an identity change. |
| `pnpm wallet:mainnet-check` | What still blocks a mainnet build: exit `0` ready, `2` work left, `1` mainnet on but not ready. |

Each runs the project's pinned `create-clip-wallet` (`create-clip-wallet identity`, `brand`, `listings`,
`mainnet-check`). The build commands for each platform are on [Build and ship](./build-and-ship.md).

## Same project as the template

`npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` followed by
`pnpm wallet:identity` gives exactly what `npx create-clip-wallet <project> --scaffold-hbar` gives (every platform plus
the dapp): both skip `.git`, `node_modules` and `.env`, apply the template's rename map, `git init`, then run the same
identity code. With fewer `--platforms`, or without `--scaffold-hbar`, create-clip-wallet then removes those parts:
their folders, their root scripts, and their sections of `README.md`, `AGENTS.md`, `llms.txt`, `MAINNET.md`,
`docs/signing.md` and the CI workflow (marked `platform:<part>` in the template).

## How the kit tests it

`pnpm kit:e2e` creates a wallet with every platform from the packed tarballs and checks the identity and icons;
install, harness and types; the extension build, manifest, extension id and EIP-6963 announcement in Chromium; the
desktop build, electron-builder for the host (on macOS arm64, the `.app` and zip) with bundle id, name, scheme and icon
checked in `Info.plist`, and the packaged app started headless to onboarding; the phone app's Expo config,
`expo export` for iOS and Android (with the wallet config inside the bundle) and `expo prebuild` (bundle id, package,
name, scheme and icons in the generated projects); the mainnet gate on every platform; and the security floor.
`--dapp` adds a Scaffold-HBAR project and its Next.js build; `--skip-desktop` and `--skip-mobile` are for machines
without those toolchains. `pnpm kit:e2e:scaffold-hbar` checks the Scaffold-HBAR route gives the same project.
