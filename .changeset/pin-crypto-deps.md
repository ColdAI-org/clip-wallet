---
"@clip-wallet/1mask": patch
"@clip-wallet/chains-algorand": patch
"@clip-wallet/chains-aptos": patch
"@clip-wallet/chains-bitcoin": patch
"@clip-wallet/chains-cardano": patch
"@clip-wallet/chains-evm": patch
"@clip-wallet/chains-hedera": patch
"@clip-wallet/chains-near": patch
"@clip-wallet/chains-solana": patch
"@clip-wallet/chains-stellar": patch
"@clip-wallet/chains-substrate": patch
"@clip-wallet/chains-sui": patch
"@clip-wallet/chains-tezos": patch
"@clip-wallet/chains-ton": patch
"@clip-wallet/engine": patch
"@clip-wallet/hardware": patch
"@clip-wallet/link": patch
"@clip-wallet/plugins": patch
"@clip-wallet/vault": patch
---

Crypto-critical dependencies (`@noble/*`, `@scure/*`, `hash-wasm`, `@walletconnect/*`, `@ledgerhq/*`,
`@keystonehq/*`, `@ngraveio/bc-ur`, `@ton/crypto`) are pinned to exact versions, the ones the lockfile already
resolved. Audit SUP-02.
