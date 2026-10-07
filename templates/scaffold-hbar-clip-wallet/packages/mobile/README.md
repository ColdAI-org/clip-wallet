# The phone app

Your wallet for iOS and Android: an [Expo](https://expo.dev) app on
[`@clip-wallet/mobile-kit`](https://www.npmjs.com/package/@clip-wallet/mobile-kit). The kit is the app (vault in the
Keychain / Keystore, Face ID and fingerprint unlock, passkeys, the screens, an in-app dapp browser with 1Mask,
WalletConnect, Ledger over Bluetooth, Keystone, linked devices); this folder holds a three-line `index.ts`, the Expo and
Metro configs and the icons. Name, ids, theme, networks, languages, deep links and services come from
`../../clip.config.ts`.

| File | What it is |
| --- | --- |
| `index.ts` | Starts the kit: `registerClipWallet({ icon })`. |
| `app.config.ts` | One line: `expoConfig({ configFile })`: name, scheme, bundle id, package, icons, splash, permissions. |
| `metro.config.js` | One line: `withClipWallet(getDefaultConfig(__dirname), { configFile })`. |
| `assets/` | Icon, Android adaptive + monochrome icon, splash image: rendered from the logo (`pnpm wallet:brand`). |
| `eas.json` | Build profiles for EAS Build (optional; needs an Expo account). |

```sh
pnpm start            # Metro for a development build (pnpm --filter mobile start from the project root)
pnpm export           # the JavaScript bundles for iOS and Android in dist/ (no account, no Xcode or Android SDK)
pnpm prebuild         # generate ios/ and android/ (never committed); then open them in Xcode / Android Studio
pnpm ios              # build and run on the iOS simulator (Xcode) · pnpm android: emulator or device (Android SDK)
pnpm eas:build        # cloud builds with EAS (Expo account; store builds also need Apple / Google accounts)
```

The app uses native modules (secure storage, biometrics, camera, Bluetooth, passkeys), so it runs in a development
build (`expo-dev-client`), not in Expo Go. Store setup and signing: `../../docs/signing.md`.
