# Build and ship

A project builds each platform from the same `clip.config.ts` at its root. No account or certificate is needed for
anything on this page; signing and store accounts are only for shipping: see [Stores and code signing](./signing.md).

## The extension's files

A wallet project keeps three things; the rest comes from `@clip-wallet/extension-kit`.

**`wxt.config.ts`**: the whole build is `clipWallet()`. `configDir` points at the project root, where the config, the
icon, `MAINNET.md` and the wallet-wide `.env` live.

<<< @/snippets/kit/project/packages/extension/wxt.config.ts

**One-line entrypoints** in `src/entrypoints/`:

::: code-group

<<< @/snippets/kit/background.ts [background.ts]

<<< @/snippets/kit/content.ts [content.ts]

<<< @/snippets/kit/inpage.content.ts [inpage.content.ts]

<<< @/snippets/kit/popup.tsx [popup/main.tsx]

:::

The approval window, the offscreen plugin host and the plugin sandbox are one line each too
(`mountApprovalWindow()`, `startPluginHost()`, `import "@clip-wallet/extension-kit/plugin-sandbox"`).
`create-clip-wallet` writes all of them. What `clipWallet()` does with them: [Extension kit](../architecture/extension-kit.md).

## Build and try it

```sh
pnpm extension:build             # → packages/extension/.output/chrome-mv3
pnpm extension:dev               # watch mode, Chrome opens with the extension loaded
pnpm extension:build:fixtures    # sample data, no network: for screenshots and demos
```

Load `.output/chrome-mv3` with **Load unpacked** in `chrome://extensions`. Then run the checks:

```sh
pnpm harness && pnpm check-types && pnpm build
```

## Package for the stores

In a kit-built wallet, `pnpm extension:zip` writes the store zips with WXT, named after the wallet
(`acme-wallet-0.1.0-chrome.zip`). Clip Wallet's own extension in this repo
uses a stricter script:

```sh
pnpm --filter @clip-wallet/extension package
```

It writes to `apps/extension/release/`:

| File | For |
| --- | --- |
| `clip-wallet-<version>-chrome.zip` | Chrome Web Store and Microsoft Edge Add-ons (the same MV3 package) |
| `clip-wallet-<version>-firefox.zip` | addons.mozilla.org (MV3, the background as an ES-module event page; Firefox 140 or later) |
| `clip-wallet-<version>-source.zip` | AMO's source-code submission |
| `SHA256SUMS`, `TREE-DIGESTS`, `BUILD-INFO` | checksums, architecture-independent content digests, and how it was built |

Every zip is deterministic: `SOURCE_DATE_EPOCH` defaults to the commit time, so two builds of one commit are
byte-identical (see [Reproducible builds](../testing/reproducible-builds.md)). The script refuses a build that isn't the
testnet build.

The store kit (listing copy, permission justifications, screenshots) is in
[`apps/extension/store`](repo:apps/extension/store). Keep your listing's privacy section in step with what the wallet
sends where (Settings → Security and Settings → Your data list it).

## Your extension id

The extension id comes from the public key in `extension.key`. Keep the private key
(`.keys/extension.pem` at the project root) offline and **use the same key for the store item**, so the id in the store
matches the one your listings, passkeys and native-messaging hosts know.

## Desktop app

<<< @/snippets/kit/project/packages/desktop/electron.vite.config.ts

```sh
pnpm dev:desktop          # electron-vite dev
pnpm desktop:build        # → packages/desktop/out (main, sandboxed preloads, renderer, native-messaging host)
pnpm desktop:start        # run the built app
pnpm desktop:dist         # electron-builder for this computer → packages/desktop/release
pnpm desktop:dist:mac     # dmg + zip, arm64 and x64
pnpm desktop:dist:win     # NSIS + zip, x64 and arm64 (NSIS: on Windows or in CI)
pnpm desktop:dist:linux   # AppImage + deb (on Linux or in CI) + tar.gz (anywhere)
```

