---
"@clip-wallet/core": patch
"@clip-wallet/1mask": patch
"@clip-wallet/backup-client": patch
"@clip-wallet/chains-algorand": patch
"@clip-wallet/chains-cardano": patch
"@clip-wallet/chains-fuel": patch
"@clip-wallet/chains-hedera": patch
"@clip-wallet/chains-icp": patch
"@clip-wallet/chains-near": patch
"@clip-wallet/chains-solana": patch
"@clip-wallet/chains-starknet": patch
"@clip-wallet/chains-substrate": patch
"@clip-wallet/chains-tezos": patch
"@clip-wallet/engine": patch
"@clip-wallet/extension-kit": patch
"@clip-wallet/features": patch
"@clip-wallet/link": patch
"@clip-wallet/mobile-kit": patch
"@clip-wallet/names": patch
"@clip-wallet/plugins": patch
"@clip-wallet/security": patch
"@clip-wallet/ui": patch
"create-clip-wallet": patch
---

Trailing slashes, base64 padding and NUL padding are trimmed with a scan from the end, and node error messages are
matched with plain string searches one line at a time, so this work stays linear in the length of its input.
`@clip-wallet/core` adds the two helpers this uses: `withoutTrailing(s, chars)` and `includesInOrder(text, ...parts)`.
The plugin installer takes a pax `path` only from a record of its own, and the Phantom list is read line by line.
