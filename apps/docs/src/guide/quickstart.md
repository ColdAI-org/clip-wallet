# Run it locally

Clip Wallet is a pnpm monorepo of TypeScript packages, three apps (extension, mobile, desktop) and three optional
Cloudflare Workers. This page gets each app running on your machine.

## What you need

- **Node.js 24** (any version from 22 works for the packages; CI and the reproducible build use 24).
- **pnpm 12.6.0**, the version `package.json` pins. `corepack enable` picks it up, or `npm i -g pnpm@12.6.0`.
- **Chrome or another Chromium browser** for the extension.
- For the phone app: Xcode with an iOS Simulator, or Android Studio with an emulator.

## Install and check

```sh
git clone https://github.com/ColdAI-org/clip-wallet && cd clip-wallet
pnpm install
pnpm typecheck && pnpm test && pnpm harness
```

These three must pass before every change. `pnpm harness` checks the rules on [Rules that never break](./rules.md).

## The browser extension

```sh
pnpm --filter @clip-wallet/extension dev        # opens Chrome with the extension loaded and reloads on change
```

Or build it once and load it yourself:

```sh
pnpm --filter @clip-wallet/extension build      # → apps/extension/.output/chrome-mv3
```

Open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked** and pick
`apps/extension/.output/chrome-mv3`. Create a wallet in it, then get test tokens: see [Fund a test wallet](../testing/test-wallet.md).

::: tip A wallet with sample data
`pnpm --filter @clip-wallet/extension build:fixtures` builds the extension with mock chains, a mock route and a dev
simulator, and no network access. It is what the screenshots and most end-to-end tests use.
:::

Firefox: `pnpm --filter @clip-wallet/extension build:firefox`, then load `.output/firefox-mv3` from
`about:debugging`. Clip Plugins are left out on Firefox (it has no offscreen or sandbox pages).

## The phone app (iOS and Android)

The app is Expo SDK 57 on the same wallet engine as the extension. Expo Go isn't supported (it needs native modules
for Argon2 and passkeys), so it runs as a development build:

```sh
cd apps/mobile
cp .env.example .env    # optional: WalletConnect project id, passkey domain
pnpm ios                # or: pnpm android
pnpm dapp               # a local test dapp on http://localhost:8787; open it in the app's Browse tab
```

## The desktop app (macOS, Windows, Linux)

```sh
pnpm --filter @clip-wallet/desktop dev          # Electron, with the wallet engine in the main process
pnpm --filter @clip-wallet/desktop build        # or build once…
pnpm --filter @clip-wallet/desktop start        # …and run the built app
```

The desktop app has a built-in dapp browser with 1Mask injected, and can act as the signer for the browser
extension (see [Linked devices](../architecture/link.md)).

## The docs (this site)

```sh
pnpm --filter docs dev       # http://localhost:5173/clip/docs/
pnpm --filter docs build     # static files in apps/docs/.vitepress/dist
```

See [Working on these docs](../contributing/docs.md).

## Next

- [Repository layout](./repo-layout.md): what lives where.
- [Architecture](../architecture/): how a request travels from a dapp to the vault and back.
