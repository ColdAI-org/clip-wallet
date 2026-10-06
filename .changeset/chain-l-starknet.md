---
"@clip-wallet/chains-starknet": patch
---

SNIP-12 typed data without a domain `chainId` is refused (starknet/network-mismatch). The generic view shows the
fields `types` declares (undeclared keys never reach the hash, so they aren't shown), up to 16 with the rest
counted (was the first 8 raw keys), and carries the unknown-signature caution. Audit CHAIN-L.
