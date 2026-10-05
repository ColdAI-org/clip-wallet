# Picker matrix: stock wallet pickers and hosted testnet dapps

The [dapp matrix](dapp-matrix.md) proves each family's discovery and dapp library at the protocol level. This one asks
the next question: **does Clip show up, look right and connect in the wallet pickers dapps actually ship, and in real
hosted dapps?** Same real build (real vault, real chain modules, real 1Mask), same matrix wallet (imported from the
git-excluded `.env.dapp-matrix`, never logged or captured), public testnets only.

- **Part 1, stock pickers** (`apps/extension/e2e/pickers.spec.ts`): each ecosystem's stock connect UI, unmodified and
  with its default configuration, in a local page served on its own `https://<id>.picker-dapp.example` origin and pointed
  at the public testnet (`apps/extension/e2e/pickers/dapps/src/<id>.tsx`, its own private package `clip-picker-dapps`
  so every library gets the peer versions it supports: wagmi 2, React 18).
- **Part 2, hosted dapps** (`apps/extension/e2e/hosted-dapps.spec.ts`): real public testnet dapps loaded by URL.

```bash
pnpm --filter @clip-wallet/extension pickers                                  # builds the wallet, runs both parts
pnpm --filter @clip-wallet/extension pickers -- -g "ton|near"                 # some pickers
pnpm --filter @clip-wallet/extension pickers -- e2e/hosted-dapps.spec.ts      # part 2 only
```

Like the matrix it is left out of the default `pnpm e2e` (`DAPP_MATRIX=1` turns it on). `PICKER_DEBUG=<dir>` saves
step-by-step screenshots of the dapp page and, on a hosted failure, of the wallet's own windows.

## What each column checks

| Column | Part 1 (stock picker) | Part 2 (hosted dapp) |
| --- | --- | --- |
| **Listed** | The open picker shows "Clip Wallet". The name shown is recorded. For pickers that only show registry wallets, the picker must be open (another wallet visible) and Clip absent: **no (expected)**. | Clip appears in the dapp's own connect UI. |
| **Icon OK** | The entry's image has loaded (natural size > 0) and is the Clip icon: its source equals the icon the extension announces (EIP-6963 `info.icon` = `window.clipwallet.info.icon`), or the rendered pixels are the Clip mark (share of Clip orange `#FF3C00`). | Same. |
| **Connects** | Clicking Clip, then approving in the wallet, makes the **library** report the matrix account (`addresses.json`; Polkadot compared by public key, TON raw vs friendly form, Starknet by value). | The dapp shows the matrix account. |
| **Reconnect** | The library's own disconnect clears the account; picking Clip again connects again. | – |
| **Reload** | After a page reload the library restores the session without asking (where it has autoconnect). | – |
| **Signed** | – | One free, reversible signed action: a message signature, verified (in Node or by the dapp). Never a transaction, never mainnet. |

Screenshots of every open picker with Clip in it: `apps/extension/e2e/shots/pickers/<id>.png` (hosted:
`hosted-<id>-*.png`). Raw results: `shots/pickers/results.json` and `shots/pickers/hosted.json`.

## Results (2026-10-06, full run: 31 passed, 1 skipped, plus 8 hosted dapps passed)

### Part 1: stock pickers

"Stock" = the picker with only its own wallets/modules; "+ Clip" = the same picker with the one documented thing a dapp
adds for an unlisted wallet (a module, an adapter, a list entry). The "+ Clip" rows show what changes once Clip is
listed.

