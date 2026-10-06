---
"@clip-wallet/chains-hedera": patch
---

`derivationPath(i)` now reports `m/44'/3030'/0'/0/i`, the path the vault derives Hedera ECDSA keys at (the Hiero
SDK's standard ECDSA path). It said `m/44'/60'/0'/0/i`, the EVM account's path.
