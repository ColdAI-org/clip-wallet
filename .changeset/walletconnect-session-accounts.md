---
"@clip-wallet/1mask": patch
---

WalletConnect: a request naming an account the session didn't approve is refused with 5103 (UNSUPPORTED_ACCOUNTS),
and one naming another chain (EVM transaction `chainId`, Hedera CAIP-10 signer) with 5100, before it is decoded.
New export `namedAccounts()`. Audit WC-05.
