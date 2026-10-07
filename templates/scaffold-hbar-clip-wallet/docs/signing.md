# Code signing and store setup

Nothing in this project is signed, and no account is needed to build it: the extension zip, the desktop installers
(unsigned) and the phone app's JavaScript bundles and native projects all build on a fresh checkout. Shipping to people
needs the accounts and certificates below. This page lists **what each one is and the environment variable names the
tools read**. Put the values in your CI's secret store (or a local `.env` that is never committed); never in this
repository, never in `clip.config.ts`.

| Platform | Account | Certificate / key | Read by |
| --- | --- | --- | --- |
| Chrome Web Store | Google developer account (one-time fee) | the extension key in `.keys/extension.pem` (fixes the extension id) | `wxt submit` <!-- only:extension --> |
| Firefox Add-ons | addons.mozilla.org account | AMO API key and secret | `wxt submit` <!-- only:extension --> |
| Microsoft Edge Add-ons | Partner Center account | Edge API credentials | `wxt submit` <!-- only:extension --> |
| macOS | Apple Developer Program | Developer ID Application certificate; notarization API key | electron-builder <!-- only:desktop --> |
| Windows | a code-signing certificate authority (OV or EV), or Azure Trusted Signing | the certificate (.pfx) or Azure credentials | electron-builder <!-- only:desktop --> |
| Linux | none (signing optional) | optional GPG key for your own apt repository | your packaging <!-- only:desktop --> |
| iOS | Apple Developer Program, App Store Connect | distribution certificate + provisioning profile (EAS can manage them) | EAS / Xcode <!-- only:mobile --> |
| Android | Google Play Console | upload keystore (EAS can manage it); Play service-account key for uploads | EAS / Gradle <!-- only:mobile --> |

<!-- platform:extension -->
## Browser extension

```sh
pnpm extension:zip                     # packages/extension/.output/*.zip for the stores
```

Keep `.keys/extension.pem` backed up offline: the Chrome Web Store item must use the same key, or the extension id
(and every listing that names it, `docs/listings/`) changes. Store uploads from CI (`wxt submit`) read:

- Chrome: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`
- Firefox: `FIREFOX_EXTENSION_ID` (your gecko id, `wallet@<your domain>`), `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`
- Edge: `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`

<!-- /platform:extension -->
<!-- platform:desktop -->
## Desktop (macOS, Windows, Linux)

```sh
pnpm desktop:dist                      # installers for this computer's OS → packages/desktop/release/
pnpm desktop:dist:mac                  # dmg + zip, arm64 and x64
pnpm desktop:dist:win                  # NSIS installer + zip (NSIS needs Windows or CI)
pnpm desktop:dist:linux                # AppImage + deb (Linux or CI) + tar.gz (anywhere)
```

Without the variables below the builds are unsigned: fine for testing, not for people (macOS Gatekeeper blocks
unsigned apps; Windows SmartScreen warns).

- **macOS signing** (Developer ID Application, exported as .p12): `CSC_LINK` (file path or base64), `CSC_KEY_PASSWORD`.
  Or `CSC_NAME` for an identity already in the build machine's keychain.
- **macOS notarization**: an App Store Connect API key: `APPLE_API_KEY` (path to the .p8), `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`. Or an Apple ID: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows signing**: `WIN_CSC_LINK` (.pfx path or base64), `WIN_CSC_KEY_PASSWORD`. EV certificates on a hardware
  token, or Azure Trusted Signing, need electron-builder's `win.signtoolOptions` / `win.azureSignOptions` (add them over
  `electronBuilderConfig()` in `packages/desktop/electron-builder.config.cjs`; Azure reads `AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`).
- **Auto-updates** (off by default; signed builds only): `CLIP_UPDATES=1` with `CLIP_UPDATES_OWNER` and
  `CLIP_UPDATES_REPO` (a GitHub repository for releases) at build time, and `GH_TOKEN` to publish.
- **Your extension talking to the desktop app** (native messaging): `CLIP_EXTENSION_IDS` lists your extension's
  Chromium ids at build time.

The app id (`<appId>.desktop`), product name and deep-link scheme come from `clip.config.ts` / `wallet.identity.json`.

<!-- /platform:desktop -->
<!-- platform:mobile -->
## Phone (iOS, Android)

```sh
pnpm mobile:export                     # JavaScript bundles for iOS and Android (no account)
pnpm mobile:prebuild                   # packages/mobile/ios and android (generated, never committed)
pnpm --filter mobile eas:build         # cloud builds with EAS (needs EXPO_TOKEN)
```

- **Expo / EAS** (optional; you can build `ios/` in Xcode and `android/` in Android Studio instead): an Expo account and
  `EXPO_TOKEN` in CI. `packages/mobile/eas.json` has development, preview and production profiles.
- **iOS**: an Apple Developer Program membership, the bundle id (`mobile.bundleId` or `appId` in clip.config) registered
  in your developer account, a distribution certificate and provisioning profile (EAS creates and stores them when you
  let it). App Store uploads (`eas submit`) read an App Store Connect API key: `EXPO_ASC_API_KEY_PATH`,
  `EXPO_ASC_API_KEY_ID`, `EXPO_ASC_API_KEY_ISSUER_ID`, plus `EXPO_APPLE_TEAM_ID`.
- **Android**: a Google Play Console account and an upload keystore (EAS can generate and keep it; if you build with
  Gradle yourself, keep the keystore and its passwords out of git and pass them to Gradle from your CI's secrets). Play
  uploads use a Google Cloud service-account JSON key: point `submit.production.android.serviceAccountKeyPath` in
  `eas.json` at a file your CI writes from a secret; never commit the key.
- **Universal links and passkeys**: `CLIP_ASSOCIATED_DOMAIN` (your domain) at build time, plus the domain's
  `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` files. Needs signed builds.

<!-- /platform:mobile -->
Store listings also need a privacy policy, a support contact and screenshots; the stores' data-safety forms must match
what Settings → Security says the wallet sends where.