| Ecosystem | Picker | Listed | Icon OK | Connects | Reconnect | Reload | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EVM | RainbowKit 2.2.11 `ConnectButton` (`getDefaultConfig`, placeholder WC id) | **yes** (under "Installed") | yes (same data URI) | yes | yes | yes | Injected EIP-6963 path; the WalletConnect QR flows need a real id and weren't tested. |
| EVM | ConnectKit 1.9.2 `ConnectKitButton` (no WC id) | **yes** | yes | yes | yes | yes | |
| EVM | Reown AppKit 1.8.24 `<appkit-button>` (wagmi adapter, placeholder project id) | **yes** ("Installed") | yes | yes | yes | yes | Limited by the missing project id: no WalletConnect QR, no wallet explorer ("All wallets"), email/socials don't work. The injected path needs none of them. |
| Solana | `@solana/wallet-adapter-react-ui` 0.9.40 `WalletMultiButton` / modal | **yes** | yes | yes | yes | yes (`autoConnect`) | Wallet Standard detection. |
| Sui | `@mysten/dapp-kit` 1.1.17 `ConnectButton` | **yes** | yes | yes | yes | yes (`autoConnect`) | |
| Aptos | `@aptos-labs/wallet-adapter-ant-design` 5.3.19 `WalletSelector` | **yes** (under the social login) | yes | yes | yes | yes (`autoConnect`) | AIP-62 detection. |
| Cardano | Mesh `@meshsdk/react` 2.0.0-beta.2 (current `latest`) `CardanoWallet` | **yes** (icon tile, name in the tooltip/alt) | yes | yes | yes | yes (`persist`) | Lists every `window.cardano` CIP-30 wallet. |
| Cardano | cardano-connect-with-wallet 0.2.22 `ConnectWalletButton`, stock | no (expected) | – | – | – | – | Shows only its own registry (`supportedWallets` defaults). **Needs a listing.** |
| Cardano | same, `supportedWallets` + `"clipwallet"` | yes, as **"Clipwallet"** | yes | yes | yes | yes | Unlisted wallets are named by their `window.cardano` key, capitalised; `window.cardano.clipwallet.name` is ignored. The registry entry fixes the name. |
| Polkadot | Talisman Connect 1.1.9 `WalletSelect`, stock | no (expected) | – | – | – | – | `getWallets()` is a fixed list of nine wallet classes. **Needs a listing.** |
| Polkadot | same, `walletList` + a Clip entry | **yes** | yes | yes | yes | n/a | Talisman Connect keeps no session; the page holds the selected account in memory. |
| Polkadot | DOT Connect 0.31.0 `<dc-connection-button>` (ReactiveDOT) | yes, as **"clip-wallet"** | **no** (generic wallet glyph) | yes | yes | yes | Lists every `injectedWeb3` extension, but names and logos come from DOT Connect's own wallet list; the Polkadot{.js} extension interface has no name or icon field, so the wallet can't fix this. **Needs a listing.** |
| Starknet | starknetkit 3.4.3 `connect()` modal, default connectors | no (expected) | – | – | – | – | Default connectors are a fixed list (Ready/Argent X, Braavos, Cartridge, and MetaMask/Fordefi/Keplr/Xverse when injected). **Needs a listing.** |
| Starknet | same, connectors + `new InjectedConnector({ options: { id: "clipwallet" } })` (no name, no icon) | **yes** | yes (taken from `window.starknet_clipwallet`) | yes | yes | yes (`neverAsk`) | |
| Bitcoin | sats-connect 4.2.1 selector (`@sats-connect/ui`) | no (expected) | – | – | – | – | The only stock Bitcoin picker. It lists sats-connect's built-in adapters (`DefaultAdaptersInfo`); it reads neither the Wallet Standard (where Clip's `bitcoin:*` and `sats-connect:` provider are) nor WBIP-004 `btc_providers`. **Needs a listing.** |
| NEAR | Wallet Selector 10.1.4 `modal-ui`, stock modules (MyNearWallet, Meteor) | no (expected) | – | – | – | – | Lists only the modules the dapp passes. |
| NEAR | same + `@clip-wallet/kit-modules/near` | **yes** | yes | yes | yes | yes | |
| Stellar | Stellar Wallets Kit 2.7.0 button + modal, `defaultModules()` | no (expected) | – | – | – | – | Lists only its modules. |
| Stellar | same + `ClipWalletModule` | **yes** | yes | yes | yes | yes | |
| Algorand | use-wallet-ui-react 1.2.1 `WalletButton`, Pera/Defly/Exodus | no (expected) | – | – | – | – | use-wallet v5 lists only the adapters passed. |
| Algorand | same + `clipWallet()` from `@clip-wallet/kit-modules/algorand` | **yes** | yes | yes | yes | yes | |
| TON | `@tonconnect/ui` 3.0.2 modal, stock ("View all wallets" opened) | no (expected) | – | – | – | – | Only the official wallets list. **Needs a listing.** |
| TON | same, `walletsListConfiguration.includeWallets` with Clip's draft entry (`jsBridgeKey: "clipwallet"`) | **yes** ("Installed") | yes | yes | yes | yes (`restoreConnection`) | |
| Tezos | Beacon 4.8.1 pairing modal (`requestPermissions`), "Show more" opened | **yes** | yes | **no** (known) | n/a | n/a | Current behaviour, unchanged: Clip is listed (it answers Beacon's postMessage ping), but clicking it does nothing usable. Beacon UI builds discovered extensions with `key = id` and only offers "Use Extension" when the wallet has a `firefoxId` (a key containing "firefox") or is in its extension list (`useConnect.tsx`, `utils/wallets.ts` in beacon-ui 4.8.0); for Clip it shows the install path. The test fails if this ever starts connecting. **Needs a listing** (or a Beacon UI fix). |
| Hedera | `@hashgraph/hedera-wallet-connect` 2.1.3 DAppConnector extension discovery (HashConnect v3 path) | skip | skip | skip | skip | skip | `WALLETCONNECT_PROJECT_ID` isn't in `.env.dapp-matrix`; the case skips with that reason. The page is ready (`pickers/dapps/src/hedera.tsx`), but its selectors are untested until a project id is added. |

Totals, part 1: every picker that lists injected wallets lists Clip with the right icon, and connects, reconnects and
restores (RainbowKit, ConnectKit, AppKit, Solana, Sui, Aptos, Mesh, DOT Connect). DOT Connect is the one wrong
name/icon, and the wallet can't fix it. Eight stock pickers show only their own registries; with the module or entry a
dapp adds, each one lists Clip and connects. The one exception is Beacon: it lists Clip but can't connect it.

### Part 2: hosted testnet dapps

| Ecosystem | Dapp (URL) | Listed | Icon OK | Connects | Signed action | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Polkadot (Westend) | polkadot.js apps, `https://polkadot.js.org/apps/?rpc=wss://westend-rpc.polkadot.io` | yes: account "CLIP WALLET (CLIP-WALLET)" with its 9.97 WND | n/a (apps lists accounts, not wallets) | yes (web3Enable → wallet "Connect") | **yes**: Developer → Sign and verify, sr25519 signature verified in Node (`signatureVerify`) | The account dropdown on Sign and verify starts empty; pick the account. Apps shows "1 extension that needs to be updated with the latest chain properties": Clip's `metadata.get()` returns `[]` and `provide()` refuses dapp-supplied metadata by design (see Open findings). |
| Solana (devnet) | Solana wallet-adapter example, `https://anza-xyz.github.io/wallet-adapter/example/` | yes | yes | yes, via **Sign In With Solana** (the example uses `solana:signIn` when the wallet has it) | **yes**: Sign Message; the example verifies the ed25519 signature itself | |
| Aptos (testnet) | Aptos Explorer, `https://explorer.aptoslabs.com/?network=testnet` | yes | yes | yes | n/a: its wallet actions are transactions | |
| Sui (testnet) | Suiscan, `https://suiscan.xyz/testnet/home` | yes ("Installed", next to Slush) | yes | yes | n/a: no free signing action | |
| Hedera (testnet, EVM injected) | HashScan, `https://hashscan.io/testnet/` | yes (EIP-6963) | yes | **not attempted** | n/a | The cookie banner is rejected. After picking Clip, HashScan requires **AGREE** on a third-party-wallet disclaimer, which is a terms acceptance the brief rules out, so the run cancels there. |
| EVM (Sepolia) | Reown AppKit Lab, `https://lab.reown.com/appkit/?name=wagmi` | yes | yes | yes, after switching the lab to **Sepolia** first (it starts on Ethereum mainnet; the test refuses to connect or sign unless the lab shows Sepolia) | **yes**: Sign Message → "Signing Succeeded" | AppKit-based; the lab's Reown project serves its cloud features. |
| EVM (Sepolia) | MetaMask test dapp, `https://metamask.github.io/test-dapp/` | yes | – | yes | n/a | Already in the dapp matrix (`evm-live`): its actions are enabled only for `isMetaMask` providers. |
| Tezos (shadownet) | Tezos Shadownet Faucet, `https://faucet.shadownet.teztnets.com/` (Beacon modal) | yes | yes | **no** (Beacon, as in part 1) | n/a | Only the connect UI was used. The faucet's request is captcha-gated and was never touched. |
| Cardano | cardano-connect-with-wallet's hosted storybook, Testnet Button story | no (expected) | – | – | – | The library's default registry, as in part 1. |
| Starknet (Sepolia) | Starknet Foundation faucet, `https://starknet-faucet.vercel.app/` | – | – | – | – | Skipped: it has no wallet connect (address field only; GitHub login for more). |
| Starknet (Sepolia) | Voyager, `https://sepolia.voyager.online/` | – | – | – | – | Skipped: Cloudflare bot check ("Performing security verification"). |
| Cardano (preprod) | Mesh docs (`meshjs.dev`) | – | – | – | – | Skipped: the docs no longer embed a live `CardanoWallet` (code only). None other without an account turned up in this pass; Mesh's stock UI is covered in part 1. |

Every hosted dapp that lists injected wallets lists Clip with the right icon. Each one that could be connected without
an account, captcha or terms connected. Every free signature verified: sr25519 on polkadot.js apps, ed25519 on the
Solana example (and SIWS), EIP-191 on AppKit Lab.

## Fixes

1. **Kit modules now show what the wallet announces.** The NEAR Wallet Selector, Stellar Wallets Kit and use-wallet
   modules showed a hard-coded copy of Clip's name and icon. A kit-built wallet (`globalKey: "mywallet"`) appeared in
   those pickers as "Clip Wallet" with Clip's icon, against AGENTS.md rule 8. They also didn't use the icon the
   extension announces, which is what this matrix checks. They now read `window[globalKey].info` (set by 1Mask). The
   order is: explicit options, then the announcement, then Clip's identity.
   - Code: `announcedIdentity()` in `packages/kit-modules/src/shared.ts`, used by `near/`, `stellar/` and `algorand/`.
   - Test: `packages/kit-modules/test/dapp-modules.test.ts`, "picker identity". It fails without the fix.
   - Changeset: `kit-modules-announced-identity`.
2. **A Ledger Bitcoin dependency only resolved by luck.** `@bitcoinerlab/descriptors` 1.x (via `ledger-bitcoin`,
   `packages/hardware`) requires `bip174/src/lib/converter/varint` without declaring `bip174`. It resolved only through
   pnpm's hoisting. Adding the picker libraries made pnpm hoist `bip174` 3, which has no such export, and the extension
   build failed.
   - Fix: a `packageExtensions` entry in `pnpm-workspace.yaml` declares the `bip174 ^2.1.1` it was written against.
   - Regression check: the extension build itself (`pnpm --filter @clip-wallet/extension build`).
3. **Flaky unit test.** In `packages/1mask/test/inpage-hedera.test.ts`, the discovery answer goes through two
   postMessage hops, and a fixed 10 ms wait failed under a loaded `pnpm -r test`. It also fails on main. The test now
   waits for the answer.

No picker needed a change to 1Mask's announcements, Wallet Standard features or CIP-30 metadata. Where Clip was shown,
its name and icon were right everywhere except two cases that only a listing can fix: the Cardano registry name
"Clipwallet" and DOT Connect's "clip-wallet".

Test-infrastructure notes (in `apps/extension/e2e/pickers/serve.ts`):
- The pages are built with code splitting.
- `wagmi/chains` resolves to `viem/chains`. esbuild otherwise drops viem's lazy init behind wagmi's `export *`.
- Hiero SDK uses its browser entry.
- libsodium-sumo uses its CommonJS build.
- Node built-ins become empty CommonJS stubs.

These are bundler choices any dapp makes; none of them touches the picker libraries' code.

## Needs a listing

Each stock picker below shows Clip only once Clip is in the picker's own list. The drafts in `docs/listings/` carry the
exact entries. Nothing has been submitted: they wait for the public release (Chrome Web Store id, published packages).

| Picker | What to submit | Where / process | Draft |
| --- | --- | --- | --- |
| TON Connect (`@tonconnect/ui`, every TON dapp) | Wallets-list entry: `app_name: "clipwallet"`, JS bridge key `clipwallet`, `platforms: ["chrome"]`, a 288×288 PNG icon URL | PR appending to `wallets-v2.json` in github.com/ton-connect/wallets-list (validated against `wallets-v2.schema.json`); mainnet builds only | `docs/listings/ton-connect.md` |
| Beacon (every Tezos dapp) | `tezosExtensionList` entry keyed by the Chrome extension id | PR to github.com/airgap-it/beacon-sdk, `scripts/blockchains/tezos.ts` (+ logo in `assets/logos/`); or a beacon-ui change offering "Use Extension" for any discovered extension | `docs/listings/tezos.md` |
| NEAR Wallet Selector | The `@clip-wallet/kit-modules/near` module as a selector package | PR to github.com/near/wallet-selector. NEAR Connect needs no listing: 1Mask answers its discovery. | `docs/listings/near.md` |
| Stellar Wallets Kit | `ClipWalletModule` | PR with the module to github.com/Creit-Tech/Stellar-Wallets-Kit (`docs/files/wallets/create-wallet-module.md`) | `docs/listings/stellar.md` |
| use-wallet (TxnLab) | `clipWallet()` adapter as a published package | Listed under "Third-Party Adapters" in TxnLab's docs (github.com/TxnLab/use-wallet) | `docs/listings/algorand.md` |
| cardano-connect-with-wallet | `walletRegistry` entry: `key: "clipwallet"`, `displayName: "Clip Wallet"`, `icon` (data URI) or the injected one, `chromeExtensionId` | PR to `wallets.ts` in github.com/cardano-foundation/cardano-connect-with-wallet (core package); the file's header says that is the only file to change | new (entry in this table) |
| Talisman Connect | A wallet class (`extensionName: "clip-wallet"`, title, logo, install URL) added to `getWallets()` | PR to github.com/TalismanSociety/talisman-connect, `packages/connect-wallets` | new |
| DOT Connect (ReactiveDOT) | Wallet config for the `clip-wallet` injected key: name "Clip Wallet" and logo | PR to DOT Connect's wallet list (`packages/dot-connect/src/wallets`), github.com/buffed-labs/dot-connect | new |
| starknetkit | An injected connector for `window.starknet_clipwallet` in the default connector list | PR to github.com/argentlabs/starknetkit (`src/connectors/injected`, default list in `connect()`) | new |
| sats-connect | A provider in `DefaultAdaptersInfo` (id, name, icon, install URL), and on Clip's side a provider reachable outside the Wallet Standard (WBIP-004 `btc_providers` / a `window` path) | PR to github.com/secretkeylabs/sats-connect-core; discuss with Xverse/Secret Key Labs first | new |
| Reown WalletGuide (optional) | Wallet listing | Reown Cloud wallet submission. Only for AppKit's "All wallets" explorer and WalletConnect QR flows; the injected path (RainbowKit, ConnectKit, AppKit) already works unlisted. | – |

No listing needed: EIP-6963 pickers (RainbowKit, ConnectKit, AppKit), Solana/Sui/Aptos (Wallet Standard), Mesh (any
CIP-30 wallet), NEAR Connect, and Hedera DAppConnector/HashConnect extension discovery (1Mask answers
`hedera-extension-query`; WalletConnect builds only).

## Open findings (not changed)

- **polkadot.js apps' metadata warning.** Clip's injected `metadata` provider returns `[]` and refuses `provide()`
  (dapp-supplied metadata is never trusted). So apps permanently shows "1 extension that needs to be updated" and a
  warning icon on the account.
  - Options: drop the `metadata` field (apps then doesn't count the extension), or have `get()` report the
    genesis/specVersion Clip actually uses.
  - Either changes what `@polkadot/extension-dapp` dapps see, so it needs a compat decision (docs/compat.md).
- **Beacon pairing.** As in the dapp matrix: the stock modal can't connect an unlisted Chromium extension.
- **HashScan disclaimer.** Connecting on HashScan needs a terms acceptance. Not a wallet issue; it is why that row stops
  at "listed".
- **WalletConnect project id.** RainbowKit/AppKit QR flows, AppKit's wallet explorer and the Hedera DAppConnector row
  need one in `.env.dapp-matrix` (`WALLETCONNECT_PROJECT_ID`). The Hedera row then runs automatically; its page
  selectors are untested until then.
