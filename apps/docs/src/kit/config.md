# Configure clip.config.ts

Everything a wallet maker changes, apart from the logo, is one file: `clip.config.ts`. In a kit-built wallet it sits at
the project root and drives every platform: the extension, the desktop app and the phone app read the same file. In
this repo, each of Clip Wallet's own apps has one (`apps/extension/clip.config.ts`, `apps/desktop/clip.config.ts`,
`apps/mobile/clip.config.ts`). It is validated by `defineConfig()` from `@clip-wallet/config`, which fills in defaults
and refuses anything wrong with a plain sentence per problem.

<<< @/snippets/kit/project/clip.config.ts

Only `name` and `rdns` are required. In a kit-built wallet, the identity fields come from `wallet.identity.json`,
which `pnpm wallet:identity` writes; edit identity there. Every setting with its type and default:
[clip.config.ts schema](../reference/config.md).

## Identity and branding

| Setting | |
| --- | --- |
| `name` | shown in the stores, wallet pickers and every screen; also derives the window global (`acmewallet`) |
| `rdns` | the EIP-6963 id dapps key on: a reverse domain **you own** |
| `description`, `homepage` | stores, WalletConnect metadata and listings |
| `icon` | `./icon.svg` or `./icon.png`, next to the config; shipped inside every build as the identity dapps see |
| `extension.key` | the public key that fixes the Chrome extension id (written by the identity step) |
| `theme` | `accent`, `accentText` (contrast at least 3:1), `font`, `radius` |

Screens read only theme tokens and the configured name, so the whole wallet takes your brand. Small accent-coloured
text is derived from `accent` to reach 4.5:1 contrast automatically.

## Platforms

These settings are optional; without them every platform takes its ids from `rdns` and the name.

| Setting | Default | Extension | Desktop | Phone |
| --- | --- | --- | --- | --- |
| `name`, `description` | | manifest, pickers | window titles, menus, tray, installers, permission prompts | app name, permission texts |
| `rdns` | | EIP-6963 | EIP-6963 in the built-in browser, native-messaging host name | EIP-6963 in the in-app browser, Keychain service `<rdns>.vault` |
| `appId` | `rdns` | | `<appId>.desktop` | iOS bundle id `appId`, Android package (hyphens become `_`) |
| `desktop.appId` | `<appId>.desktop` | | override | |
| `mobile.bundleId`, `mobile.androidPackage` | from `appId` | | | overrides |
| `scheme` | the wallet key (`acmewallet`) | | `<scheme>://wc?uri=…`, `browse`, `link`, `trade` | the same |
| `languages` | all twelve | Settings → Language and device matching | the same, plus the Chromium UI locales kept in the installer | the same |
| `icon` | `./icon.svg` | the identity dapps see | inlined into the build | inlined into the bundle |
| `theme` | | screens | screens | screens; adaptive-icon and splash background are the accent |
| `networks`, `services`, `route`, `hardware`, `passkeys` | | ✓ | ✓ | ✓ |
| `fees`, `usage` | `{ enabled: false }` | reserved for Clip Cloud's hosted mode: accepted, never acted on by the kit | | |
| `mainnet` | `false` | every build refuses it until `MAINNET.md` is done and `mainnetProblems()` is empty | | |

`languages` takes `en`, `de`, `fr`, `es`, `pt-BR`, `it`, `tr`, `ja`, `ko`, `zh-Hans`, `ar` and `hi`; the first is the
fallback, and only the languages listed are matched and offered. `platformIds(config)` returns every id the platforms
use (extension gecko id, desktop app id, product, executable and artifact names, iOS bundle id, Android package, scheme,
slug), so you can check them before a build. Build tools that need the config outside a bundler (Expo's
`app.config.ts`, electron-builder) use `loadClipConfigSync()` from `@clip-wallet/config/node`, which evaluates the file
in a child Node process (Node 22.18 or later).

## Networks

<<< @/snippets/kit/networks.ts

`networks` takes `"evm:*"` (every EVM chain the kit ships), `"evm:<chain id>"`, an EVM network slug, or a family name:
`hedera`, `solana`, `bitcoin`, `sui`, `aptos`, `cardano`, `substrate`, `starknet`, `ton`, `near`, `stellar`, `tezos`,
`algorand`. A family you leave out isn't loaded, and its dapp connectors aren't installed. While `mainnet` is `false`,
only test networks are used.

## Routing

`route.mode`, `route.filters` and `route.settleOnHedera` set the defaults for route-and-fund. See
[Route and settle](../architecture/route-settle.md#routing-defaults).

## Services

<<< @/snippets/kit/services.ts

Each is optional and off when unset: passkey backup and sync, NFT media, phone pairing, and Clip handles. Run your own
deployments: [Services](../services/).

## Keys that never go in the config

The WalletConnect project id and partner keys come from the **build environment**, never from this file:

```sh
# .env at the project root (gitignored); only CLIP_* lines are read, by every platform's build
CLIP_WALLETCONNECT_PROJECT_ID=<your 32-character project id>
CLIP_0X_API_KEY=<your 0x key>
CLIP_BLOCKAID_API_KEY=<your Blockaid key>
```

The full list is on [Features](../architecture/features.md#partner-keys). Without a key, the feature says plainly that it
isn't switched on in this build.

## Validation

<<< @/snippets/kit/validate.ts

## Mainnet

::: danger Real funds
Clip Wallet is pre-release and has had no external audit. Turning mainnet on makes your wallet move real money. Only do
it after every box in `MAINNET.md` (at the project root) is ticked by a person: your own identity and keys, production
services, an independent review of your changes, usability tests, and support and security contacts.
:::

`mainnet` is `false` or the checklist object, with the acknowledgement copied word for word:

<<< @/snippets/kit/mainnet.ts

Three things enforce it: every platform's build (the extension, the desktop app and the phone app) refuses mainnet
while `mainnetProblems()` lists anything or `MAINNET.md` has an open box; `pnpm harness` fails while mainnet is on with
an open box; and `pnpm wallet:mainnet-check` lists what is left. Coding agents must never tick the boxes or switch
mainnet on.
