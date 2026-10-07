# Stores and code signing

No account or certificate is needed to **build** a kit-built wallet: the extension zip, the desktop installers
(unsigned) and the phone app's JavaScript bundles and native projects all build on a fresh checkout. **Shipping** to
people needs the accounts and certificates below. Every project has its own copy of this list in `docs/signing.md`,
trimmed to the platforms it has.

::: warning Secrets stay out of the repository
Put the values in your CI's secret store (or a local `.env` that is never committed): never in the repository, never in
`clip.config.ts`. The kit reads only the **names** below; nothing in the project holds a value.
:::

## What each platform needs

| Platform | Account | Certificate or key | Variables (CI secrets) |
| --- | --- | --- | --- |
| Chrome Web Store | Google developer account (one-time fee) | the extension key in `.keys/extension.pem` (fixes the extension id) | `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` (`wxt submit`) |
| Firefox Add-ons | addons.mozilla.org account | AMO API key and secret | `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` (`wxt submit`) |
| Microsoft Edge Add-ons | Partner Center account | Edge API credentials | `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` (`wxt submit`) |
| macOS | Apple Developer Program | Developer ID Application certificate; notarization API key | `CSC_LINK`, `CSC_KEY_PASSWORD` (or `CSC_NAME`); `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) |
| Windows | an OV or EV code-signing certificate, or Azure Trusted Signing | the certificate (`.pfx`) or Azure credentials | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (Azure: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) |
| Linux | none (signing optional) | an optional GPG key for your own apt repository | your packaging |
| Desktop auto-updates | a GitHub repository for releases | | `CLIP_UPDATES=1`, `CLIP_UPDATES_OWNER`, `CLIP_UPDATES_REPO`, `GH_TOKEN` |
| iOS | Apple Developer Program, App Store Connect | distribution certificate and provisioning profile (EAS can manage them) | `EXPO_TOKEN` (EAS); `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_API_KEY_ID`, `EXPO_ASC_API_KEY_ISSUER_ID`, `EXPO_APPLE_TEAM_ID` (`eas submit`) |
| Android | Google Play Console | upload keystore (EAS can keep it); a Play service-account key for uploads | `EXPO_TOKEN`; the service-account key file path in `eas.json`, written from a secret |
| Universal links and passkeys | a domain you control | the domain's `apple-app-site-association` and `assetlinks.json` | `CLIP_ASSOCIATED_DOMAIN` |

## Browser extension

```sh
pnpm extension:zip                     # packages/extension/.output/*.zip for the stores
```

Keep `.keys/extension.pem` backed up offline: the Chrome Web Store item must use the same key, or the extension id (and
every listing that names it, in `docs/listings/`) changes. `FIREFOX_EXTENSION_ID` is your gecko id
(`wallet@<your domain>`).

## Desktop app

```sh
pnpm desktop:dist                      # installers for this computer's OS → packages/desktop/release/
pnpm desktop:dist:mac                  # dmg + zip, arm64 and x64
pnpm desktop:dist:win                  # NSIS installer + zip (NSIS needs Windows or CI)
pnpm desktop:dist:linux                # AppImage + deb (Linux or CI) + tar.gz (anywhere)
```

Without the signing variables the builds are unsigned: fine for testing, not for people (macOS Gatekeeper blocks
unsigned apps; Windows SmartScreen warns). `electronBuilderConfig()` turns signing, notarization and update publishing
on only when their variables are set.

- **macOS signing**: the Developer ID Application certificate exported as `.p12`, in `CSC_LINK` (a file path or base64)
  with `CSC_KEY_PASSWORD`, or `CSC_NAME` for an identity already in the build machine's keychain.
- **macOS notarization**: an App Store Connect API key (`APPLE_API_KEY`, the path to the `.p8`, with
  `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`), or an Apple ID (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`).
- **Windows signing**: `WIN_CSC_LINK` (a `.pfx` path or base64) and `WIN_CSC_KEY_PASSWORD`. EV certificates on a
  hardware token, or Azure Trusted Signing, need electron-builder's `win.signtoolOptions` or `win.azureSignOptions`,
  added over `electronBuilderConfig()` in `packages/desktop/electron-builder.config.cjs`.
- **Auto-updates** are off by default and for signed builds only: `CLIP_UPDATES=1` with `CLIP_UPDATES_OWNER` and
  `CLIP_UPDATES_REPO` at build time, and `GH_TOKEN` to publish.
- **Your extension talking to the desktop app** (native messaging): `CLIP_EXTENSION_IDS` lists your extension's
  Chromium ids at build time.

The app id (`<appId>.desktop`), product name and deep-link scheme come from `clip.config.ts` and
`wallet.identity.json` (see [Platforms](./config.md#platforms)).

## Phone app

```sh
pnpm mobile:export                     # JavaScript bundles for iOS and Android (no account)
pnpm mobile:prebuild                   # packages/mobile/ios and android (generated, never committed)
pnpm --filter mobile eas:build         # cloud builds with EAS (needs EXPO_TOKEN)
```

- **Expo / EAS** is optional: you can build `ios/` in Xcode and `android/` in Android Studio instead. With EAS, an Expo
  account and `EXPO_TOKEN` in CI; `packages/mobile/eas.json` has development, preview and production profiles.
- **iOS**: an Apple Developer Program membership, the bundle id (`mobile.bundleId` or `appId`) registered in your
  developer account, and a distribution certificate and provisioning profile (EAS creates and stores them when you let
  it). App Store uploads (`eas submit`) read an App Store Connect API key.
- **Android**: a Google Play Console account and an upload keystore (EAS can generate and keep it; if you build with
  Gradle yourself, keep the keystore and its passwords out of git and pass them from your CI's secrets). Play uploads
  use a Google Cloud service-account JSON key: point `submit.production.android.serviceAccountKeyPath` in `eas.json` at
  a file your CI writes from a secret.
- **Universal links and passkeys**: `CLIP_ASSOCIATED_DOMAIN` at build time, plus the domain's
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. They need signed builds.

## Before you submit

Store listings also need a privacy policy, a support contact and screenshots. The stores' data-safety forms must match
what Settings → Security says the wallet sends where, and the listing drafts in `docs/listings/` (`pnpm wallet:listings`)
must name your own identity. Mainnet stays a separate decision: see [Mainnet](./build-and-ship.md#mainnet).
