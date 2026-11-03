---
"@coldai/clip-wallet-1mask": patch
"@coldai/clip-wallet-chains-algorand": patch
"@coldai/clip-wallet-chains-aptos": patch
"@coldai/clip-wallet-chains-bitcoin": patch
"@coldai/clip-wallet-chains-cardano": patch
"@coldai/clip-wallet-chains-evm": patch
"@coldai/clip-wallet-chains-hedera": patch
"@coldai/clip-wallet-chains-near": patch
"@coldai/clip-wallet-chains-solana": patch
"@coldai/clip-wallet-chains-stellar": patch
"@coldai/clip-wallet-chains-substrate": patch
"@coldai/clip-wallet-chains-sui": patch
"@coldai/clip-wallet-chains-tezos": patch
"@coldai/clip-wallet-chains-ton": patch
"@coldai/clip-wallet-engine": patch
"@coldai/clip-wallet-hardware": patch
"@coldai/clip-wallet-link": patch
"@coldai/clip-wallet-plugins": patch
"@coldai/clip-wallet-vault": patch
---

Crypto-critical dependencies (`@noble/*`, `@scure/*`, `hash-wasm`, `@walletconnect/*`, `@ledgerhq/*`,
`@keystonehq/*`, `@ngraveio/bc-ur`, `@ton/crypto`) are pinned to exact versions, the ones the lockfile already
resolved. Audit SUP-02.
