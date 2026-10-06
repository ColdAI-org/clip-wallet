---
"@clip-wallet/chains-ton": patch
"@clip-wallet/vault": patch
---

TON v4r2: the wallet id is the standard one on mainnet only; elsewhere it is bound to the network (standard id XOR
global_id), so a v4r2 transfer signed on testnet can't be replayed on mainnet. A v4r2 testnet wallet has its own
address (vault and module agree). New exports `v4WalletId`, `V4_STANDARD_WALLET_ID` (chains-ton) and
`tonV4R2WalletId` (vault). Audit CHAIN-L.
