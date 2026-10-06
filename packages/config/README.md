# @clip-wallet/config

The typed schema for `clip.config.ts`, the one file a wallet maker edits, for every platform the wallet ships (browser
extension, desktop app, phone app): identity (name, description, rdns, homepage, icon, extension key, app ids,
deep-link scheme), theme, networks (26 families), languages, routing defaults and settle-on-Hedera, hardware wallets,
WalletConnect, passkeys, optional hosted services, and the mainnet switch.

`defineConfig()` validates and fills defaults; problems come back as plain sentences, one per setting
(`ConfigError.problems`). The WalletConnect project id is read from `CLIP_WALLETCONNECT_PROJECT_ID`, never committed.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/config
```

## Example

```ts
// clip.config.ts
import { defineConfig } from "@clip-wallet/config";

export default defineConfig({
  name: "Acme Wallet",
  rdns: "com.acme.wallet", // EIP-6963 id: a reverse domain you own
  homepage: "https://wallet.acme.example",
  icon: "./icon.svg",
  theme: { accent: "#0B7A3B" }, // contrast with accentText must be at least 3:1
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  mainnet: false, // test networks only
});
```

Mainnet stays off until `mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }`, and the extension build
also refuses it while `mainnetProblems(config)` lists anything (placeholder rdns, no homepage, no extension key, no
WalletConnect project id, a remote icon). Clip Wallet is pre-release and unaudited: a mainnet build moves real funds.

Platform settings, all optional:

| Setting | Default | |
| --- | --- | --- |
| `languages` | all twelve (`LANGUAGES`) | what Settings → Language offers; the first is the fallback |
| `appId` | `rdns` | the desktop and phone app id |
| `desktop.appId` | `<appId>.desktop` | macOS bundle id, Windows AppUserModelID |
| `mobile.bundleId`, `mobile.androidPackage` | from `appId` | iOS bundle id, Android package |
| `scheme` | the wallet key | deep links: `<scheme>://wc?uri=…` |
| `fees`, `usage` | `{ enabled: false }` | reserved for Clip Cloud's hosted mode; accepted, never acted on by the kit |

`platformIds(config)` returns every id the platforms use (extension gecko id, desktop app id, product, executable and
artifact names, iOS bundle id, Android package, scheme, slug). `@clip-wallet/config/node` has `loadClipConfigSync(file)`
(evaluates a clip.config.ts in a child Node process: Node 22.18+, for Expo's app.config.ts and electron-builder) and the
build-environment helpers the kits share (`buildEnv`, `resolveBuildConfig`, `iconDataUri`, `openChecklistItems`).

Helpers: `validateConfig`, `walletKey`, `rdnsDomain`, `enabledFamilies`, `includesEvmChain`, `isMainnetEnabled`,
`defaults`.

## Documentation

- [Configure clip.config.ts](https://coldai.org/clip/docs/kit/config.html)
- [Schema reference](https://coldai.org/clip/docs/reference/config.html)
- [API reference](https://coldai.org/clip/docs/reference/api/config.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
