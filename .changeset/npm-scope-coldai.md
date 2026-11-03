---
"@coldai/clip-wallet-1mask": minor
"@coldai/clip-wallet-backup-client": minor
"@coldai/clip-wallet-chains-algorand": minor
"@coldai/clip-wallet-chains-antelope": minor
"@coldai/clip-wallet-chains-aptos": minor
"@coldai/clip-wallet-chains-bitcoin": minor
"@coldai/clip-wallet-chains-bitcoincash": minor
"@coldai/clip-wallet-chains-cardano": minor
"@coldai/clip-wallet-chains-cosmos": minor
"@coldai/clip-wallet-chains-evm": minor
"@coldai/clip-wallet-chains-fuel": minor
"@coldai/clip-wallet-chains-hedera": minor
"@coldai/clip-wallet-chains-icp": minor
"@coldai/clip-wallet-chains-multiversx": minor
"@coldai/clip-wallet-chains-near": minor
"@coldai/clip-wallet-chains-solana": minor
"@coldai/clip-wallet-chains-stacks": minor
"@coldai/clip-wallet-chains-starknet": minor
"@coldai/clip-wallet-chains-stellar": minor
"@coldai/clip-wallet-chains-substrate": minor
"@coldai/clip-wallet-chains-sui": minor
"@coldai/clip-wallet-chains-tezos": minor
"@coldai/clip-wallet-chains-ton": minor
"@coldai/clip-wallet-chains-tron": minor
"@coldai/clip-wallet-chains-xrpl": minor
"@coldai/clip-wallet-config": minor
"@coldai/clip-wallet-connect": minor
"@coldai/clip-wallet-core": minor
"@coldai/clip-wallet-desktop-kit": minor
"@coldai/clip-wallet-engine": minor
"@coldai/clip-wallet-extension-kit": minor
"@coldai/clip-wallet-features": minor
"@coldai/clip-wallet-hardware": minor
"@coldai/clip-wallet-i18n": minor
"@coldai/clip-wallet-kit-modules": minor
"@coldai/clip-wallet-link": minor
"@coldai/clip-wallet-media-client": minor
"@coldai/clip-wallet-mobile-kit": minor
"@coldai/clip-wallet-names": minor
"@coldai/clip-wallet-plugins": minor
"@coldai/clip-wallet-route": minor
"@coldai/clip-wallet-security": minor
"@coldai/clip-wallet-social": minor
"@coldai/clip-wallet-ui": minor
"@coldai/clip-wallet-vault": minor
"create-clip-wallet": minor
---

The kit's packages are published as `@coldai/clip-wallet-<name>`: every `@clip-wallet/<name>` becomes
`@coldai/clip-wallet-<name>`, for example `@clip-wallet/core` → `@coldai/clip-wallet-core`, and imports use the new
names (`import { defineConfig } from "@coldai/clip-wallet-config"`). `create-clip-wallet` is unchanged:
`npx create-clip-wallet` scaffolds a wallet as before.
