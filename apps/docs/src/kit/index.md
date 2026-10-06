# Launch your own wallet

The Clip Wallet kit lets you ship a wallet under your own name on the same code Clip Wallet runs: 26 network
families, 1Mask for every dapp, decoded approvals, the security floor, features, plugins and route-and-fund. One
project gives you the wallet **on every platform**: a browser extension, a desktop app for macOS, Windows and Linux,
and a phone app for iOS and Android, all described by one `clip.config.ts`. You change identity and configuration; the
wallet itself is versioned, signed npm packages.

::: warning Test networks first
A new wallet runs on test networks. Mainnet is a later decision by the wallet's owner, behind a checklist the builds and
the harness all enforce. See [Build and ship](./build-and-ship.md#mainnet).
:::

## What you get

| Platform | Folder | Built with | On the kit |
| --- | --- | --- | --- |
| Browser extension (Chrome, Edge, Brave, Firefox) | `packages/extension` | WXT | `@clip-wallet/extension-kit` |
| Desktop app (macOS, Windows, Linux) | `packages/desktop` | Electron, electron-vite, electron-builder | `@clip-wallet/desktop-kit` |
| Phone app (iOS, Android) | `packages/mobile` | Expo (React Native) | `@clip-wallet/mobile-kit` |
| Scaffold-HBAR demo dapp (optional) | `packages/nextjs` | Next.js | `@clip-wallet/connect` |

Each platform folder holds one-line entrypoints, a build config of one call and the icons. The wallet itself (vault,
engine, approvals, screens, 1Mask, the security floor) comes from the kit packages, pinned to one signed release.
Nothing in a project imports monorepo internals.

| | |
| --- | --- |
| **Its own identity everywhere** | Its own name, icon, extension id, EIP-6963 rdns, app ids, deep-link scheme and WalletConnect project. It never announces itself as Clip Wallet. |
| **Every dapp works** | EIP-1193 + EIP-6963, the Wallet Standard, AIP-62, CIP-30, `injectedWeb3`, get-starknet, TON Connect, NEAR Connect, SEP-43, Beacon and WalletConnect, all under your identity, in the extension and in the desktop and phone apps' built-in browsers. |
| **A security floor you can't switch off** | Open phishing lists, look-alike and new-contract checks, decode-before-approve, approval review and revoke. |
| **Icons from one logo** | Every platform's icons (extension, `.icns`, `.ico`, Linux, tray, iOS, Android adaptive, splash) rendered from your logo with Node alone. |
| **A Scaffold-HBAR dapp** | Next.js on Hedera testnet that connects to your wallet, signs, sends, and demos Clip Connect. |
| **Listing drafts** | For TON Connect, NEAR, Stellar Wallets Kit, Beacon, use-wallet, WalletConnect Explorer and EIP-6963, filled in with your identity. |
| **Agent tooling** | `AGENTS.md`, `llms.txt`, `.harness/` and `pnpm harness` in every project. See [Work with AI agents](./ai-agents.md). |

## Two ways in, one project

```sh
npx create-clip-wallet my-wallet
```

or, with the Scaffold-HBAR command line:

```sh
npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
cd <project> && pnpm install && pnpm wallet:identity --name "Acme Wallet" --rdns com.acme.wallet
```

Both produce **the same project**: they copy the same template the same way, then run the same identity step. The
Scaffold-HBAR route gives every platform plus the dapp, which is what `npx create-clip-wallet --scaffold-hbar` gives.

## The steps

1. [Create the project](./create-clip-wallet.md) and give it an identity and a logo.
2. [Configure it](./config.md): accent, networks, languages, app ids, routing, hardware, services.
3. [Build, test and ship it](./build-and-ship.md): the extension, the desktop app and the phone app.
4. [Sign it and open store accounts](./signing.md) when you are ready to ship. Nothing before that needs an account.
5. Keep it current: upgrade the pinned kit version deliberately, read the changelog, verify provenance.

## What lives where in your project

```text
clip.config.ts            the wallet, for every platform (typed by @clip-wallet/config)
wallet.identity.json      name, description, rdns, homepage, icon, appId, extension.key (written by wallet:identity)
icon.svg | icon.png       the logo; every platform's icons are rendered from it
MAINNET.md                the owner's mainnet checklist
.env                      CLIP_* build values (WalletConnect id, partner keys); never committed
.keys/extension.pem       the extension's private key; never committed
packages/extension/       wxt.config.ts = clipWallet({ config, configDir: "../.." }); one-line entrypoints; public/icon/
packages/desktop/         electron.vite.config.ts = clipDesktop(…); electron-builder.config.cjs = electronBuilderConfig(…);
                          one-line main / preload / renderer entrypoints; build/ icons and entitlements; tray icons
packages/mobile/          app.config.ts = expoConfig(…); metro.config.js = withClipWallet(…); index.ts = registerClipWallet();
                          assets/ icons and splash; eas.json
packages/nextjs/          the Scaffold-HBAR dapp (with --scaffold-hbar): home page, /clip-connect, /debug
docs/listings/            listing-submission drafts for your identity
docs/signing.md           code signing and store accounts: what each needs, and the variable names (never values)
tools/harness/check.mjs   the rules, as checks (pnpm harness)
tools/verify-provenance.mjs  checks the kit packages were built by the kit's CI
.harness/  AGENTS.md  llms.txt  how agents (and people) change the project safely
```

Every `@clip-wallet/*` package (and `create-clip-wallet`) is pinned to one exact version in the root and platform
`package.json` files; `pnpm verify:provenance` checks each one's npm provenance.
