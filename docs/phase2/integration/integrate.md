# Integration: stream "integrate" (all Phase 2 streams wired together)

Branch `p2/integrate`. Applied, in order: vault2 → move → near-stellar-tezos-algorand (after-move patch) →
cardano-substrate → starknet-ton → features → platform (incl. §5b) → hardware → mobile. The `fix/taproot`
merge needed no wiring: the extension's Receive only offers the BIP-84 address.

## Where things live now

| What | Where |
|---|---|
| Network/asset catalogue (14 families) | `packages/engine/src/catalog.ts`; `apps/extension/src/shared/catalog.ts` re-exports it |
| Passkey backup, phrase flag, accounts, names | `packages/engine/src/platform.ts` (`@clip-wallet/engine/platform`); the extension re-exports it |
| Feature host / CoinGecko feed | `packages/engine/src/features.ts` (`@clip-wallet/engine/features`); the extension re-exports it |
| Feature request schemas only | `@clip-wallet/features/messages` (pages and the engine root don't pull in every provider) |
| Extension orchestration | `apps/extension/src/background/service.ts` (still its own; see "Extension vs engine") |
| Mobile orchestration | `packages/engine/src/engine.ts` (`WalletEngine`) with the same changes ported |
| Hosted services | `clip.config` `services.backupUrl` / `services.mediaProxyUrl` (new, optional, https). Unset = passkey backup hidden with a plain note; NFT media show placeholders |

## Decisions where the docs overlapped or conflicted

- **OneMaskConnector constructor.** NSTA wanted `(networks, { kv, name, iconUrl })` and starknet-ton
  `(networks, { starknet, ton })`. It is now one options object: `{ beacon, starknet, ton }`. Starknet and TON
  arrive as loaders because those modules load on first use (see "Bundle").
- **Connect methods / ETAs.** Union of every stream's list. Plain ETAs added for Cardano (40 s), Substrate (12 s),
  Starknet (10 s) and TON (6 s). These are estimates, not measured.
- **`ctx()`.** It merges vault2 (Bitcoin change addresses), platform (the dapp's origin picks the account) and
  hardware (no vault change addresses for a hardware account).
- **Which account signs.** Priority: (1) a site's own choice in Settings → Accounts, (2) a hardware account
  picked for that family, (3) the wallet default (Settings → Accounts, account 0 until chosen).
- **Address recognition.** `FAMILIES` comes from core. Only families with a module are asked (fixture builds
  have mocks for all 14 now).
- **`window.clipwallet`.** TON Connect froze its holder object, so whichever of TON or the
  NEAR/Stellar/Algorand providers installed second was lost (or threw). They now share 1Mask's own root, and
  another wallet's global is never extended. Covered by `packages/1mask/test/inpage-shared-global.test.ts`.
- **Passkey restore.** The platform doc asked the vault for `restorePasskeyBackup`. It is now in
  `packages/vault` (with tests), and the background fallback that decrypted the phrase outside the vault is
  gone.
- **§5b.** The Jupiter and Solana-staking program allowlists are removed. chains-solana decodes those
  transactions now; anything else stays blind.
- **Menus.** The features doc's Settings "More" section and the platform doc's security buttons became two
  menu lists:
  - More: Stake, Swap, Buy, Secure Trade, Explore apps.
  - Security: Backup, Accounts, Hardware wallets.

  Backup is a new hub screen (`/backup`) linking the phrase and passkey backups. Explore is also a bottom tab
  when a features client is present (the features doc said "TabBar unchanged"; the brief asked for tabs). Home
  and the asset screen get a Swap / Buy / Stake row. Stake only shows where a provider is live (HBAR, SOL).
- **Hedera on Ledger.** Kept off the device list. Ed25519 Hedera accounts need prepare/finalize/account-id
  changes in chains-hedera.
- **Taproot.** Untouched. Hardware raw payloads only add `raw` next to the existing payloads.
- **Asset keys.** chains-starknet keyed Sepolia ETH `eth`, but EVM testnets use `eth-testnet`; it is now
  `eth-testnet`, so testnet ETH is one row. TON's native coin stays `gram`/GRAM (the stream's documented
  rename). CoinGecko ids were added for `gram`, `eth-testnet` and the Westend/Paseo coins.

## Fixes found while integrating (not in any doc)

- **Service worker died on load.** A bundled TextEncoder polyfill read `window`/`global`, and readable-stream
  (from the hardware deps) read `process`. Fix: `global: "globalThis"` define plus a minimal `process` shim in
  `shared/node-globals.ts`.
- **Background bundled the Aptos SDK.** Background `methods.ts`/`router.ts` imported method-name constants
  from the in-page Sui/Aptos modules, which pulled in `@aptos-labs/ts-sdk`. The constants now live in
  `shared/move-methods.ts`, checked against the libraries in a test.
- **Mobile injected bundle threw on load.** esbuild dropped ts-sdk's entry, which runs its lazy
  initialisers. A small resolve plugin fixes it (bundle 466 → 609 KiB).
- **Metro.** `@ton/crypto-primitives`' React Native build requires `react-native-fast-pbkdf2` on a code path
  the wallet never runs, so it is stubbed. `expo export --platform ios` succeeds (23 MB Hermes bytecode).

## Extension vs engine

The extension stays on `service.ts`. Moving it onto `WalletEngine` was not simple:
- The engine lacked everything this integration added.
- The engine changes behaviour on lock (it rejects waiting approvals; the extension queues and unlocks).
- Fixture-mode simulation and the hardware signer routing exist only in the extension.

Everything was ported to the engine instead, so mobile gets all 14 families, features and platform. The pieces
that were plain copies (catalogue, PlatformService, feature host) are now shared from the engine. The
remaining duplication is the orchestration class itself (`service.ts` vs `engine.ts`). Keep them in step until
the move recipe in `mobile.md` is done.

## Bundle (extension, `wxt build`)

| | background.js | page chunk | inpage.js |
|---|---|---|---|
| main before integration | 3.96 MB | 0.41 MB | 111 KB |
| + 14 families | 6.94 MB | | 250 KB |
| + features, platform | 7.25 MB | 3.39 MB | |
| + hardware | 9.91 MB | | |
| final | 10.00 MB | 0.84 MB | 250 KB |
| Phase 2.5: hardware signing in the approval window (docs/phase25/integration/size-hw.md) | 7.34 MB | 0.85 MB (+2.5 MB lazy, hardware only) | 250 KB |

MV3 service workers can't fetch code chunks: `import()` is forbidden in service workers, and WXT inlines it.
WXT does emit `import()` as a lazy initialiser inside the one file, though, so code behind it is parsed but not
evaluated until first use. That is used for:
- The Ledger/Keystone signers (`@clip-wallet/hardware/core` is the light half).
- The ten Phase 2 chain modules (`lazyChain` in `wiring.ts`; each package has a data-only `./networks` entry so
  the catalogue doesn't pull module code in).

A cold service worker evaluates in about 700 ms (headless Chromium on the dev machine; ~740 ms before the lazy
loading). A Node profile shows compiling the 10 MB file is about half of that, so further gains need fewer bytes:
- Move hardware signing into the approval window, which needs a page for WebHID and the camera anyway: about
  1.5 MB.
- Replace the Hedera SDK protobufs in chains-hedera: about 2 MB.
- Drop `@walletconnect/pay` and dedupe zod and noble.

The page chunk shrank because pages now import only `@clip-wallet/features/messages`.

## Tests

- **Extension e2e: 7 tests.** The 5 existing ones, plus:
  - Real wiring: one account per family with address shapes checked, and Receive lists every family's coin.
  - Fixtures: Stake, Swap, Explore, Backup and Accounts screenshots.
- **Fixture mode.** A mock module for every family, sample balances for SUI/ADA/PAS/GRAM/NEAR/XTZ and
  Sui/TON/Cardano collectibles. Features use sample staking, quotes and liquidity
  (`background/mocks/mock-features.ts`).
- **New unit tests.**
  - Extension: Ledger replay through `approve()`, lazy chain modules.
  - Engine: all-families wiring, PRF input pinned.
  - Vault: `restorePasskeyBackup`, PRF input pinned.
  - 1Mask: shared global, Sui/Aptos method names.
  - UI: feature, backup and accounts entry points.
  - Chains: raw payloads.
  - Mobile: the Explore screen.

## Gaps

- **Staking/swap coverage.** Cardano, Substrate, NEAR and Tezos staking providers aren't written (features §10),
  so they show "coming soon". There are no swap providers for the new families. Partner keys are build env only,
  so without them swap and buy show "not switched on".
- **Mobile screens.** Only Explore (featured apps in the in-app browser, read-only staking) was added. Stake,
  Swap, Buy, Secure Trade, Backup, Accounts and hardware have no React Native screens yet. The WebView doesn't
  configure TON Connect or the Beacon relay. The app was bundled with Metro but not run on a simulator.
- **Hardware.** Not supported:
  - Hedera on Ledger and taproot on devices.
  - Bitcoin messages on Keystone and Solana messages on Ledger.
  - Hardware-only wallets (a vault without a phrase).
- **Services.** services/backup and services/media-proxy are not deployed. Beacon P2P (QR pairing) is not
  wired. NEAR named accounts are not offered to dapps.
