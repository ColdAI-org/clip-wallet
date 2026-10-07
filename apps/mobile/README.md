# Clip Wallet mobile (iOS + Android)

> The app's code is [`@clip-wallet/mobile-kit`](../../packages/mobile-kit) (`packages/mobile-kit`), shared with every
> kit-built wallet; this folder is Clip Wallet's brand on it: `clip.config.ts`, `assets/` rendered from `brand/`,
> `index.ts` (`registerClipWallet()`), `app.config.ts` (`expoConfig()`), `metro.config.js` (`withClipWallet()`) and the
> local test dapp. Paths in "What's where" (`src/…`, `test/…`) are in the kit; its tests run with
> `pnpm --filter @clip-wallet/mobile-kit test`.

Expo SDK 57 (React Native 0.86.3, React 19.2.3, Hermes, New Architecture, which is the only architecture in
RN 0.82+). It runs the same packages as the extension through `@clip-wallet/engine`. Testnets only.

## Run

```sh
pnpm install
cd apps/mobile
cp .env.example .env              # optional: EXPO_PUBLIC_WC_PROJECT_ID, EXPO_PUBLIC_PASSKEY_RP_ID, CLIP_ASSOCIATED_DOMAIN
pnpm ios                          # builds the inpage bundle, then `expo run:ios` (needs Xcode, CocoaPods, an iOS Simulator runtime)
pnpm android                      # `expo run:android`
pnpm dapp                         # local test dapp on http://localhost:8787 (EIP-6963 + personal_sign); open it in Browse
pnpm --filter @clip-wallet/mobile-kit test   # vitest (bridge e2e, Argon2, deep links, storage) + jest-expo (screens)
pnpm typecheck
pnpm export:ios                   # Metro + Hermes bytecode bundle only (no Xcode needed)
```

Native projects are generated (`pnpm prebuild`) and gitignored. Expo Go isn't supported because of the native
modules (Argon2, passkeys). Use a dev build (`expo-dev-client`).

## What's where

| Path | |
| --- | --- |
| `src/background/` | the only place here that may import `@clip-wallet/vault` (harness). `host.ts` builds the vault + engine |
| `src/background/argon2.ts` | Argon2id for Hermes: react-native-argon2, self-tested, @noble pure-JS fallback |
| `src/background/storage.ts` | vault record → expo-secure-store; app data → AsyncStorage |
| `src/background/device-key.ts` | Face ID / Touch ID / fingerprint unlock (device key as a PRF for the vault's passkey slot) |
| `src/background/passkey.ts` | real passkeys (WebAuthn PRF) via react-native-passkey |
| `src/browser/` | in-app browser: injected 1Mask bundle + native bridge (origin from the WebView, never the page) |
| `src/screens/` | onboarding (phrase reveal + check), unlock, home (one total), asset detail, collectibles, activity, send (network-matters), receive (QR), approval sheet, connect approval, settings (Advanced mode, sessions, WalletConnect), QR scanner, browser |
| `src/screens/` (features) | Explore tab, Stake, Swap, Buy, Secure Trade (list, new, share, review/accept) |
| `src/screens/` (platform) | Backup hub, recovery phrase (hidden until held), passkey backup, Accounts (add, rename, per site) |
| `src/screens/Hardware.tsx` | Hardware wallets in Settings, Connect (Ledger over Bluetooth, Keystone by camera), the device step over the approval sheet |
| `src/background/ledger-ble.ts` | Ledger Bluetooth transport, device pick and permissions |
| `src/ui/ur.tsx` | Keystone animated UR QR and the UR camera scanner |
| `src/ui/` | tokens from `@clip-wallet/ui` `tokensFor` as RN values, plus RN versions of the ui components |

## Unlock methods: what works where

| | iOS | Android |
| --- | --- | --- |
| Password | Argon2id (native, 64 MiB, t=3) | same |
| Face ID / Touch ID / fingerprint (device key) | Keychain item with `SecAccessControl .biometryCurrentSet` (Secure Enclave-enforced, invalidated when biometrics change, `WhenPasscodeSetThisDeviceOnly`, never backed up) | Keystore key with `setUserAuthenticationRequired(true)` |
| Real passkeys (synced, PRF) | iOS 18+, needs `webcredentials:<rpId>` + an AASA file | Android 9+ with Credential Manager, needs Digital Asset Links |
| Simulator / emulator | Keychain/Keystore biometrics aren't enforced there (expo-secure-store docs), so the app also runs `LocalAuthentication.authenticateAsync` (Features → Face ID → Matching Face) | same |

The device key never leaves the phone. The vault wraps its key under HKDF(HMAC-SHA256(device secret,
prfInput)), the same construction it uses for WebAuthn PRF. The password always keeps working.

## WalletConnect

`@reown/walletkit` 1.6 through `@clip-wallet/1mask/walletconnect`. `@walletconnect/react-native-compat` 2.25 is
the first import (`src/polyfills.ts`). It polyfills `crypto.getRandomValues`, `TextEncoder/Decoder`, `URL`,
`Buffer`, `atob/btoa`, and needs `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`,
`expo-application` and `react-native-get-random-values` (its peer dependencies). The project id comes from
`EXPO_PUBLIC_WC_PROJECT_ID`. Without it, Settings says plainly that connecting with a code is off. The QR
scanner uses expo-camera. Deep links: `clipwallet://wc?uri=…`, `clipwallet://browse?url=…`, a bare `wc:…`, and
`https://<CLIP_ASSOCIATED_DOMAIN>/wc?uri=…` once a domain is associated (placeholder). No push.

## Stake, Swap, Buy, Secure Trade

The same screens and copy as the extension, on `@clip-wallet/engine`'s feature services (`wallet.features`).
Every action ends in the normal approval sheet.

- **Getting there.** As in the extension: Explore is a bottom tab. It lists Stake, Swap, Buy and Secure Trade,
  then staking, liquidity and featured apps. Home has a Swap / Buy / Stake row. The asset screen has Swap and
  Buy with that asset filled in, and Stake where a live provider exists (`STAKEABLE_NOW`: HBAR, SOL). Settings
  has the same "More" menu.
- **Stake** shows every provider the engine's StakingService exposes. HBAR and SOL are live. ADA, DOT, NEAR and
  XTZ say "coming soon" in plain words.
- **Buy** opens the provider's widget in the in-app browser sheet (`expo-web-browser`: SFSafariViewController
  on iOS, Custom Tabs on Android). Card entry, Apple Pay / Google Pay and ID checks run on the provider's page,
  not in a WebView the wallet controls. Without partner keys it says "not switched on in this build".
