---
"@coldai/clip-wallet-core": patch
"@coldai/clip-wallet-1mask": patch
"@coldai/clip-wallet-backup-client": patch
"@coldai/clip-wallet-chains-algorand": patch
"@coldai/clip-wallet-chains-cardano": patch
"@coldai/clip-wallet-chains-fuel": patch
"@coldai/clip-wallet-chains-hedera": patch
"@coldai/clip-wallet-chains-icp": patch
"@coldai/clip-wallet-chains-near": patch
"@coldai/clip-wallet-chains-solana": patch
"@coldai/clip-wallet-chains-starknet": patch
"@coldai/clip-wallet-chains-substrate": patch
"@coldai/clip-wallet-chains-tezos": patch
"@coldai/clip-wallet-engine": patch
"@coldai/clip-wallet-extension-kit": patch
"@coldai/clip-wallet-features": patch
"@coldai/clip-wallet-link": patch
"@coldai/clip-wallet-mobile-kit": patch
"@coldai/clip-wallet-names": patch
"@coldai/clip-wallet-plugins": patch
"@coldai/clip-wallet-security": patch
"@coldai/clip-wallet-ui": patch
"create-clip-wallet": patch
---

Trailing slashes, base64 padding and NUL padding are trimmed with a scan from the end, and node error messages are
matched with plain string searches one line at a time, so this work stays linear in the length of its input.
`@coldai/clip-wallet-core` adds the two helpers this uses: `withoutTrailing(s, chars)` and `includesInOrder(text, ...parts)`.
The plugin installer takes a pax `path` only from a record of its own, and the Phantom list is read line by line.
