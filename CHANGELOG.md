# Changelog

All notable changes to Clip Wallet. The format follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/). Pre-1.0 minor versions may break things.
The release workflow (`.github/workflows/release.yml`) refuses a tag `vX.Y.Z` without a `## [X.Y.Z]` section here.

## [Unreleased]

## [0.1.0] - not yet tagged (testnet preview)

First public preview. **Test networks only.** No external audit.

### Added

- **Wallet core:** one recovery phrase for 14 network families (EVM, Hedera, Solana, Bitcoin, Sui, Aptos,
  Cardano, Substrate, Starknet, TON, NEAR, Stellar, Tezos, Algorand). Vault with Argon2id and
  XChaCha20-Poly1305, approval-bound signing, passkey unlock (WebAuthn PRF).
- **Networks are invisible:** balances merged by asset across networks (same issuer only), and the network
  shown only where a mistake loses money.
- **1Mask connectors:** EIP-1193/EIP-6963, Wallet Standard (Solana, Sui), Bitcoin, Hedera, CIP-30, injectedWeb3,
  get-starknet, TON Connect, NEAR, Stellar SEP-43, Algorand, Tezos Beacon and WalletConnect v2; kit modules for
  NEAR Wallet Selector, Stellar Wallets Kit and use-wallet.
- **Every request decoded** into a plain-language `DecodedRequest`; blind signing blocked by default.
- **Features:** staking, swaps, buying, Secure Trade (P2P), Explore and Discover, contacts and Clip handles,
  notifications, Route and fund on CLPRouter (pay on Hedera), settle-on-Hedera planning helper.
- **Security:** scam lists checked on the device, optional Blockaid, approval revoker, spam cleanup.
- **Hardware wallets:** Ledger (WebHID, Bluetooth on mobile) and Keystone (QR).
- **Clip Plugins:** SES-sandboxed plugins from npm, Advanced mode only, off by default.
- **Passkey backup service** (ciphertext only; email, Google or Apple sign-in) and **media proxy** for NFT
  images (Cloudflare Workers).
- **Mobile app** for iOS and Android (Expo 57) on the same engine.
- **12 languages** including right-to-left Arabic, with translation QA tests.
- **Brand:** the Clip Wallet mark (a clipper sail), wordmark and every icon size, rendered from `brand/`.
- **Settings → Your data:** the in-app data-use disclosure, in every language.
- **Release engineering:** store packages for Chrome/Edge and Firefox, store listing kit, deterministic zips and
  a reproducible-build check, CI, CodeQL, Dependabot, SLSA build provenance on releases.
- **Docs:** README, SECURITY, CONTRIBUTING (DCO), Code of Conduct; draft privacy policy and terms (awaiting
  legal review).

### Changed

- Accent-coloured small text uses a derived AA shade (`--clip-accent-ink`, #C22E00 in light mode for ColdAI
  orange); buttons and the brand keep #FF3C00.
- The extension's inpage message channel is derived from the version and `SOURCE_DATE_EPOCH` instead of a random
  value per build, so builds are reproducible.
- Firefox: the background is an ES-module event page; the manifest declares `data_collection_permissions` and
  needs Firefox 140 or later.

### Known gaps

See the status table in [README.md](README.md#status).