- **Secure Trade** (Hedera). The share link goes out through the native share sheet and as a QR code. Links are
  `clipwallet://trade#offer=…`, or `https://<CLIP_ASSOCIATED_DOMAIN>/trade#offer=…` once a domain is
  associated. The deep link (`#offer=` or `?offer=`) and the QR scanner both open the review. The review is
  decoded from the actual transaction.

## Backup and accounts

- **Recovery phrase.** You type your password again (the vault checks it). Face ID / Touch ID / fingerprint
  runs first when set up. While hidden, the words are not rendered at all. They show while the button is
  held, or after a tap. They hide when the app leaves the foreground and after 60 s. Copying is off unless
  "Allow copying" is on. A three-word check finishes the backup.
- **Passkey backup** appears only with `services.backupUrl` in clip.config. It needs a passkey domain
  (`EXPO_PUBLIC_PASSKEY_RP_ID` + `CLIP_ASSOCIATED_DOMAIN`). Without one, it says so instead of starting.
- **Accounts.** Add and rename accounts, and pick the one in use. Settings → Connected apps → Accounts picks
  the account one app sees.

## Hardware wallets

- **Keystone** is fully air-gapped through the camera. To add it, scan its account QR (`crypto-multi-accounts`
  / `crypto-hdkey` / `crypto-account`). To sign, the approval sheet shows an animated UR QR (BC-UR fountain
  parts, 5 fps). After Keystone signs, the camera reads its answer.
- **Ledger** over Bluetooth (Nano X, Stax, Flex) through `@ledgerhq/react-native-hw-transport-ble` 6.41.0.
  It pins `react-native-ble-plx` 3.4.0, which is a direct dependency here so it autolinks. Look for the Ledger,
  pick it, then pick accounts. Approvals reopen the same Ledger.
- **Permissions** (app.config.ts):
  - iOS: `NSBluetoothAlwaysUsageDescription` and `NSCameraUsageDescription`.
  - Android: the ble-plx config plugin adds `BLUETOOTH_SCAN` with `neverForLocation`, plus location
    permissions capped at SDK 30. `BLUETOOTH_CONNECT` is listed. On Android 12+, scan and connect are
    requested at run time; on Android 11 and lower, fine location is requested instead.
