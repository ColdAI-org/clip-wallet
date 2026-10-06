---
"@clip-wallet/hardware": patch
---

`HardwareKeyring.addAccounts()` derives each account's address from its public key and refuses a record whose
address differs (EVM, Solana, Bitcoin P2WPKH with the xpub child checked; a Hedera record may not name an address
or account id). `updateAccount()` can't change an address either. Audit HW-01.