`clipDesktop()` resolves the config with the build environment (`CLIP_WALLETCONNECT_PROJECT_ID`, `CLIP_UPDATES`,
`CLIP_EXTENSION_IDS`, from the environment or `.env`), gives it to the main process, the preloads and the pages as
`virtual:clip-wallet/config` (the icon inlined as the identity dapps see), fills the pages' title and Content Security
Policy, bundles the native-messaging host, and refuses a mainnet config with open boxes. `electronBuilderConfig()`
(in `electron-builder.config.cjs`) maps the config to electron-builder: app id, product name, executable and artifact
names (`Acme-Wallet-0.1.0-mac-arm64.zip`), the `<scheme>://` protocol, the Chromium locales for the offered languages,
the icons and the hardened-runtime entitlements, with signing, notarization and update publishing only when their
variables are set.

The app is the same as Clip Wallet's desktop app: vault and engine in the main process, every renderer sandboxed, a
built-in dapp browser with 1Mask and one session per site, Touch ID, Ledger over WebHID, and linked devices.

## Phone app

<<< @/snippets/kit/project/packages/mobile/app.config.ts

```sh
pnpm mobile:start                    # Metro for a development build (the app uses native modules: not Expo Go)
pnpm mobile:prebuild                 # generate ios/ and android/ (never committed; no CocoaPods install)
pnpm --filter mobile ios             # build and run on the iOS simulator (Xcode); android: an emulator or a device
pnpm mobile:export                   # the JavaScript bundles for iOS and Android: no account, no Xcode, no Android SDK
pnpm --filter mobile eas:build       # EAS cloud builds (an Expo account)
```

`expoConfig()` maps the config to Expo's app config: name, slug, scheme, bundle id, package, icons, the adaptive icon
and the splash on the accent colour, permission texts in the wallet's name, and universal links for
`CLIP_ASSOCIATED_DOMAIN`. `withClipWallet()` (in `metro.config.js`) gives the app the resolved config as
`virtual:clip-wallet/config`, written to `node_modules/.cache/clip-wallet/config.js` on every Metro start. Both refuse a
mainnet config with open boxes. The kit's native modules are peer dependencies: the project lists them, so Expo
autolinking finds them.

## What the harness checks

`pnpm harness`, in the project, must pass before every commit:

- key material only in `@clip-wallet/vault` (inside the kits); no logged secrets; no tracked `.env` or key files;
- the identity is the wallet's own (`rdns` and `appId` never `org.coldai.*`, the name never "Clip Wallet");
- every platform builds through its kit: `clipWallet()`, `clipDesktop()` and `electronBuilderConfig()`, `expoConfig()`
  and `withClipWallet()`; nothing switches the phishing lists off;
- mainnet on means every box in `MAINNET.md` is ticked;
- kit packages are pinned to one exact version.

## Listings

`pnpm wallet:listings` regenerates the drafts in `docs/listings/` for your identity: EIP-6963 metadata, WalletConnect
Explorer, and for the families you turned on, TON Connect, NEAR Wallet Selector, Stellar Wallets Kit, Tezos Beacon and
Algorand use-wallet. Submit them once your extension is public; until then, some pickers need the one-line additions on
[Troubleshooting](../dapps/troubleshooting.md).

## Upgrading the kit

Your project pins every `@clip-wallet/*` package and `create-clip-wallet` to one exact version (the harness insists).
Upgrading is a deliberate change: bump the pins, read the kit's changelog, then
`pnpm install && pnpm verify:provenance && pnpm harness && pnpm build`. `pnpm verify:provenance` checks each package's
npm provenance attestation against the kit's public repository; `npm audit signatures` verifies the signatures.

## Mainnet

::: danger Real funds
Clip Wallet is pre-release and has had no external audit. A mainnet build moves real money. The checklist in
`MAINNET.md` (at the project root) is the owner's decision, never an agent's.
:::

`pnpm wallet:mainnet-check` lists what is left. Every platform's build refuses mainnet until it is empty: see
[Configure clip.config.ts](./config.md#mainnet).