- **New Architecture caveat.** ble-plx 3.4.0 has no codegen spec, so it runs through React Native's interop
  layer. [dotintent/react-native-ble-plx#1277](https://github.com/dotintent/react-native-ble-plx/issues/1277)
  (open) reports a crash on connect with the New Architecture on RN 0.76. RN 0.82+ has no legacy architecture
  to fall back to. Treat Ledger Bluetooth as unverified until it has run on a device.
- **Metro.** The Keystone SDK pulls in `hdkey` and `cipher-base`, which need Node's `crypto` and `stream`.
  `metro.config.js` maps `crypto` to `src/shims/node-crypto.js` (`@noble/hashes`) and `stream` to
  readable-stream's browser build.

## Security and Clip Plugins

- **Settings → Security** has the extension's three screens on the engine's security service:
  - App permissions: risk flags; risky ones are ticked for you; removing one goes through the normal approval sheet.
  - Clean up: spam and empty accounts, with "Get back ~X SOL" on Solana.
  - Scam protection: each list, when it was updated and what it sees. Blockaid is off without a key.
- **Clip Plugins** (Settings → Advanced → Plugins, off by default). Install is the extension's flow: npm integrity,
  manifest, bundle hash, then the permission prompt. Each running plugin gets one hidden WebView
  (`src/plugins/PluginSandboxes.tsx`):
  - An inline SES page at about:blank, with a CSP that allows only its own script (by hash) plus eval, and no network.
  - Every other load is refused, and there is no storage, cache, files or windows.
  - react-native-webview's `postMessage` is the only bridge, schema-checked both ways (`src/plugins/protocol.ts`).
  - Notes appear on the approval sheet in a separate "From <plugin>" card.
  - The page is generated by `scripts/build-plugin-sandbox.mjs` (run with the inpage build) into
    `src/plugins/sandbox.generated.ts` (gitignored).
  - What only a device can confirm: docs/phase25/integration/mobile-parity.md.

## In-app browser

`react-native-webview` injects `inpage.generated.ts` (built by `scripts/build-inpage.mjs` from 1Mask's inpage
providers + content bridge) with `injectedJavaScriptBeforeContentLoaded`, main frame only. The page talks to
native through `window.ReactNativeWebView.postMessage`. On iOS, react-native-webview fills
`nativeEvent.url` from WebKit's `message.frameInfo.request.URL` (`apple/RNCWebViewImpl.m`). The bridge takes
the origin from that URL and the navigation state, overwrites any origin in the message, gives each origin its
own router port, and closes the port on navigation. Replies are delivered only if `location.origin` still
matches. Plain http is allowed only for local development hosts.

Only the top frame talks to the wallet. `react-native-webview` is patched
(`patches/react-native-webview@13.16.1.patch`): Android drops WebMessageListener messages from subframes and never
falls back to `addJavascriptInterface` (visible to every frame, and it reports the top page's URL for all of them),
so a WebView without `WEB_MESSAGE_LISTENER` (Android System WebView < 86) gets no bridge; iOS drops messages whose
`frameInfo` isn't the main frame. Both mark the event `isMainFrame: true`, and the bridge refuses any message
without it. When upgrading react-native-webview, re-create the patch (`pnpm patch react-native-webview`).

## Sources checked for this package (2026-10-03)

- Expo 57.0.26 `bundledNativeModules.json` (npm): react-native 0.86.3, react 19.2.3, expo-* ~57.0.x,
  react-native-webview 13.16.1, react-native-get-random-values ~1.11.0, async-storage 2.2.0, netinfo 12.0.1.
- `@walletconnect/react-native-compat` 2.25.0 `index.js` and `package.json` (npm): polyfills and peer dependencies.
- `react-native-argon2` 4.0.0 README / `index.d.ts`: `saltEncoding: 'hex'`, Argon2Swift (iOS), argon2kt (Android).
- `react-native-passkey` 3.6.2 README / `PasskeyTypes.d.ts`: PRF on Android and iOS 18+, associated domains.
- `expo-secure-store` 57.0.4 `SecureStore.d.ts` + `ios/SecureStoreModule.swift`: `requireAuthentication` →
  `.biometryCurrentSet` / `setUserAuthenticationRequired`, key charset, "simulators do not require biometric authentication".
- Hermes has no `WebAssembly` ([facebook/hermes#429](https://github.com/facebook/hermes/issues/429)). hash-wasm
  4.12.0 `dist/index.esm.js` throws `WebAssembly is not supported in this environment!`.
- `@hiero-ledger/sdk` 2.89.1 `package.json` exports: `"react-native": "./lib/native.js"`.
- `@ledgerhq/react-native-hw-transport-ble` 6.41.0 (npm, modified 2026-08-10): depends on `react-native-ble-plx`
  3.4.0, `@ledgerhq/hw-transport` 6.35.5 and rxjs. README: global `Buffer` required (installed by
  `@walletconnect/react-native-compat`); `listen` / `open(id)` / `observeState`.
- `react-native-ble-plx` 3.4.0 (npm): Expo config plugin options `isBackgroundEnabled`, `modes`,
  `bluetoothAlwaysPermission`, `neverForLocation` (`plugin/build/withBLEAndroidManifest.js`). No
  `codegenConfig`, so it is a legacy module on the New Architecture. Latest is 3.5.1, but the Ledger transport
  pins 3.4.0. New Architecture crash report: dotintent/react-native-ble-plx#1277.
- Expo 57 `bundledNativeModules.json`: `expo-web-browser` ~57.0.3. `WebBrowser.openBrowserAsync(url,
  { presentationStyle: PAGE_SHEET })` (`build/WebBrowser.types.d.ts`).
