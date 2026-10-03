# Clip Wallet mobile (iOS + Android)

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
pnpm test                         # vitest (bridge e2e, Argon2, deep links, storage) + jest-expo (screens)
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

## In-app browser

`react-native-webview` injects `inpage.generated.ts` (built by `scripts/build-inpage.mjs` from 1Mask's inpage
providers + content bridge) with `injectedJavaScriptBeforeContentLoaded`, main frame only. The page talks to
native through `window.ReactNativeWebView.postMessage`. On iOS, react-native-webview fills
`nativeEvent.url` from WebKit's `message.frameInfo.request.URL` (`apple/RNCWebViewImpl.m`). The bridge takes
the origin from that URL and the navigation state, overwrites any origin in the message, gives each origin its
own router port, and closes the port on navigation. Replies are delivered only if `location.origin` still
matches. Plain http is allowed only for local development hosts.

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
