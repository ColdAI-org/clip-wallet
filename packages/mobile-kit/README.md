# @clip-wallet/mobile-kit

The Clip Wallet phone app (Expo / React Native: iOS, Android) as a library. A wallet project keeps its identity
(`clip.config.ts`, `assets/`), `app.config.ts`, `metro.config.js` and a three-line `index.ts`; the screens, the vault and
engine host (Keychain / Keystore, Face ID / fingerprint, passkeys), the in-app dapp browser with 1Mask, WalletConnect,
Clip Plugins, Ledger over Bluetooth and Keystone, linked devices and notifications come from here.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npx expo install @clip-wallet/mobile-kit @clip-wallet/config
```

Then add the native modules listed in this package's `peerDependencies` (Expo autolinking only links what the app
depends on).

## Example

```ts
// index.ts
import "@clip-wallet/mobile-kit/polyfills"; // first
import { registerClipWallet } from "@clip-wallet/mobile-kit";
registerClipWallet({ icon: require("./assets/icon.png") });
```

```ts
// app.config.ts
import { expoConfig } from "@clip-wallet/mobile-kit/expo";
export default () => expoConfig({ configFile: "../../clip.config.ts", root: __dirname });
```

```js
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withClipWallet } = require("@clip-wallet/mobile-kit/metro");
module.exports = withClipWallet(getDefaultConfig(__dirname), { configFile: "../../clip.config.ts", root: __dirname });
```

`npx create-clip-wallet my-wallet` writes all of this for you (`packages/mobile`).

## What the kit takes from clip.config.ts

- **Expo config** (`expoConfig()`): name, slug, deep-link scheme, iOS bundle id and Android package
  (`platformIds(config)`: `appId`, else `rdns`; override with `mobile.bundleId` / `mobile.androidPackage`), the icon,
  Android adaptive icon (accent background) and splash screen create-clip-wallet renders from the logo, permission
  texts in the wallet's name, universal links for `CLIP_ASSOCIATED_DOMAIN`.
- **The app** (`withClipWallet()`): the validated config, with the build environment applied, as the
  `virtual:clip-wallet/config` module (written to `node_modules/.cache/clip-wallet/config.js` on every Metro start), so the
  screens, the EIP-6963 identity in the in-app browser (name, rdns, icon), the Keychain service (`<rdns>.vault`), the
  languages offered and the hosted services all follow it.
- **Mainnet checklist.** Both refuse a config with mainnet enabled while `mainnetProblems()` lists anything or MAINNET.md
  next to clip.config.ts has an open box.

Native modules are peer dependencies (Expo autolinking only links what the app depends on): install the versions in
this package's `peerDependencies`. Node 22.18 or newer (the helpers read clip.config.ts with Node's type stripping).

## Building without accounts

`expo export` (the JS bundle) and `expo prebuild` (the native projects, generated, never committed) need no account.
`eas build` needs an Expo account and, for store builds, Apple Developer / Google Play credentials.

## Documentation

- [Launch your own wallet](https://coldai.org/clip/docs/kit/)
- [Build and ship: the phone app](https://coldai.org/clip/docs/kit/build-and-ship.html#phone-app)
- [Stores and code signing](https://coldai.org/clip/docs/kit/signing.html)
- [API reference](https://coldai.org/clip/docs/reference/api/mobile-kit.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
